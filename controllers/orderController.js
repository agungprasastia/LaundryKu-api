const pool = require('../config/db');

// Membuat order baru
exports.createOrder = async (req, res) => {
  const { service_id, weight } = req.body;
  const customer_id = req.user.id;

  const connection = await pool.getConnection();

  try {
    // 1. Ambil data layanan untuk mendapatkan harga dan owner
    const [services] = await connection.query('SELECT * FROM laundry_services WHERE id = ?', [service_id]);
    
    if (services.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Layanan tidak ditemukan' });
    }

    const service = services[0];
    const owner_id = service.owner_id;
    const total_amount = service.price_per_kg * weight;

    // 2. Gunakan transaksi database agar order dan invoice dibuat bersamaan
    await connection.beginTransaction();

    // 3. Buat order
    const [orderResult] = await connection.query(
      'INSERT INTO orders (customer_id, owner_id, service_id, total_amount) VALUES (?, ?, ?, ?)',
      [customer_id, owner_id, service_id, total_amount]
    );
    const order_id = orderResult.insertId;

    // 4. Otomatis buat invoice
    const [invoiceResult] = await connection.query(
      'INSERT INTO invoices (order_id, amount) VALUES (?, ?)',
      [order_id, total_amount]
    );
    const invoice_id = invoiceResult.insertId;

    await connection.commit();
    connection.release();

    res.status(201).json({
      message: 'Order berhasil dibuat',
      order: {
        id: order_id,
        customer_id,
        owner_id,
        service_id,
        total_amount,
        status: 'pending'
      },
      invoice: {
        id: invoice_id,
        order_id,
        amount: total_amount,
        status: 'unpaid'
      }
    });

  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// Melihat detail order
exports.getOrderById = async (req, res) => {
  const { id } = req.params;

  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order tidak ditemukan' });
    }

    const order = orders[0];

    // Opsional: ambil juga data invoice
    const [invoices] = await pool.query('SELECT * FROM invoices WHERE order_id = ?', [id]);
    const invoice = invoices.length > 0 ? invoices[0] : null;

    res.json({
      order,
      invoice
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};
