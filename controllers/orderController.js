const crypto = require('crypto');
const pool = require('../config/db');

// ============================================
// Membuat order baru
// POST /orders
// Auth: Bearer Token (role: customer)
// ============================================
exports.createOrder = async (req, res) => {
  const { service_id, pickup_address, pickup_lat, pickup_lng, pickup_scheduled_at } = req.body;
  const customer_id = req.user.id;

  // Validasi input
  if (!service_id) {
    return res.status(422).json({
      message: 'Validation error',
      errors: { service_id: ['Service ID wajib diisi'] }
    });
  }

  const connection = await pool.getConnection();

  try {
    // 1. Ambil data layanan untuk mendapatkan owner
    const [services] = await connection.query(
      'SELECT * FROM laundry_services WHERE id = ? AND is_active = TRUE', 
      [service_id]
    );
    
    if (services.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Service not found' });
    }

    const service = services[0];
    const owner_id = service.owner_id;

    // 2. Cek apakah customer sudah punya active order di laundry ini
    const [activeOrders] = await connection.query(
      `SELECT id FROM orders 
       WHERE customer_id = ? AND owner_id = ? 
       AND status NOT IN ('completed', 'cancelled')`,
      [customer_id, owner_id]
    );

    if (activeOrders.length > 0) {
      connection.release();
      return res.status(409).json({ message: 'Customer already has an active order at this laundry' });
    }

    // 3. Gunakan transaksi database
    await connection.beginTransaction();

    const orderId = crypto.randomUUID();
    const invoiceId = crypto.randomUUID();

    // 4. Buat order (amount = 0 karena weight belum diketahui, diisi setelah pickup)
    await connection.query(
      `INSERT INTO orders (id, customer_id, owner_id, service_id, pickup_address, pickup_lat, pickup_lng, pickup_scheduled_at, total_amount, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending_payment')`,
      [orderId, customer_id, owner_id, service_id, pickup_address || null, pickup_lat || null, pickup_lng || null, pickup_scheduled_at || null]
    );

    // 5. Generate invoice number (format: INV/YYYY/MM/NNN)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    
    const [countResult] = await connection.query(
      `SELECT COUNT(*) as cnt FROM invoices WHERE invoice_number LIKE ?`,
      [`INV/${year}/${month}/%`]
    );
    const seqNum = String((countResult[0].cnt || 0) + 1).padStart(3, '0');
    const invoiceNumber = `INV/${year}/${month}/${seqNum}`;

    // 6. Otomatis buat invoice
    await connection.query(
      `INSERT INTO invoices (id, order_id, invoice_number, amount, status) 
       VALUES (?, ?, ?, 0, 'unpaid')`,
      [invoiceId, orderId, invoiceNumber]
    );

    // 7. Catat status log
    await connection.query(
      `INSERT INTO order_status_logs (id, order_id, status, notes, created_by) 
       VALUES (?, ?, 'pending_payment', 'Order created', ?)`,
      [crypto.randomUUID(), orderId, customer_id]
    );

    await connection.commit();
    connection.release();

    res.status(201).json({
      message: 'Order created',
      data: {
        order_id: orderId,
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
        amount: 0,
        status: 'pending_payment',
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
// Pesanan saya (customer yang login)
// GET /orders/my-orders?status=&page=1&limit=10
// Auth: Bearer Token
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

    if (status === 'active') {
      whereConditions.push("o.status NOT IN ('completed', 'cancelled')");
    } else if (status) {
      whereConditions.push('o.status = ?');
      params.push(status);
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    // Count
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM orders o ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    // Fetch
    const [orders] = await pool.query(
      `SELECT o.id AS order_id,
              op.shop_name,
              ls.name AS service_name,
              o.status,
              o.pickup_scheduled_at,
              o.total_amount
       FROM orders o
       LEFT JOIN owner_profiles op ON o.owner_id = op.user_id
       LEFT JOIN laundry_services ls ON o.service_id = ls.id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      message: 'Success',
      data: orders,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// Melihat detail order
// GET /orders/:id
// Auth: Bearer Token
// ============================================
exports.getOrderById = async (req, res) => {
  const { id } = req.params;

  try {
    const [orders] = await pool.query(
      `SELECT o.*, 
              op.shop_name,
              ls.name AS service_name
       FROM orders o
       LEFT JOIN owner_profiles op ON o.owner_id = op.user_id
       LEFT JOIN laundry_services ls ON o.service_id = ls.id
       WHERE o.id = ?`,
      [id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Ambil juga data invoice
    const [invoices] = await pool.query('SELECT * FROM invoices WHERE order_id = ?', [id]);

    res.json({
      message: 'Success',
      data: {
        ...orders[0],
        invoice: invoices.length > 0 ? invoices[0] : null
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// Update status order (Owner)
// PATCH /orders/:order_id/status
// Auth: Bearer Token (role: owner)
// ============================================
exports.updateOrderStatus = async (req, res) => {
  const { order_id } = req.params;
  const { status, notes } = req.body;
  const userId = req.user.id;

  const validStatuses = [
    'pending_payment', 'confirmed', 'pickup_scheduled', 'picked_up',
    'washing', 'drying', 'finished',
    'delivering', 'delivered', 'completed', 'cancelled'
  ];

  if (!status || !validStatuses.includes(status)) {
    return res.status(422).json({ message: 'Invalid status transition' });
  }

  try {
    // Cek order ada dan milik owner ini
    const [orders] = await pool.query(
      'SELECT * FROM orders WHERE id = ?',
      [order_id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (orders[0].owner_id !== userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    // Update status order
    await connection.query(
      'UPDATE orders SET status = ? WHERE id = ?',
      [status, order_id]
    );

    // Catat di order_status_logs
    await connection.query(
      `INSERT INTO order_status_logs (id, order_id, status, notes, created_by) 
       VALUES (?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), order_id, status, notes || null, userId]
    );

    await connection.commit();
    connection.release();

    res.json({
      message: 'Status updated',
      data: {
        order_id,
        status,
        updated_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// Assign kurir ke order (Owner)
// POST /orders/:order_id/assign-courier
// Auth: Bearer Token (role: owner)
// ============================================
exports.assignCourier = async (req, res) => {
  const { order_id } = req.params;
  const { courier_id, task_type } = req.body;
  const userId = req.user.id;

  // Validasi task_type
  if (!task_type || !['pickup', 'delivery'].includes(task_type)) {
    return res.status(422).json({
      message: 'Validation error',
      errors: { task_type: ['Task type harus pickup atau delivery'] }
    });
  }

  if (!courier_id) {
    return res.status(422).json({
      message: 'Validation error',
      errors: { courier_id: ['Courier ID wajib diisi'] }
    });
  }

  try {
    // Cek order ada
    const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [order_id]);
    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Cek apakah user ini owner dari order
    if (orders[0].owner_id !== userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // Cek kurir ada dan role-nya courier
    const [couriers] = await pool.query(
      "SELECT id FROM users WHERE id = ? AND role = 'courier'",
      [courier_id]
    );
    if (couriers.length === 0) {
      return res.status(404).json({ message: 'Courier not found' });
    }

    // Cek apakah sudah ada assignment untuk task_type yang sama
    const [existingAssignment] = await pool.query(
      `SELECT id FROM courier_assignments 
       WHERE order_id = ? AND task_type = ? AND status != 'cancelled'`,
      [order_id, task_type]
    );
    if (existingAssignment.length > 0) {
      return res.status(409).json({ message: 'Courier already assigned for this task' });
    }

    const assignmentId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO courier_assignments (id, order_id, courier_id, task_type, status) 
       VALUES (?, ?, ?, ?, 'assigned')`,
      [assignmentId, order_id, courier_id, task_type]
    );

    res.status(201).json({
      message: 'Courier assigned successfully',
      data: {
        assignment_id: assignmentId,
        order_id,
        courier_id,
        task_type,
        status: 'assigned',
        assigned_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
