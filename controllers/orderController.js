const pool = require('../config/db');
const { calculateDistanceKm, isManualDistanceAllowed } = require('../helpers/distance');
const { createNotification } = require('../helpers/notification');
const { isPositiveNumber, isNonNegativeNumber, isValidDatetime } = require('../helpers/validators');

// ============================================
// Status flow yang valid (9 tahap sesuai dokumen)
// ============================================
const STATUS_ORDER = [
  'WAITING_OWNER_CONFIRMATION',
  'CONFIRMED',
  'PICKUP_ON_THE_WAY',
  'LAUNDRY_PICKED',
  'PROCESSING',
  'READY_FOR_DELIVERY',
  'DELIVERY_ON_THE_WAY',
  'DELIVERED',
  'COMPLETED'
];

const getStatusIndex = (status) => STATUS_ORDER.indexOf(status);

// ============================================
// 3.1. Create Order
// POST /orders
// Auth: Bearer Token (role: customer)
// ============================================
exports.createOrder = async (req, res) => {
  const { service_id, pickup_address, pickup_lat, pickup_lng, pickup_scheduled_at } = req.body;
  const customer_id = req.user.id;

  // Validasi
  const errors = {};
  if (!service_id) errors.service_id = ['service_id wajib diisi'];
  if (pickup_lat !== undefined && pickup_lat !== null && (isNaN(parseFloat(pickup_lat)) || parseFloat(pickup_lat) < -90 || parseFloat(pickup_lat) > 90)) {
    errors.pickup_lat = ['pickup_lat harus antara -90 dan 90'];
  }
  if (pickup_lng !== undefined && pickup_lng !== null && (isNaN(parseFloat(pickup_lng)) || parseFloat(pickup_lng) < -180 || parseFloat(pickup_lng) > 180)) {
    errors.pickup_lng = ['pickup_lng harus antara -180 dan 180'];
  }
  if (pickup_scheduled_at && !isValidDatetime(pickup_scheduled_at)) {
    errors.pickup_scheduled_at = ['pickup_scheduled_at harus format datetime valid'];
  }

  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ success: false, message: 'Validation error', errors });
  }

  const connection = await pool.getConnection();
  try {
    // 1. Cek service exists dan active
    const [services] = await connection.query('SELECT * FROM services WHERE service_id = ? AND is_active = 1', [service_id]);
    if (services.length === 0) {
      connection.release();
      return res.status(404).json({ success: false, message: 'Service not found or inactive' });
    }

    const service = services[0];
    await connection.beginTransaction();

    // 2. Generate IDs
    const timestamp = Date.now();
    const orderId = `ORD${timestamp}`;
    const invoiceId = `INV${timestamp}`;

    // 3. Buat order — simpan owner_id dari service, snapshot harga
    await connection.query(
      `INSERT INTO orders (order_id, customer_id, owner_id, service_id, pickup_address, pickup_lat, pickup_lng, pickup_scheduled_at, 
       price_per_kg_owner, price_per_kg_customer, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAITING_OWNER_CONFIRMATION')`,
      [orderId, customer_id, service.owner_id, service_id, pickup_address || null, pickup_lat || null, pickup_lng || null, 
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

    // 6. Notifikasi ke owner
    await createNotification(connection, service.owner_id, 'Order Baru',
      `Pesanan baru ${orderId} dari customer. Silakan konfirmasi.`);

    await connection.commit();
    connection.release();

    res.status(201).json({
      success: true,
      message: 'Order created',
      data: {
        order_id: orderId,
        invoice_id: invoiceId,
        owner_id: service.owner_id,
        status: 'WAITING_OWNER_CONFIRMATION',
        pickup_scheduled_at: pickup_scheduled_at || null
      }
    });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('createOrder error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
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
      success: true,
      message: 'Success',
      data: orders,
      pagination: { page: pageNum, limit: limitNum, total }
    });
  } catch (err) {
    console.error('getMyOrders error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 3.3. Get Order Detail
// GET /orders/:order_id
// Auth: Bearer Token (customer/owner/courier/admin)
// Authorization:
//   - customer: hanya order miliknya
//   - owner: hanya order milik owner_id-nya
//   - courier: hanya order yang di-assign ke dirinya
//   - admin: semua
// ============================================
exports.getOrderDetail = async (req, res) => {
  const { order_id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const [orders] = await pool.query(
      `SELECT o.*, s.name AS service_name, s.price_per_kg_customer AS service_price
       FROM orders o
       LEFT JOIN services s ON o.service_id = s.service_id
       WHERE o.order_id = ?`,
      [order_id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const order = orders[0];

    // Authorization check
    if (userRole === 'customer' && order.customer_id !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden: not your order' });
    }
    if (userRole === 'owner' && order.owner_id !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden: not your order' });
    }
    if (userRole === 'courier') {
      const [assignments] = await pool.query(
        'SELECT assignment_id FROM courier_assignments WHERE order_id = ? AND courier_id = ?',
        [order_id, userId]
      );
      if (assignments.length === 0) {
        return res.status(403).json({ success: false, message: 'Forbidden: not assigned to you' });
      }
    }

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
      success: true,
      message: 'Success',
      data: {
        order_id: order.order_id,
        customer_id: order.customer_id,
        owner_id: order.owner_id,
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
        pickup_address: order.pickup_address,
        pickup_scheduled_at: order.pickup_scheduled_at,
        status_history: statusHistory,
        created_at: order.created_at
      }
    });
  } catch (err) {
    console.error('getOrderDetail error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 3.4. Update Order Status (Owner)
// PATCH /orders/:order_id/status
// Auth: Bearer Token (role: owner, verified)
// Valid transitions by owner:
//   WAITING_OWNER_CONFIRMATION → CONFIRMED
//   PROCESSING → READY_FOR_DELIVERY
// Note: LAUNDRY_PICKED → PROCESSING dilakukan oleh payment callback
// ============================================
exports.updateOrderStatus = async (req, res) => {
  const { order_id } = req.params;
  const { status } = req.body;
  const userId = req.user.id;

  const validOwnerStatuses = ['CONFIRMED', 'READY_FOR_DELIVERY'];

  if (!status || !validOwnerStatuses.includes(status)) {
    return res.status(422).json({ success: false, message: `Invalid status. Owner can set: ${validOwnerStatuses.join(', ')}` });
  }

  try {
    // Cek order ada dan milik owner ini
    const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ? AND owner_id = ?', [order_id, userId]);
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found or not owned by you' });
    }

    // Status flow validation
    const statusFlow = {
      'WAITING_OWNER_CONFIRMATION': ['CONFIRMED'],
      'PROCESSING': ['READY_FOR_DELIVERY']
    };

    const currentStatus = orders[0].status;
    const allowed = statusFlow[currentStatus] || [];
    if (!allowed.includes(status)) {
      return res.status(422).json({ success: false, message: `Invalid status transition. Current: ${currentStatus}, allowed: ${allowed.join(', ') || 'none'}` });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    await connection.query('UPDATE orders SET status = ? WHERE order_id = ?', [status, order_id]);
    await connection.query(
      'INSERT INTO order_status_logs (order_id, status, changed_by) VALUES (?, ?, ?)',
      [order_id, status, userId]
    );

    // Notifikasi
    if (status === 'CONFIRMED') {
      await createNotification(connection, orders[0].customer_id, 'Order Dikonfirmasi',
        `Pesanan ${order_id} telah dikonfirmasi oleh owner.`);
    } else if (status === 'READY_FOR_DELIVERY') {
      await createNotification(connection, orders[0].customer_id, 'Laundry Siap Diantar',
        `Pesanan ${order_id} telah selesai diproses dan siap untuk delivery.`);
    }

    await connection.commit();
    connection.release();

    res.json({
      success: true,
      message: 'Status updated',
      data: { order_id, status }
    });
  } catch (err) {
    console.error('updateOrderStatus error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 3.5. Assign Courier (Owner)
// POST /orders/:order_id/assign-courier
// Auth: Bearer Token (role: owner, verified)
// Courier locking — 1 kurir = pickup + delivery
// ============================================
exports.assignCourier = async (req, res) => {
  const { order_id } = req.params;
  const { courier_id } = req.body;
  const userId = req.user.id;

  if (!courier_id) {
    return res.status(422).json({ success: false, message: 'Validation error', errors: { courier_id: ['courier_id wajib diisi'] } });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Cek order ada, milik owner ini, dan statusnya CONFIRMED
    const [orders] = await connection.query('SELECT * FROM orders WHERE order_id = ? AND owner_id = ?', [order_id, userId]);
    if (orders.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, message: 'Order not found or not owned by you' });
    }

    if (orders[0].status !== 'CONFIRMED') {
      await connection.rollback();
      connection.release();
      return res.status(422).json({ success: false, message: 'Order must be CONFIRMED before assigning courier' });
    }

    // Cek kurir ada, role-nya courier, dan sudah verified
    const [couriers] = await connection.query(
      "SELECT user_id, is_verified FROM users WHERE user_id = ? AND role = 'courier'", [courier_id]
    );
    if (couriers.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, message: 'Courier not found' });
    }
    if (!couriers[0].is_verified) {
      await connection.rollback();
      connection.release();
      return res.status(422).json({ success: false, message: 'Courier has not been verified by admin' });
    }

    // Cek apakah sudah ada assignment (courier locking — tidak boleh ganti)
    const [existingAssignment] = await connection.query(
      'SELECT assignment_id FROM courier_assignments WHERE order_id = ?',
      [order_id]
    );
    if (existingAssignment.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(409).json({ success: false, message: 'Courier already locked for this order. Cannot reassign.' });
    }

    const assignmentId = `ASG${Date.now()}`;

    await connection.query(
      `INSERT INTO courier_assignments (assignment_id, order_id, courier_id, current_phase, locked) 
       VALUES (?, ?, ?, 'pickup', 1)`,
      [assignmentId, order_id, courier_id]
    );

    // Notifikasi ke courier
    await createNotification(connection, courier_id, 'Tugas Baru',
      `Anda ditugaskan untuk order ${order_id}. Silakan mulai pickup.`);

    await connection.commit();
    connection.release();

    res.status(201).json({
      success: true,
      message: 'Courier assigned and locked',
      data: {
        assignment_id: assignmentId,
        order_id,
        courier_id: parseInt(courier_id),
        locked: true,
        covers: ['pickup', 'delivery']
      }
    });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('assignCourier error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 3.6. Input Berat Laundry (Owner)
// PATCH /orders/:order_id/weight
// Auth: Bearer Token (role: owner, verified)
// Hanya boleh dilakukan saat status LAUNDRY_PICKED
//
// Distance calculation priority:
//   1. Haversine dari koordinat pickup customer + koordinat owner
//   2. Manual distance_km dari request body (jika ALLOW_MANUAL_DISTANCE=true)
//   3. Error jika keduanya tidak tersedia
// ============================================
exports.inputWeight = async (req, res) => {
  const { order_id } = req.params;
  const { weight_kg, distance_km: manualDistanceKm } = req.body;
  const userId = req.user.id;

  if (!weight_kg || !isPositiveNumber(weight_kg)) {
    return res.status(422).json({ success: false, message: 'Validation error', errors: { weight_kg: ['weight_kg wajib diisi dan > 0'] } });
  }

  // Validasi manual distance jika dikirim
  if (manualDistanceKm !== undefined && manualDistanceKm !== null && !isNonNegativeNumber(manualDistanceKm)) {
    return res.status(422).json({ success: false, message: 'Validation error', errors: { distance_km: ['distance_km harus >= 0'] } });
  }

  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ? AND owner_id = ?', [order_id, userId]);
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found or not owned by you' });
    }

    const order = orders[0];

    // Weight hanya bisa diinput saat LAUNDRY_PICKED
    if (order.status !== 'LAUNDRY_PICKED') {
      return res.status(422).json({ success: false, message: 'Weight can only be input when order status is LAUNDRY_PICKED' });
    }

    // --- Distance calculation ---
    // Prioritas 1: Haversine dari koordinat pickup customer + koordinat owner
    let distance_km = null;
    let distance_source = null;

    const hasPickupCoords = order.pickup_lat && order.pickup_lng;
    if (hasPickupCoords) {
      const [ownerData] = await pool.query('SELECT lat, lng FROM users WHERE user_id = ?', [userId]);
      const hasOwnerCoords = ownerData.length > 0 && ownerData[0].lat && ownerData[0].lng;

      if (hasOwnerCoords) {
        const customerLoc = { lat: parseFloat(order.pickup_lat), lng: parseFloat(order.pickup_lng) };
        const ownerLoc = { lat: parseFloat(ownerData[0].lat), lng: parseFloat(ownerData[0].lng) };
        distance_km = calculateDistanceKm(customerLoc, ownerLoc);
        distance_source = 'haversine';
      }
    }

    // Prioritas 2: Manual distance dari request body (fallback)
    if (distance_km === null && manualDistanceKm !== undefined && manualDistanceKm !== null) {
      if (!isManualDistanceAllowed()) {
        return res.status(422).json({
          success: false,
          message: 'Koordinat tidak lengkap dan manual distance tidak diizinkan. Pastikan koordinat pickup customer dan owner tersedia, atau set ALLOW_MANUAL_DISTANCE=true di .env.'
        });
      }
      distance_km = parseFloat(manualDistanceKm);
      distance_source = 'manual';
    }

    // Prioritas 3: Error
    if (distance_km === null) {
      return res.status(422).json({
        success: false,
        message: 'Tidak dapat menghitung jarak. Koordinat pickup customer dan/atau owner tidak lengkap. Pastikan data lat/lng tersedia, atau kirim distance_km manual di request body (jika ALLOW_MANUAL_DISTANCE=true).'
      });
    }

    const price_per_kg_owner = parseFloat(order.price_per_kg_owner);
    const price_per_kg_customer = parseFloat(order.price_per_kg_customer);
    const wkg = parseFloat(weight_kg);

    // Kalkulasi biaya sesuai dokumen requirement
    const service_fee = wkg * price_per_kg_customer;
    const delivery_fee = distance_km * 2 * 1500;
    const admin_commission = wkg * (price_per_kg_customer - price_per_kg_owner);
    const owner_earning = wkg * price_per_kg_owner;
    const courier_earning = distance_km * 2 * 1250;
    const total_amount = service_fee + delivery_fee;

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    // Update order dengan kalkulasi
    await connection.query(
      `UPDATE orders SET weight_kg = ?, distance_km = ?, service_fee = ?, delivery_fee = ?, 
       admin_commission = ?, owner_earning = ?, courier_earning = ?, total_amount = ?
       WHERE order_id = ?`,
      [wkg, distance_km, service_fee, delivery_fee, admin_commission, owner_earning, courier_earning, total_amount, order_id]
    );

    // Update invoice
    await connection.query(
      `UPDATE invoices SET amount = ?, service_fee = ?, delivery_fee = ? WHERE order_id = ?`,
      [total_amount, service_fee, delivery_fee, order_id]
    );

    // Kirim notifikasi ke customer
    await createNotification(connection, order.customer_id, 'Invoice Siap',
      `Pesanan ${order_id} sudah dihitung. Total: Rp${total_amount.toLocaleString('id-ID')}. Silakan lakukan pembayaran.`);

    await connection.commit();
    connection.release();

    res.json({
      success: true,
      message: 'Weight updated and costs calculated',
      data: {
        weight_kg: wkg,
        distance_km,
        distance_source,
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
    console.error('inputWeight error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 3.7. Aktifkan Fase Delivery (Owner)
// PATCH /orders/:order_id/activate-delivery
// Auth: Bearer Token (role: owner, verified)
// ============================================
exports.activateDelivery = async (req, res) => {
  const { order_id } = req.params;
  const userId = req.user.id;

  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ? AND owner_id = ?', [order_id, userId]);
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found or not owned by you' });
    }

    if (orders[0].status !== 'READY_FOR_DELIVERY') {
      return res.status(422).json({ success: false, message: 'Order must be READY_FOR_DELIVERY' });
    }

    // Switch courier phase ke delivery
    const [assignments] = await pool.query('SELECT * FROM courier_assignments WHERE order_id = ?', [order_id]);
    if (assignments.length === 0) {
      return res.status(404).json({ success: false, message: 'No courier assigned' });
    }

    await pool.query(
      `UPDATE courier_assignments SET current_phase = 'delivery' WHERE order_id = ?`,
      [order_id]
    );

    // Notifikasi ke courier
    await createNotification(pool, assignments[0].courier_id, 'Fase Delivery Dimulai',
      `Order ${order_id} siap diantar. Silakan mulai delivery.`);

    res.json({
      success: true,
      message: 'Courier phase switched to delivery',
      data: {
        order_id,
        courier_id: assignments[0].courier_id,
        current_phase: 'delivery'
      }
    });
  } catch (err) {
    console.error('activateDelivery error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 3.8. Track Order
// GET /orders/:order_id/tracking
// Auth: Bearer Token (customer owner, order owner, assigned courier, admin)
// ============================================
exports.trackOrder = async (req, res) => {
  const { order_id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    // Cek order
    const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [order_id]);
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const order = orders[0];

    // Authorization
    if (userRole === 'customer' && order.customer_id !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden: not your order' });
    }
    if (userRole === 'owner' && order.owner_id !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden: not your order' });
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
      return res.status(404).json({ success: false, message: 'No courier assigned for this order' });
    }

    const assignment = assignments[0];

    // Courier only sees own assignments
    if (userRole === 'courier' && assignment.courier_id !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden: not assigned to you' });
    }

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
      success: true,
      message: 'Success',
      data: {
        order_status: order.status,
        courier: { name: assignment.courier_name, vehicle: assignment.vehicle_name },
        location: locations.length > 0 ? { lat: locations[0].lat, lng: locations[0].lng, updated_at: locations[0].updated_at } : null,
        current_phase: assignment.current_phase,
        task_status
      }
    });
  } catch (err) {
    console.error('trackOrder error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 3.9. Customer Konfirmasi Pesanan Selesai
// PATCH /orders/:order_id/complete
// Auth: Bearer Token (role: customer)
// HANYA customer pemilik order yang boleh menyelesaikan
// IDEMPOTENT: jika sudah COMPLETED, return success tanpa proses ulang
// ============================================
exports.completeOrder = async (req, res) => {
  const { order_id } = req.params;
  const customer_id = req.user.id;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [orders] = await connection.query('SELECT * FROM orders WHERE order_id = ?', [order_id]);
    if (orders.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const order = orders[0];

    // Hanya customer pemilik order
    if (order.customer_id !== customer_id) {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ success: false, message: 'Forbidden: only the customer who owns this order can complete it' });
    }

    // IDEMPOTENT: jika sudah COMPLETED, return success
    if (order.status === 'COMPLETED') {
      await connection.rollback();
      connection.release();
      return res.json({
        success: true,
        message: 'Order already completed',
        data: { order_id, status: 'COMPLETED', balance_released: true }
      });
    }

    if (order.status !== 'DELIVERED') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ success: false, message: 'Order must be DELIVERED before completing' });
    }

    // 1. Update order status → COMPLETED
    await connection.query('UPDATE orders SET status = ? WHERE order_id = ?', ['COMPLETED', order_id]);

    // 2. Catat status log
    await connection.query(
      'INSERT INTO order_status_logs (order_id, status, changed_by) VALUES (?, ?, ?)',
      [order_id, 'COMPLETED', customer_id]
    );

    // 3. Release pending balance → available balance
    // HANYA untuk owner dan courier (bukan admin — admin sudah available saat payment)
    const [pendingTxns] = await connection.query(
      `SELECT wt.transaction_id, wt.wallet_id, wt.amount, w.user_id, w.role
       FROM wallet_transactions wt
       JOIN wallets w ON wt.wallet_id = w.wallet_id
       WHERE wt.order_id = ? AND wt.type = 'credit' AND wt.status = 'pending' AND w.role IN ('owner', 'courier')`,
      [order_id]
    );

    const releasedTo = {};
    for (const txn of pendingTxns) {
      await connection.query(
        `UPDATE wallets SET available_balance = available_balance + ?, pending_balance = pending_balance - ? WHERE wallet_id = ?`,
        [txn.amount, txn.amount, txn.wallet_id]
      );
      await connection.query(
        `UPDATE wallet_transactions SET status = 'available' WHERE transaction_id = ?`,
        [txn.transaction_id]
      );
      releasedTo[txn.role] = { amount: parseFloat(txn.amount), wallet_id: txn.wallet_id };
    }

    // 4. Update courier assignment delivery_status to DONE if not already
    await connection.query(
      `UPDATE courier_assignments SET delivery_status = 'DONE' WHERE order_id = ? AND (delivery_status IS NULL OR delivery_status != 'DONE')`,
      [order_id]
    );

    // 5. Notifikasi
    if (order.owner_id) {
      await createNotification(connection, order.owner_id, 'Order Selesai',
        `Pesanan ${order_id} telah dikonfirmasi selesai oleh customer. Saldo Anda telah dirilis ke available balance.`);
    }
    const [assignments] = await connection.query('SELECT courier_id FROM courier_assignments WHERE order_id = ?', [order_id]);
    if (assignments.length > 0) {
      await createNotification(connection, assignments[0].courier_id, 'Order Selesai',
        `Pesanan ${order_id} selesai. Saldo Anda telah dirilis ke available balance.`);
    }

    await connection.commit();
    connection.release();

    res.json({
      success: true,
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
    await connection.rollback();
    connection.release();
    console.error('completeOrder error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
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
      success: true,
      message: 'Success',
      data: orders,
      summary: { total_orders: total, total_spent: parseFloat(totalSpentResult[0].total_spent) },
      pagination: { page: pageNum, limit: limitNum, total }
    });
  } catch (err) {
    console.error('getOrderHistory error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
