const crypto = require('crypto');
const pool = require('../config/db');
const { createNotification } = require('../helpers/notification');
const { isValidEnum } = require('../helpers/validators');

// Status order dalam urutan (untuk cek apakah status sudah lewat PROCESSING)
const STATUS_ORDER = [
  'WAITING_OWNER_CONFIRMATION', 'CONFIRMED', 'PICKUP_ON_THE_WAY', 'LAUNDRY_PICKED',
  'PROCESSING', 'READY_FOR_DELIVERY', 'DELIVERY_ON_THE_WAY', 'DELIVERED', 'COMPLETED'
];

// ============================================
// 4.1. Lihat Invoice
// GET /payments/invoice/:invoice_id
// Auth: Bearer Token (role: customer)
// Customer hanya bisa lihat invoice miliknya
// ============================================
exports.getInvoice = async (req, res) => {
  const { invoice_id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const [invoices] = await pool.query(
      `SELECT i.*, o.customer_id, o.owner_id 
       FROM invoices i 
       JOIN orders o ON i.order_id = o.order_id 
       WHERE i.invoice_id = ?`,
      [invoice_id]
    );
    if (invoices.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const inv = invoices[0];

    // Authorization
    if (userRole === 'customer' && inv.customer_id !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden: not your invoice' });
    }
    if (userRole === 'owner' && inv.owner_id !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden: not your order' });
    }

    res.json({
      success: true,
      message: 'Success',
      data: {
        invoice_id: inv.invoice_id,
        order_id: inv.order_id,
        amount: inv.amount,
        breakdown: {
          service_fee: inv.service_fee,
          delivery_fee: inv.delivery_fee
        },
        status: inv.status
      }
    });
  } catch (err) {
    console.error('getInvoice error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 4.2. Bayar Invoice
// POST /payments
// Auth: Bearer Token (role: customer)
// ============================================
exports.createPayment = async (req, res) => {
  const { invoice_id, payment_method } = req.body;
  const user_id = req.user.id;

  // Validasi
  const errors = {};
  if (!invoice_id) errors.invoice_id = ['invoice_id wajib diisi'];
  if (!payment_method) {
    errors.payment_method = ['payment_method wajib diisi'];
  } else {
    const validMethods = ['virtual_account', 'transfer', 'e_wallet'];
    if (!isValidEnum(payment_method, validMethods)) {
      errors.payment_method = [`payment_method harus salah satu: ${validMethods.join(', ')}. Cash payment belum didukung untuk pembayaran online.`];
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ success: false, message: 'Validation error', errors });
  }

  try {
    // Cek invoice exists
    const [invoices] = await pool.query(
      `SELECT i.*, o.customer_id FROM invoices i JOIN orders o ON i.order_id = o.order_id WHERE i.invoice_id = ?`,
      [invoice_id]
    );
    if (invoices.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const invoice = invoices[0];

    // Cek invoice milik customer yang login
    if (invoice.customer_id !== user_id) {
      return res.status(403).json({ success: false, message: 'Forbidden: not your invoice' });
    }

    if (invoice.status === 'paid') {
      return res.status(400).json({ success: false, message: 'Invoice already paid' });
    }

    if (!invoice.amount || invoice.amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invoice amount not yet calculated. Owner must input weight first.' });
    }

    const paymentId = `PAY${Date.now()}`;
    const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const vaNumber = '8808' + Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');

    await pool.query(
      `INSERT INTO payments (payment_id, invoice_id, user_id, payment_method, amount, status, va_number, expired_at) 
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [paymentId, invoice_id, user_id, payment_method, invoice.amount, vaNumber, expiredAt]
    );

    res.status(201).json({
      success: true,
      message: 'Payment created',
      data: {
        payment_id: paymentId,
        amount: parseFloat(invoice.amount),
        va_number: vaNumber,
        expired_at: expiredAt.toISOString(),
        status: 'pending'
      }
    });
  } catch (err) {
    console.error('createPayment error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 4.3. Payment Callback (Payment Gateway)
// POST /payments/callback
// Auth: Validasi via HMAC-SHA256 signature
//
// Signature format:
//   Header: X-Payment-Signature
//   Canonical string: payment_id|status|amount|timestamp
//   HMAC-SHA256 dengan PAYMENT_GATEWAY_SECRET
//
// IDEMPOTENT: payment yang sudah success tidak akan diproses ulang
// ============================================
exports.paymentCallback = async (req, res) => {
  const { payment_id, status, amount, timestamp } = req.body;

  // Validasi input
  if (!payment_id || !status) {
    return res.status(400).json({ success: false, message: 'payment_id and status required' });
  }

  if (!['success', 'failed'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid payment status. Must be success or failed.' });
  }

  // Validasi signature
  const secret = process.env.PAYMENT_GATEWAY_SECRET;
  if (secret && secret !== 'change_this_payment_secret') {
    const signature = req.headers['x-payment-signature'];
    if (!signature) {
      return res.status(401).json({ success: false, message: 'Missing payment signature' });
    }

    // Canonical string: payment_id|status|amount|timestamp
    const canonicalString = `${payment_id}|${status}|${amount || ''}|${timestamp || ''}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(canonicalString).digest('hex');

    if (signature !== expectedSignature) {
      return res.status(403).json({ success: false, message: 'Invalid payment signature' });
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Cek payment
    const [payments] = await connection.query('SELECT * FROM payments WHERE payment_id = ?', [payment_id]);
    if (payments.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const payment = payments[0];

    // IDEMPOTENT: jika payment sudah success, return ok tanpa proses ulang
    if (payment.status === 'success') {
      await connection.rollback();
      connection.release();
      return res.json({ success: true, message: 'Payment already processed as success. No action taken.' });
    }

    // Jika payment sudah failed, jangan proses lagi
    if (payment.status === 'failed' && status === 'success') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ success: false, message: 'Cannot mark a failed payment as success' });
    }

    if (status === 'failed') {
      await connection.query('UPDATE payments SET status = ? WHERE payment_id = ?', ['failed', payment_id]);
      // JANGAN update invoice ke paid dan JANGAN distribusi wallet
      await connection.commit();
      connection.release();
      return res.json({ success: true, message: 'Callback processed. Payment marked as failed.' });
    }

    // --- Status = success ---

    // 2. Update payment
    await connection.query(
      'UPDATE payments SET status = ?, paid_at = NOW() WHERE payment_id = ?',
      ['success', payment_id]
    );

    // 3. Update invoice → paid
    await connection.query('UPDATE invoices SET status = ? WHERE invoice_id = ?', ['paid', payment.invoice_id]);

    // 4. Ambil order
    const [invoices] = await connection.query('SELECT order_id FROM invoices WHERE invoice_id = ?', [payment.invoice_id]);
    const order_id = invoices[0].order_id;

    const [orders] = await connection.query('SELECT * FROM orders WHERE order_id = ?', [order_id]);
    const order = orders[0];

    // 5. Update order status → PROCESSING
    // JANGAN downgrade status jika sudah lebih tinggi dari PROCESSING
    const currentIndex = STATUS_ORDER.indexOf(order.status);
    const processingIndex = STATUS_ORDER.indexOf('PROCESSING');

    if (currentIndex < processingIndex) {
      await connection.query('UPDATE orders SET status = ? WHERE order_id = ?', ['PROCESSING', order_id]);
      await connection.query(
        'INSERT INTO order_status_logs (order_id, status, changed_by) VALUES (?, ?, NULL)',
        [order_id, 'PROCESSING']
      );
    }

    // 6. Distribusi saldo ke PENDING BALANCE wallet
    // IDEMPOTENT: cek apakah sudah ada wallet_transactions untuk order ini
    const [existingTxns] = await connection.query(
      `SELECT transaction_id FROM wallet_transactions WHERE order_id = ? AND type = 'credit'`,
      [order_id]
    );

    if (existingTxns.length === 0) {
      // Belum pernah distribusi — lakukan sekarang
      const ownerEarning = parseFloat(order.owner_earning) || 0;
      const courierEarning = parseFloat(order.courier_earning) || 0;
      const adminCommission = parseFloat(order.admin_commission) || 0;

      // Owner earning → pending balance
      if (order.owner_id && ownerEarning > 0) {
        const [ownerWallet] = await connection.query('SELECT wallet_id FROM wallets WHERE user_id = ?', [order.owner_id]);
        if (ownerWallet.length > 0) {
          const txnId = `TXN${Date.now()}A`;
          await connection.query(
            `INSERT INTO wallet_transactions (transaction_id, wallet_id, type, amount, status, description, order_id, source) 
             VALUES (?, ?, 'credit', ?, 'pending', ?, ?, ?)`,
            [txnId, ownerWallet[0].wallet_id, ownerEarning, `Pendapatan order ${order_id}`, order_id, `order:${order_id}`]
          );
          await connection.query(
            'UPDATE wallets SET pending_balance = pending_balance + ?, total_earned = total_earned + ? WHERE wallet_id = ?',
            [ownerEarning, ownerEarning, ownerWallet[0].wallet_id]
          );
        }
      }

      // Courier earning → pending balance
      const [assignments] = await connection.query(
        'SELECT courier_id FROM courier_assignments WHERE order_id = ?', [order_id]
      );
      if (assignments.length > 0 && courierEarning > 0) {
        const courierId = assignments[0].courier_id;
        const [courierWallet] = await connection.query('SELECT wallet_id FROM wallets WHERE user_id = ?', [courierId]);
        if (courierWallet.length > 0) {
          const txnId = `TXN${Date.now()}B`;
          await connection.query(
            `INSERT INTO wallet_transactions (transaction_id, wallet_id, type, amount, status, description, order_id, source) 
             VALUES (?, ?, 'credit', ?, 'pending', ?, ?, ?)`,
            [txnId, courierWallet[0].wallet_id, courierEarning, `Pendapatan order ${order_id}`, order_id, `order:${order_id}`]
          );
          await connection.query(
            'UPDATE wallets SET pending_balance = pending_balance + ?, total_earned = total_earned + ? WHERE wallet_id = ?',
            [courierEarning, courierEarning, courierWallet[0].wallet_id]
          );
        }
      }

      // Admin commission → langsung AVAILABLE (tidak perlu menunggu COMPLETED)
      if (adminCommission > 0) {
        const [adminWallet] = await connection.query("SELECT wallet_id FROM wallets WHERE role = 'admin' LIMIT 1");
        if (adminWallet.length > 0) {
          const txnId = `TXN${Date.now()}C`;
          await connection.query(
            `INSERT INTO wallet_transactions (transaction_id, wallet_id, type, amount, status, description, order_id, source) 
             VALUES (?, ?, 'credit', ?, 'available', ?, ?, ?)`,
            [txnId, adminWallet[0].wallet_id, adminCommission, `Komisi order ${order_id}`, order_id, `commission:${order_id}`]
          );
          await connection.query(
            'UPDATE wallets SET available_balance = available_balance + ?, total_earned = total_earned + ? WHERE wallet_id = ?',
            [adminCommission, adminCommission, adminWallet[0].wallet_id]
          );
        }
      }
    }

    // 7. Notifikasi
    await createNotification(connection, order.customer_id, 'Pembayaran Berhasil',
      `Pesanan ${order_id} telah dibayar dan sedang diproses.`);
    if (order.owner_id) {
      await createNotification(connection, order.owner_id, 'Pembayaran Diterima',
        `Pembayaran untuk order ${order_id} telah berhasil. Silakan proses laundry.`);
    }

    await connection.commit();
    connection.release();

    res.json({
      success: true,
      message: 'Callback processed successfully.',
      data: {
        payment_id,
        status: 'success',
        order_id,
        wallet_distributed: existingTxns.length === 0
      }
    });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('paymentCallback error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
