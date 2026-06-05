const crypto = require('crypto');
const midtransClient = require('midtrans-client');
const pool = require('../config/db');
const { createNotification } = require('../helpers/notification');
const { isValidEnum } = require('../helpers/validators');

// Status order dalam urutan (untuk cek apakah status sudah lewat PROCESSING)
const STATUS_ORDER = [
  'WAITING_OWNER_CONFIRMATION', 'CONFIRMED', 'PICKUP_ON_THE_WAY', 'LAUNDRY_PICKED',
  'PROCESSING', 'READY_FOR_DELIVERY', 'DELIVERY_ON_THE_WAY', 'DELIVERED', 'COMPLETED'
];

// ============================================
// Midtrans Snap Client (Sandbox)
// ============================================
const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY || '',
  clientKey: '' // Client key optional untuk backend
});

// ============================================
// 4.1. Lihat Invoice
// GET /payments/invoice/:invoice_id
// Auth: Bearer Token (customer/owner/admin)
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
// 4.2. Bayar Invoice (Midtrans Snap)
// POST /payments
// Auth: Bearer Token (role: customer)
//
// Flow:
//   1. Customer POST /payments → backend buat transaksi Midtrans Snap
//   2. Backend return snap_token + redirect_url
//   3. Frontend buka Snap payment page (redirect/popup)
//   4. Setelah bayar, Midtrans kirim notification ke POST /payments/callback
// ============================================
exports.createPayment = async (req, res) => {
  const { invoice_id, payment_method } = req.body;
  const user_id = req.user.id;

  // Validasi
  const errors = {};
  if (!invoice_id) errors.invoice_id = ['invoice_id wajib diisi'];

  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ success: false, message: 'Validation error', errors });
  }

  try {
    // Cek invoice exists
    const [invoices] = await pool.query(
      `SELECT i.*, o.customer_id, o.order_id FROM invoices i JOIN orders o ON i.order_id = o.order_id WHERE i.invoice_id = ?`,
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

    // Ambil data customer untuk Midtrans
    const [customers] = await pool.query('SELECT full_name, email FROM users WHERE user_id = ?', [user_id]);
    const customer = customers[0];

    const paymentId = `PAY${Date.now()}`;
    const grossAmount = Math.round(parseFloat(invoice.amount));

    // Simpan payment record dulu (status = pending)
    await pool.query(
      `INSERT INTO payments (payment_id, invoice_id, user_id, payment_method, amount, status) 
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [paymentId, invoice_id, user_id, payment_method || 'midtrans_snap', grossAmount]
    );

    // Buat transaksi Midtrans Snap
    const parameter = {
      transaction_details: {
        order_id: paymentId,
        gross_amount: grossAmount
      },
      item_details: [
        {
          id: invoice.order_id,
          price: Math.round(parseFloat(invoice.service_fee) || 0),
          quantity: 1,
          name: 'Service Fee - Laundry'
        },
        {
          id: `${invoice.order_id}-delivery`,
          price: Math.round(parseFloat(invoice.delivery_fee) || 0),
          quantity: 1,
          name: 'Delivery Fee'
        }
      ],
      customer_details: {
        first_name: customer.full_name,
        email: customer.email
      },
      callbacks: {
        finish: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/finish`
      }
    };

    const midtransResponse = await snap.createTransaction(parameter);

    // Update payment dengan snap token
    await pool.query(
      `UPDATE payments SET va_number = ? WHERE payment_id = ?`,
      [midtransResponse.token, paymentId]
    );

    res.status(201).json({
      success: true,
      message: 'Payment created via Midtrans Snap',
      data: {
        payment_id: paymentId,
        invoice_id,
        order_id: invoice.order_id,
        amount: grossAmount,
        snap_token: midtransResponse.token,
        redirect_url: midtransResponse.redirect_url,
        status: 'pending'
      }
    });
  } catch (err) {
    console.error('createPayment error:', err.message);

    // Midtrans error detail
    if (err.ApiResponse) {
      console.error('Midtrans API Response:', JSON.stringify(err.ApiResponse));
    }

    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
};

// ============================================
// 4.3. Payment Notification Callback (Midtrans)
// POST /payments/callback
// Auth: Validasi via Midtrans Signature Key
//
// Midtrans mengirim notification ke URL ini setiap kali status berubah.
// Signature key: SHA512(order_id + status_code + gross_amount + server_key)
//
// IDEMPOTENT: payment yang sudah success tidak akan diproses ulang
//
// Midtrans notification body contoh:
// {
//   "transaction_type": "on-us",
//   "transaction_time": "2026-06-05 10:00:00",
//   "transaction_status": "settlement",   ← paid
//   "transaction_id": "xxx",
//   "status_message": "midtrans payment notification",
//   "status_code": "200",
//   "signature_key": "SHA512(...)",
//   "order_id": "PAY1234567890",
//   "gross_amount": "47200.00",
//   "payment_type": "bank_transfer",
//   "fraud_status": "accept"
// }
// ============================================
exports.paymentCallback = async (req, res) => {
  const {
    order_id: paymentId,
    status_code: statusCode,
    gross_amount: grossAmount,
    signature_key: signatureKey,
    transaction_status: transactionStatus,
    fraud_status: fraudStatus
  } = req.body;

  // Validasi input dasar
  if (!paymentId || !statusCode || !grossAmount || !signatureKey) {
    return res.status(400).json({ success: false, message: 'Missing required notification fields' });
  }

  // Validasi Midtrans Signature Key
  // Format: SHA512(order_id + status_code + gross_amount + server_key)
  const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
  const expectedSignature = crypto
    .createHash('sha512')
    .update(paymentId + statusCode + grossAmount + serverKey)
    .digest('hex');

  if (signatureKey !== expectedSignature) {
    console.warn('[Payment] Invalid signature for payment:', paymentId);
    return res.status(403).json({ success: false, message: 'Invalid signature key' });
  }

  // Tentukan status pembayaran dari Midtrans transaction_status
  // settlement / capture = success
  // deny / cancel / expire = failed
  // pending = masih pending (abaikan, tunggu settlement)
  let paymentStatus;
  if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
    // capture: khusus credit card, cek fraud_status
    if (transactionStatus === 'capture' && fraudStatus !== 'accept') {
      paymentStatus = 'failed';
    } else {
      paymentStatus = 'success';
    }
  } else if (transactionStatus === 'deny' || transactionStatus === 'cancel' || transactionStatus === 'expire') {
    paymentStatus = 'failed';
  } else if (transactionStatus === 'pending') {
    // Pending — acknowledge tapi jangan proses wallet
    return res.json({ success: true, message: 'Notification received. Payment still pending.' });
  } else {
    return res.json({ success: true, message: `Notification received. Unhandled status: ${transactionStatus}` });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Cek payment
    const [payments] = await connection.query('SELECT * FROM payments WHERE payment_id = ?', [paymentId]);
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

    if (paymentStatus === 'failed') {
      await connection.query('UPDATE payments SET status = ? WHERE payment_id = ?', ['failed', paymentId]);
      await connection.commit();
      connection.release();
      return res.json({ success: true, message: 'Notification processed. Payment marked as failed.' });
    }

    // --- Status = success (settlement/capture) ---

    // 2. Update payment
    await connection.query(
      'UPDATE payments SET status = ?, payment_method = ?, paid_at = NOW() WHERE payment_id = ?',
      ['success', req.body.payment_type || 'midtrans', paymentId]
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
      message: 'Notification processed successfully.',
      data: {
        payment_id: paymentId,
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
