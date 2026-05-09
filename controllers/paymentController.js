const crypto = require('crypto');
const pool = require('../config/db');

// ============================================
// Membuat pembayaran
// POST /payments
// Auth: Bearer Token
// ============================================
exports.createPayment = async (req, res) => {
  const { invoice_id, payment_method } = req.body;

  if (!invoice_id || !payment_method) {
    return res.status(422).json({
      message: 'Validation error',
      errors: {
        ...((!invoice_id) && { invoice_id: ['Invoice ID wajib diisi'] }),
        ...((!payment_method) && { payment_method: ['Payment method wajib diisi'] })
      }
    });
  }

  try {
    // 1. Cek invoice
    const [invoices] = await pool.query('SELECT * FROM invoices WHERE id = ?', [invoice_id]);
    if (invoices.length === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoice = invoices[0];

    // Jika sudah lunas, tidak perlu bayar lagi
    if (invoice.status === 'paid') {
      return res.status(400).json({ message: 'Invoice already paid' });
    }

    // 2. Buat data payment di database
    const paymentId = crypto.randomUUID();
    const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 jam dari sekarang

    await pool.query(
      `INSERT INTO payments (id, invoice_id, provider, payment_method, amount, status) 
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [paymentId, invoice_id, 'Midtrans', payment_method, invoice.amount]
    );

    // 3. Simulasi response payment gateway
    // Di production: Integrate dengan Midtrans/Xendit API
    let responseData = {
      payment_id: paymentId,
      invoice_id,
      amount: invoice.amount,
      payment_method,
      status: 'pending'
    };

    // Tambah detail sesuai method
    if (payment_method === 'virtual_account') {
      responseData.virtual_account_number = '8808' + Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
      responseData.expired_at = expiredAt.toISOString();
    } else if (payment_method === 'qris') {
      responseData.qr_code_url = `https://api.sandbox.midtrans.com/v2/qris/${paymentId}`;
      responseData.expired_at = expiredAt.toISOString();
    } else if (payment_method === 'e-wallet') {
      responseData.payment_url = `https://payment.example.com/${paymentId}`;
      responseData.expired_at = expiredAt.toISOString();
    }

    res.status(201).json({
      message: 'Payment created',
      data: responseData
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// Callback Payment Gateway
// POST /payments/callback
// Auth: X-Signature header
// ============================================
exports.paymentCallback = async (req, res) => {
  const { invoice_id, status, paid_at, reference_no, signature } = req.body;
  const xSignature = req.header('X-Signature');

  // Validasi signature (simplified — di production gunakan HMAC-SHA256)
  if (!xSignature && !signature) {
    return res.status(403).json({ message: 'Invalid signature' });
  }

  // Validasi status yang diterima
  const validStatuses = ['paid', 'failed', 'expired'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid payment status' });
  }

  if (!invoice_id) {
    return res.status(400).json({ message: 'Invoice ID required' });
  }

  // Jika bukan paid, tidak perlu update lunas
  if (status !== 'paid') {
    // Update status payment saja
    await pool.query(
      'UPDATE payments SET status = ? WHERE invoice_id = ? AND status = ?',
      [status, invoice_id, 'pending']
    );
    return res.json({ message: 'Callback processed' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Update status payments → paid
    await connection.query(
      'UPDATE payments SET status = ?, paid_at = ?, external_reference = ? WHERE invoice_id = ? AND status = ?',
      ['paid', paid_at || new Date().toISOString(), reference_no || null, invoice_id, 'pending']
    );

    // 2. Update status invoices → paid
    await connection.query(
      'UPDATE invoices SET status = ? WHERE id = ?',
      ['paid', invoice_id]
    );

    // 3. Ambil order_id dari invoice
    const [invoices] = await connection.query('SELECT * FROM invoices WHERE id = ?', [invoice_id]);
    if (invoices.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Invoice not found' });
    }
    const real_order_id = invoices[0].order_id;

    // 4. Update status orders → confirmed
    await connection.query(
      'UPDATE orders SET status = ? WHERE id = ?',
      ['confirmed', real_order_id]
    );

    // 5. Catat di order_status_logs
    await connection.query(
      `INSERT INTO order_status_logs (id, order_id, status, notes) 
       VALUES (?, ?, 'confirmed', 'Payment confirmed via callback')`,
      [crypto.randomUUID(), real_order_id]
    );

    // 6. Buat notifikasi ke customer dan owner
    const [orders] = await connection.query('SELECT customer_id, owner_id FROM orders WHERE id = ?', [real_order_id]);
    if (orders.length > 0) {
      const { customer_id, owner_id } = orders[0];
      
      // Notifikasi ke customer
      await connection.query(
        `INSERT INTO notifications (id, user_id, subject, message, status) 
         VALUES (?, ?, ?, ?, 'sent')`,
        [crypto.randomUUID(), customer_id, 'Pembayaran Berhasil', 'Pembayaran Anda telah dikonfirmasi. Pesanan sedang diproses.']
      );

      // Notifikasi ke owner
      await connection.query(
        `INSERT INTO notifications (id, user_id, subject, message, status) 
         VALUES (?, ?, ?, ?, 'sent')`,
        [crypto.randomUUID(), owner_id, 'Pesanan Baru', 'Ada pesanan baru yang sudah dibayar. Silakan proses.']
      );
    }

    await connection.commit();
    connection.release();

    res.json({ message: 'Callback processed' });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
