const pool = require('../config/db');

// ============================================
// 3.1. Create Order
// POST /orders
// Auth: Bearer Token (role: customer)
// ============================================
exports.createOrder = async (req, res) => {
  const { service_id, pickup_address, pickup_lat, pickup_lng, pickup_scheduled_at } = req.body;
  const customer_id = req.user.id;

  if (!service_id) {
    return res.status(422).json({ message: 'Validation error', errors: { service_id: ['service_id wajib diisi'] } });
  }

  const connection = await pool.getConnection();
  try {
    // 1. Cek service
    const [services] = await connection.query('SELECT * FROM services WHERE service_id = ? AND is_active = 1', [service_id]);
    if (services.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Service not found' });
    }

    const service = services[0];
    await connection.beginTransaction();

    // 2. Generate IDs
    const timestamp = Date.now();
    const orderId = `ORD${timestamp}`;
    const invoiceId = `INV${timestamp}`;

    // 3. Buat order — snapshot harga, amount belum dihitung (weight belum diinput)
    await connection.query(
      `INSERT INTO orders (order_id, customer_id, service_id, pickup_address, pickup_lat, pickup_lng, pickup_scheduled_at, 
       price_per_kg_owner, price_per_kg_customer, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAITING_OWNER_CONFIRMATION')`,
      [orderId, customer_id, service_id, pickup_address || null, pickup_lat || null, pickup_lng || null, 
       pickup_scheduled_at || null, service.price_per_kg_owner, service.price_per_kg_customer]
    );

    // 4. Buat invoice awal (amount = NULL, status = unpaid)
    await connection.query(
      `INSERT INTO invoices (invoice_id, order_id, status) VALUES (?, ?, 'unpaid')`,
      [invoiceId, orderId]
    );

    // 5. Catat status log
    await connection.query(
      `INSERT INTO order_status_logs (order_id, status, changed_by) VALUES (?, 'WAITING_OWNER_CONFIRMATION', ?)`,
      [orderId, customer_id]
    );

    await connection.commit();
    connection.release();

    res.status(201).json({
      message: 'Order created',
      data: {
        order_id: orderId,
        invoice_id: invoiceId,
        status: 'WAITING_OWNER_CONFIRMATION',
        pickup_scheduled_at: pickup_scheduled_at || null
      }
    });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 3.2. Get My Orders (Customer)
// GET /orders/my-orders
// Auth: Bearer Token (role: customer)
// ============================================
exports.getMyOrders = async (req, res) => {
  const customer_id = req.user.id;
  const { status, page = 1, limit = 10 } = req.query;
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  try {
    let whereConditions = ['o.customer_id = ?'];
    let params = [customer_id];

    if (status) {
      whereConditions.push('o.status = ?');
      params.push(status);
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM orders o ${whereClause}`, params);
    const total = countResult[0].total;

    const [orders] = await pool.query(
      `SELECT o.order_id, o.status, s.name AS service_name, o.total_amount, o.created_at
       FROM orders o
       LEFT JOIN services s ON o.service_id = s.service_id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      message: 'Success',
      data: orders,
      pagination: { page: pageNum, limit: limitNum, total }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 3.3. Get Order Detail
// GET /orders/:order_id
// Auth: Bearer Token (customer / owner)
// ============================================
exports.getOrderDetail = async (req, res) => {
  const { order_id } = req.params;

  try {
    const [orders] = await pool.query(
      `SELECT o.*, s.name AS service_name, s.price_per_kg_customer AS service_price
       FROM orders o
       LEFT JOIN services s ON o.service_id = s.service_id
       WHERE o.order_id = ?`,
      [order_id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = orders[0];

    // Ambil info kurir jika ada
    let courier = null;
    const [assignments] = await pool.query(
      `SELECT ca.*, u.full_name AS courier_name, u.vehicle_name
       FROM courier_assignments ca
       LEFT JOIN users u ON ca.courier_id = u.user_id
       WHERE ca.order_id = ?`,
      [order_id]
    );
    if (assignments.length > 0) {
      courier = { name: assignments[0].courier_name, vehicle: assignments[0].vehicle_name };
    }

    // Ambil status history
    const [statusHistory] = await pool.query(
      `SELECT status, changed_at AS at FROM order_status_logs WHERE order_id = ? ORDER BY changed_at ASC`,
      [order_id]
    );

    res.json({
      data: {
        order_id: order.order_id,
        status: order.status,
        service: { name: order.service_name, price_per_kg_customer: order.service_price },
        courier,
        weight_kg: order.weight_kg,
        distance_km: order.distance_km,
        service_fee: order.service_fee,
        delivery_fee: order.delivery_fee,
        admin_commission: order.admin_commission,
        owner_earning: order.owner_earning,
        courier_earning: order.courier_earning,
        total_amount: order.total_amount,
        status_history: statusHistory
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 3.4. Update Order Status (Owner)
// PATCH /orders/:order_id/status
// Auth: Bearer Token (role: owner)
// Valid statuses: CONFIRMED, PROCESSING, READY_FOR_DELIVERY
// ============================================
exports.updateOrderStatus = async (req, res) => {
  const { order_id } = req.params;
  const { status } = req.body;
  const userId = req.user.id;

  const validOwnerStatuses = ['CONFIRMED', 'PROCESSING', 'READY_FOR_DELIVERY'];

  if (!status || !validOwnerStatuses.includes(status)) {
    return res.status(422).json({ message: 'Invalid status transition' });
  }

  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [order_id]);
    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Status flow validation
    const statusFlow = {
      'WAITING_OWNER_CONFIRMATION': ['CONFIRMED'],
      'LAUNDRY_PICKED': ['PROCESSING'],
      'PROCESSING': ['READY_FOR_DELIVERY']
    };

    const currentStatus = orders[0].status;
    const allowed = statusFlow[currentStatus] || [];
    if (!allowed.includes(status)) {
      return res.status(422).json({ message: `Invalid status transition. Current: ${currentStatus}` });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    await connection.query('UPDATE orders SET status = ? WHERE order_id = ?', [status, order_id]);
    await connection.query(
      'INSERT INTO order_status_logs (order_id, status, changed_by) VALUES (?, ?, ?)',
      [order_id, status, userId]
    );

    await connection.commit();
    connection.release();

    res.json({
      message: 'Status updated',
      data: { order_id, status }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 3.5. Assign Courier (Owner)
// POST /orders/:order_id/assign-courier
// Auth: Bearer Token (role: owner)
// Courier locking — 1 kurir = pickup + delivery
// ============================================
exports.assignCourier = async (req, res) => {
  const { order_id } = req.params;
  const { courier_id } = req.body;

  if (!courier_id) {
    return res.status(422).json({ message: 'Validation error', errors: { courier_id: ['courier_id wajib diisi'] } });
  }

  try {
    // Cek order ada dan statusnya CONFIRMED
    const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [order_id]);
    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (orders[0].status !== 'CONFIRMED') {
      return res.status(422).json({ message: 'Order must be CONFIRMED before assigning courier' });
    }

    // Cek kurir ada dan role-nya courier
    const [couriers] = await pool.query("SELECT user_id FROM users WHERE user_id = ? AND role = 'courier'", [courier_id]);
    if (couriers.length === 0) {
      return res.status(404).json({ message: 'Courier not found' });
    }

    // Cek apakah sudah ada assignment (courier locking)
    const [existingAssignment] = await pool.query(
      'SELECT assignment_id FROM courier_assignments WHERE order_id = ?',
      [order_id]
    );
    if (existingAssignment.length > 0) {
      return res.status(409).json({ message: 'Courier already locked for this order' });
    }

    const assignmentId = `ASG${Date.now()}`;

    await pool.query(
      `INSERT INTO courier_assignments (assignment_id, order_id, courier_id, current_phase, locked) 
       VALUES (?, ?, ?, 'pickup', 1)`,
      [assignmentId, order_id, courier_id]
    );

    res.status(201).json({
      message: 'Courier assigned and locked',
      data: {
        assignment_id: assignmentId,
        order_id,
        courier_id,
        locked: true,
        covers: ['pickup', 'delivery']
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 3.6. Input Berat Laundry (Owner)
// PATCH /orders/:order_id/weight
// Auth: Bearer Token (role: owner)
// ============================================
exports.inputWeight = async (req, res) => {
  const { order_id } = req.params;
  const { weight_kg } = req.body;

  if (!weight_kg || weight_kg <= 0) {
    return res.status(422).json({ message: 'Validation error', errors: { weight_kg: ['weight_kg wajib diisi dan > 0'] } });
  }

  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [order_id]);
    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const order = orders[0];

    // Simulasi jarak (di production: Google Maps API)
    // Menggunakan default 5 km jika tidak ada data koordinat
    const distance_km = 5;

    const price_per_kg_owner = parseFloat(order.price_per_kg_owner);
    const price_per_kg_customer = parseFloat(order.price_per_kg_customer);

    // Kalkulasi biaya sesuai spec
    const service_fee = weight_kg * price_per_kg_customer;
    const delivery_fee = distance_km * 2 * 1500;
    const admin_commission = weight_kg * (price_per_kg_customer - price_per_kg_owner);
    const owner_earning = weight_kg * price_per_kg_owner;
    const courier_earning = distance_km * 2 * 1250;
    const total_amount = service_fee + delivery_fee;

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    // Update order dengan kalkulasi
    await connection.query(
      `UPDATE orders SET weight_kg = ?, distance_km = ?, service_fee = ?, delivery_fee = ?, 
       admin_commission = ?, owner_earning = ?, courier_earning = ?, total_amount = ?
       WHERE order_id = ?`,
      [weight_kg, distance_km, service_fee, delivery_fee, admin_commission, owner_earning, courier_earning, total_amount, order_id]
    );

    // Update invoice
    await connection.query(
      `UPDATE invoices SET amount = ?, service_fee = ?, delivery_fee = ? WHERE order_id = ?`,
      [total_amount, service_fee, delivery_fee, order_id]
    );

    // Kirim notifikasi ke customer
    await connection.query(
      `INSERT INTO notifications (user_id, title, body) VALUES (?, ?, ?)`,
      [order.customer_id, 'Invoice Siap', `Pesanan ${order_id} sudah dihitung. Total: Rp${total_amount.toLocaleString('id-ID')}`]
    );

    await connection.commit();
    connection.release();

    res.json({
      message: 'Weight updated',
      data: {
        weight_kg,
        distance_km,
        price_per_kg_owner,
        price_per_kg_customer,
        service_fee,
        delivery_fee,
        admin_commission,
        owner_earning,
        courier_earning,
        total_amount
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 3.7. Aktifkan Fase Delivery (Owner)
// PATCH /orders/:order_id/activate-delivery
// Auth: Bearer Token (role: owner)
// ============================================
exports.activateDelivery = async (req, res) => {
  const { order_id } = req.params;

  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [order_id]);
    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (orders[0].status !== 'READY_FOR_DELIVERY') {
      return res.status(422).json({ message: 'Order must be READY_FOR_DELIVERY' });
    }

    // Switch courier phase ke delivery
    const [assignments] = await pool.query('SELECT * FROM courier_assignments WHERE order_id = ?', [order_id]);
    if (assignments.length === 0) {
      return res.status(404).json({ message: 'No courier assigned' });
    }

    await pool.query(
      `UPDATE courier_assignments SET current_phase = 'delivery' WHERE order_id = ?`,
      [order_id]
    );

    res.json({
      message: 'Courier phase switched to delivery',
      data: {
        order_id,
        courier_id: assignments[0].courier_id,
        current_phase: 'delivery'
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 3.8. Track Order (Customer)
// GET /orders/:order_id/tracking
// Auth: Bearer Token (role: customer)
// ============================================
exports.trackOrder = async (req, res) => {
  const { order_id } = req.params;

  try {
    // Cek order
    const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [order_id]);
    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Cari assignment
    const [assignments] = await pool.query(
      `SELECT ca.*, u.full_name AS courier_name, u.vehicle_name
       FROM courier_assignments ca
       LEFT JOIN users u ON ca.courier_id = u.user_id
       WHERE ca.order_id = ?`,
      [order_id]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ message: 'No courier assigned for this order' });
    }

    const assignment = assignments[0];

    // Lokasi terakhir
    const [locations] = await pool.query(
      'SELECT lat, lng, updated_at FROM courier_locations WHERE assignment_id = ? ORDER BY updated_at DESC LIMIT 1',
      [assignment.assignment_id]
    );

    // Tentukan task_status berdasarkan phase
    let task_status = null;
    if (assignment.current_phase === 'pickup') {
      task_status = assignment.pickup_status;
    } else {
      task_status = assignment.delivery_status;
    }

    res.json({
      data: {
        courier: { name: assignment.courier_name, vehicle: assignment.vehicle_name },
        location: locations.length > 0 ? { lat: locations[0].lat, lng: locations[0].lng } : null,
        current_phase: assignment.current_phase,
        task_status
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 3.9. Customer Konfirmasi Pesanan Selesai
// PATCH /orders/:order_id/complete
// Auth: Bearer Token (role: customer)
// ============================================
exports.completeOrder = async (req, res) => {
  const { order_id } = req.params;
  const customer_id = req.user.id;

  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [order_id]);
    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (orders[0].customer_id !== customer_id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (orders[0].status !== 'DELIVERED') {
      return res.status(400).json({ message: 'Order must be DELIVERED before completing' });
    }

    const order = orders[0];
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Update order status → COMPLETED
    await connection.query('UPDATE orders SET status = ? WHERE order_id = ?', ['COMPLETED', order_id]);

    // 2. Catat status log
    await connection.query(
      'INSERT INTO order_status_logs (order_id, status, changed_by) VALUES (?, ?, ?)',
      [order_id, 'COMPLETED', customer_id]
    );

    // 3. Release pending balance → available balance
    // Update wallet_transactions yang terkait order ini dari pending → available
    await connection.query(
      `UPDATE wallet_transactions SET status = 'available' 
       WHERE order_id = ? AND status = 'pending'`,
      [order_id]
    );

    // 4. Update saldo wallet owner dan kurir
    // Ambil assignment untuk mendapat courier_id
    const [assignments] = await connection.query(
      'SELECT courier_id FROM courier_assignments WHERE order_id = ?', [order_id]
    );

    // Cari service untuk mendapat owner (dari order kita punya service_id, tapi tidak punya owner_id langsung di orders table)
    // Kita update wallets berdasarkan wallet_transactions
    const [pendingTxns] = await connection.query(
      `SELECT wt.wallet_id, wt.amount, w.user_id 
       FROM wallet_transactions wt
       JOIN wallets w ON wt.wallet_id = w.wallet_id
       WHERE wt.order_id = ? AND wt.type = 'credit'`,
      [order_id]
    );

    const releasedTo = {};
    for (const txn of pendingTxns) {
      await connection.query(
        `UPDATE wallets SET available_balance = available_balance + ?, pending_balance = pending_balance - ? WHERE wallet_id = ?`,
        [txn.amount, txn.amount, txn.wallet_id]
      );

      // Determine role
      const [walletInfo] = await connection.query('SELECT role FROM wallets WHERE wallet_id = ?', [txn.wallet_id]);
      if (walletInfo.length > 0 && walletInfo[0].role !== 'admin') {
        releasedTo[walletInfo[0].role] = { amount: parseFloat(txn.amount), wallet_id: txn.wallet_id };
      }
    }

    await connection.commit();
    connection.release();

    res.json({
      message: 'Order completed. Saldo owner dan kurir telah dirilis.',
      data: {
        order_id,
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
        balance_released: true,
        released_to: releasedTo
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 9.1. Riwayat Transaksi Customer
// GET /orders/my-orders/history
// Auth: Bearer Token (role: customer)
// ============================================
exports.getOrderHistory = async (req, res) => {
  const customer_id = req.user.id;
  const { status, date_from, date_to, page = 1, limit = 20 } = req.query;
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  try {
    let whereConditions = ['o.customer_id = ?'];
    let params = [customer_id];

    if (status) { whereConditions.push('o.status = ?'); params.push(status); }
    if (date_from) { whereConditions.push('o.created_at >= ?'); params.push(date_from); }
    if (date_to) { whereConditions.push('o.created_at <= ?'); params.push(date_to + ' 23:59:59'); }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM orders o ${whereClause}`, params);
    const total = countResult[0].total;

    const [totalSpentResult] = await pool.query(
      `SELECT COALESCE(SUM(o.total_amount), 0) as total_spent FROM orders o ${whereClause}`, params
    );

    const [orders] = await pool.query(
      `SELECT o.order_id, s.name AS service_name, o.weight_kg, o.total_amount, o.status,
              i.invoice_id, p.payment_method, u.full_name AS courier_name,
              o.created_at, o.updated_at AS completed_at
       FROM orders o
       LEFT JOIN services s ON o.service_id = s.service_id
       LEFT JOIN invoices i ON o.order_id = i.order_id
       LEFT JOIN payments p ON i.invoice_id = p.invoice_id AND p.status = 'success'
       LEFT JOIN courier_assignments ca ON o.order_id = ca.order_id
       LEFT JOIN users u ON ca.courier_id = u.user_id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      data: orders,
      summary: { total_orders: total, total_spent: parseFloat(totalSpentResult[0].total_spent) },
      pagination: { page: pageNum, limit: limitNum, total }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
