const crypto = require('crypto');
const pool = require('../config/db');
const { createNotification } = require('../helpers/notification');
const { generateId } = require('../helpers/idGenerator');

// Status order dalam urutan
const STATUS_ORDER = [
  'WAITING_OWNER_CONFIRMATION', 'CONFIRMED', 'PICKUP_ON_THE_WAY', 'LAUNDRY_PICKED',
  'PROCESSING', 'READY_FOR_DELIVERY', 'DELIVERY_ON_THE_WAY', 'DELIVERED', 'COMPLETED'
];

// ============================================
// Midtrans Snap Client (Sandbox)
// Hanya diinisialisasi jika USE_DUMMY_PAYMENT bukan 'true'
// ============================================
let snap = null;
// Set USE_DUMMY_PAYMENT=true di environment untuk mengaktifkan dummy mode
const useDummyPayment = process.env.USE_DUMMY_PAYMENT === 'true';

if (!useDummyPayment) {
  try {
    const midtransClient = require('midtrans-client');
    snap = new midtransClient.Snap({
      isProduction: false,
      serverKey: process.env.MIDTRANS_SERVER_KEY || '',
      clientKey: ''
    });
  } catch (err) {
    console.warn('[Payment] midtrans-client not installed. Set USE_DUMMY_PAYMENT=true untuk mode development.');
  }
}

// ============================================
// 4.1. Lihat Invoice
// GET /payments/invoice/:invoice_id
// FIX: Courier di-forbid (atau cek assignment)
// ============================================
exports.getInvoice = async (req, res) => {
  const { invoice_id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const [invoices] = await pool.query(
      `SELECT i.*, o.customer_id, o.owner_id, o.order_id
       FROM invoices i 
       JOIN orders o ON i.order_id = o.order_id 
       WHERE i.invoice_id = ?`,
      [invoice_id]
    );
    if (invoices.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const inv = invoices[0];

    // Authorization per role
    if (userRole === 'customer' && inv.customer_id !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden: not your invoice' });
    }
    if (userRole === 'owner' && inv.owner_id !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden: not your order' });
    }
    if (userRole === 'courier') {
      // Courier hanya bisa lihat invoice jika assigned ke order tersebut
      const [assignments] = await pool.query(
        'SELECT assignment_id FROM courier_assignments WHERE order_id = ? AND courier_id = ?',
        [inv.order_id, userId]
      );
      if (assignments.length === 0) {
        return res.status(403).json({ success: false, message: 'Forbidden: not assigned to this order' });
      }
    }
    // admin: semua diperbolehkan (tidak ada filter)

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
//
// FIX:
//   - Cek existing pending payment untuk invoice yang sama
//   - Dummy mode jika USE_DUMMY_PAYMENT=true
//   - generateId untuk payment_id
// ============================================
exports.createPayment = async (req, res) => {
  const { invoice_id } = req.body;
  const user_id = req.user.id;

  // Validasi
  const errors = {};
  if (!invoice_id) errors.invoice_id = ['invoice_id wajib diisi'];

  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ success: false, message: 'Validation error', errors });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // FIX: SELECT ... FOR UPDATE — lock invoice row untuk cegah race condition double payment
    const [invoices] = await connection.query(
      `SELECT i.*, o.customer_id, o.order_id FROM invoices i JOIN orders o ON i.order_id = o.order_id WHERE i.invoice_id = ? FOR UPDATE`,
      [invoice_id]
    );
    if (invoices.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const invoice = invoices[0];

    // Cek invoice milik customer yang login
    if (invoice.customer_id !== user_id) {
      await connection.rollback();
      return res.status(403).json({ success: false, message: 'Forbidden: not your invoice' });
    }

    if (invoice.status === 'paid') {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Invoice already paid' });
    }

    if (!invoice.amount || invoice.amount <= 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Invoice amount not yet calculated. Owner must input weight first.' });
    }

    // FIX: Cek existing pending payment dengan lock — concurrent requests serialize disini
    const [existingPending] = await connection.query(
      "SELECT payment_id, va_number FROM payments WHERE invoice_id = ? AND status IN ('pending', 'success') FOR UPDATE",
      [invoice_id]
    );
    if (existingPending.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: 'Payment already created for this invoice. Use the existing payment.',
        data: {
          payment_id: existingPending[0].payment_id,
          snap_token: existingPending[0].va_number, // snap_token disimpan di va_number
          status: 'pending'
        }
      });
    }

    // Ambil data customer
    const [customers] = await connection.query('SELECT full_name, email FROM users WHERE user_id = ?', [user_id]);
    const customer = customers[0];

    const paymentId = generateId('PAY');
    const grossAmount = Math.round(parseFloat(invoice.amount));

    // ========== DUMMY MODE ==========
    if (useDummyPayment) {
      const dummyToken = `dummy_snap_${paymentId}`;
      const dummyUrl = `http://localhost:${process.env.PORT || 3000}/payments/callback?info=dummy`;

      await connection.query(
        `INSERT INTO payments (payment_id, invoice_id, user_id, payment_method, amount, status, va_number)
         VALUES (?, ?, ?, 'dummy', ?, 'pending', ?)`,
        [paymentId, invoice_id, user_id, grossAmount, dummyToken]
      );

      await connection.commit();

      return res.status(201).json({
        success: true,
        message: 'Payment created (DUMMY MODE). Gunakan POST /payments/callback untuk simulasi.',
        data: {
          payment_id: paymentId,
          invoice_id,
          order_id: invoice.order_id,
          amount: grossAmount,
          snap_token: dummyToken,
          redirect_url: dummyUrl,
          status: 'pending',
          mode: 'dummy'
        }
      });
    }

    // ========== MIDTRANS MODE ==========
    if (!snap) {
      await connection.rollback();
      return res.status(503).json({
        success: false,
        message: 'Midtrans client not available. Install midtrans-client atau set USE_DUMMY_PAYMENT=true di .env.'
      });
    }

    // Validasi server key — jangan proses dengan key kosong/default
    const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
    if (!serverKey || serverKey === 'SB-Mid-server-xxxxxxxxxxxxxxxxxxxxxxxx') {
      await connection.rollback();
      return res.status(503).json({
        success: false,
        message: 'MIDTRANS_SERVER_KEY belum dikonfigurasi. Set key yang valid di .env atau gunakan USE_DUMMY_PAYMENT=true.'
      });
    }

    // Buat transaksi Midtrans Snap DULU — jika gagal, jangan simpan payment record
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

    let midtransResponse;
    try {
      midtransResponse = await snap.createTransaction(parameter);
    } catch (snapErr) {
      console.error('Midtrans Snap error:', snapErr.message);
      if (snapErr.ApiResponse) {
        console.error('Midtrans API Response:', JSON.stringify(snapErr.ApiResponse));
      }
      await connection.rollback();
      return res.status(502).json({
        success: false,
        message: 'Payment gateway error. Coba lagi nanti.',
        error: snapErr.message
      });
    }

    // Snap sukses — sekarang baru simpan payment record dengan snap token
    await connection.query(
      `INSERT INTO payments (payment_id, invoice_id, user_id, payment_method, amount, status, va_number)
       VALUES (?, ?, ?, 'midtrans_snap', ?, 'pending', ?)`,
      [paymentId, invoice_id, user_id, grossAmount, midtransResponse.token]
    );

    await connection.commit();

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
    if (connection) await connection.rollback();
    console.error('createPayment error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    if (connection) connection.release();
  }
};

// ============================================
// 4.3. Payment Notification Callback
// POST /payments/callback
// FIX:
//   - SELECT ... FOR UPDATE pada payment
//   - Validasi gross_amount vs payment.amount
//   - Wallet not found → rollback + error
//   - Dummy mode support
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

  // ========== DUMMY MODE ==========
  if (useDummyPayment) {
    // Di dummy mode, terima format lebih sederhana
    const dummyPaymentId = paymentId || req.body.payment_id;
    const dummyStatus = transactionStatus || req.body.status || 'settlement';

    if (!dummyPaymentId) {
      return res.status(400).json({ success: false, message: 'payment_id / order_id wajib diisi' });
    }

    // Tentukan paymentStatus
    let paymentStatus;
    if (dummyStatus === 'settlement' || dummyStatus === 'success' || dummyStatus === 'capture') {
      paymentStatus = 'success';
    } else if (dummyStatus === 'deny' || dummyStatus === 'cancel' || dummyStatus === 'expire' || dummyStatus === 'failed') {
      paymentStatus = 'failed';
    } else if (dummyStatus === 'pending') {
      return res.json({ success: true, message: 'Notification received. Payment still pending.' });
    } else {
      return res.json({ success: true, message: `Notification received. Unhandled status: ${dummyStatus}` });
    }

    // Lanjut ke flow yang sama di bawah (dengan paymentId = dummyPaymentId)
    return processCallbackInternal(dummyPaymentId, paymentStatus, req, res);
  }

  // ========== MIDTRANS MODE ==========
  // Validasi input dasar
  if (!paymentId || !statusCode || !grossAmount || !signatureKey) {
    return res.status(400).json({ success: false, message: 'Missing required notification fields' });
  }

  // Validasi Midtrans Signature Key
  const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
  if (!serverKey || serverKey === 'SB-Mid-server-xxxxxxxxxxxxxxxxxxxxxxxx') {
    console.error('[Payment] MIDTRANS_SERVER_KEY not configured. Cannot validate callback signature.');
    return res.status(503).json({
      success: false,
      message: 'Server key not configured. Cannot process Midtrans callback.'
    });
  }

  const expectedSignature = crypto
    .createHash('sha512')
    .update(paymentId + statusCode + grossAmount + serverKey)
    .digest('hex');

  if (signatureKey !== expectedSignature) {
    console.warn('[Payment] Invalid signature for payment:', paymentId);
    return res.status(403).json({ success: false, message: 'Invalid signature key' });
  }

  // Tentukan status pembayaran
  let paymentStatus;
  if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
    if (transactionStatus === 'capture' && fraudStatus !== 'accept') {
      paymentStatus = 'failed';
    } else {
      paymentStatus = 'success';
    }
  } else if (transactionStatus === 'deny' || transactionStatus === 'cancel' || transactionStatus === 'expire') {
    paymentStatus = 'failed';
  } else if (transactionStatus === 'pending') {
    return res.json({ success: true, message: 'Notification received. Payment still pending.' });
  } else {
    return res.json({ success: true, message: `Notification received. Unhandled status: ${transactionStatus}` });
  }

  return processCallbackInternal(paymentId, paymentStatus, req, res, grossAmount);
};

// ============================================
// Internal: Process callback (shared by dummy + midtrans)
// ============================================
async function processCallbackInternal(paymentId, paymentStatus, req, res, callbackGrossAmount) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // FIX: SELECT ... FOR UPDATE — lock payment row untuk race condition
    const [payments] = await connection.query('SELECT * FROM payments WHERE payment_id = ? FOR UPDATE', [paymentId]);
    if (payments.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const payment = payments[0];

    // IDEMPOTENT: jika payment sudah success, return ok
    if (payment.status === 'success') {
      await connection.rollback();
      return res.json({ success: true, message: 'Payment already processed as success. No action taken.' });
    }

    // FIX: Validasi gross_amount vs payment.amount (hanya untuk Midtrans mode)
    if (callbackGrossAmount !== undefined) {
      const expectedAmount = parseFloat(payment.amount);
      const receivedAmount = parseFloat(callbackGrossAmount);
      if (Math.abs(expectedAmount - receivedAmount) > 0.01) {
        await connection.rollback();
        console.warn(`[Payment] Amount mismatch for ${paymentId}: expected=${expectedAmount}, received=${receivedAmount}`);
        return res.status(400).json({
          success: false,
          message: `Amount mismatch. Expected: ${expectedAmount}, received: ${receivedAmount}`
        });
      }
    }

    if (paymentStatus === 'failed') {
      await connection.query('UPDATE payments SET status = ? WHERE payment_id = ?', ['failed', paymentId]);
      await connection.commit();
      return res.json({ success: true, message: 'Notification processed. Payment marked as failed.' });
    }

    // --- Status = success ---

    // Update payment
    await connection.query(
      'UPDATE payments SET status = ?, payment_method = ?, paid_at = NOW() WHERE payment_id = ?',
      ['success', req.body.payment_type || payment.payment_method || 'midtrans', paymentId]
    );

    // Update invoice → paid (lock invoice juga)
    const [invoiceRows] = await connection.query('SELECT * FROM invoices WHERE invoice_id = ? FOR UPDATE', [payment.invoice_id]);
    await connection.query('UPDATE invoices SET status = ? WHERE invoice_id = ?', ['paid', payment.invoice_id]);

    // Ambil order (lock)
    const order_id = invoiceRows[0].order_id;
    const [orders] = await connection.query('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [order_id]);
    const order = orders[0];

    // Update order status → PROCESSING (jangan downgrade)
    const currentIndex = STATUS_ORDER.indexOf(order.status);
    const processingIndex = STATUS_ORDER.indexOf('PROCESSING');

    if (currentIndex < processingIndex) {
      await connection.query('UPDATE orders SET status = ? WHERE order_id = ?', ['PROCESSING', order_id]);
      await connection.query(
        'INSERT INTO order_status_logs (order_id, status, changed_by) VALUES (?, ?, NULL)',
        [order_id, 'PROCESSING']
      );
    }

    // Distribusi saldo — IDEMPOTENT check
    const [existingTxns] = await connection.query(
      `SELECT transaction_id FROM wallet_transactions WHERE order_id = ? AND type = 'credit'`,
      [order_id]
    );

    let walletDistributed = false;

    if (existingTxns.length === 0) {
      walletDistributed = true;
      const ownerEarning = parseFloat(order.owner_earning) || 0;
      const courierEarning = parseFloat(order.courier_earning) || 0;
      const adminCommission = parseFloat(order.admin_commission) || 0;

      // Owner earning → pending balance
      if (order.owner_id && ownerEarning > 0) {
        const [ownerWallet] = await connection.query('SELECT wallet_id FROM wallets WHERE user_id = ?', [order.owner_id]);
        if (ownerWallet.length === 0) {
          // FIX: Wallet wajib ada — rollback jika tidak ditemukan
          await connection.rollback();
          console.error(`[Payment] Owner wallet not found for user_id=${order.owner_id}, order=${order_id}`);
          return res.status(500).json({
            success: false,
            message: `Owner wallet not found for user_id=${order.owner_id}. Admin harus verify owner terlebih dahulu.`
          });
        }
        await connection.query(
          `INSERT INTO wallet_transactions (transaction_id, wallet_id, type, amount, status, description, order_id, source) 
           VALUES (?, ?, 'credit', ?, 'pending', ?, ?, ?)`,
          [generateId('TXN'), ownerWallet[0].wallet_id, ownerEarning, `Pendapatan order ${order_id}`, order_id, `order:${order_id}`]
        );
        await connection.query(
          'UPDATE wallets SET pending_balance = pending_balance + ?, total_earned = total_earned + ? WHERE wallet_id = ?',
          [ownerEarning, ownerEarning, ownerWallet[0].wallet_id]
        );
      }

      // Courier earning → pending balance
      const [assignments] = await connection.query(
        'SELECT courier_id FROM courier_assignments WHERE order_id = ?', [order_id]
      );
      if (assignments.length > 0 && courierEarning > 0) {
        const courierId = assignments[0].courier_id;
        const [courierWallet] = await connection.query('SELECT wallet_id FROM wallets WHERE user_id = ?', [courierId]);
        if (courierWallet.length === 0) {
          // FIX: Wallet wajib ada — rollback jika tidak ditemukan
          await connection.rollback();
          console.error(`[Payment] Courier wallet not found for user_id=${courierId}, order=${order_id}`);
          return res.status(500).json({
            success: false,
            message: `Courier wallet not found for user_id=${courierId}. Admin harus verify courier terlebih dahulu.`
          });
        }
        await connection.query(
          `INSERT INTO wallet_transactions (transaction_id, wallet_id, type, amount, status, description, order_id, source) 
           VALUES (?, ?, 'credit', ?, 'pending', ?, ?, ?)`,
          [generateId('TXN'), courierWallet[0].wallet_id, courierEarning, `Pendapatan order ${order_id}`, order_id, `order:${order_id}`]
        );
        await connection.query(
          'UPDATE wallets SET pending_balance = pending_balance + ?, total_earned = total_earned + ? WHERE wallet_id = ?',
          [courierEarning, courierEarning, courierWallet[0].wallet_id]
        );
      }

      // Admin commission → langsung AVAILABLE
      if (adminCommission > 0) {
        const [adminWallet] = await connection.query("SELECT wallet_id FROM wallets WHERE role = 'admin' LIMIT 1");
        if (adminWallet.length === 0) {
          // FIX: Admin wallet wajib ada — rollback
          await connection.rollback();
          console.error(`[Payment] Admin wallet not found for order=${order_id}`);
          return res.status(500).json({
            success: false,
            message: 'Admin wallet not found. Pastikan admin sudah memiliki wallet.'
          });
        }
        await connection.query(
          `INSERT INTO wallet_transactions (transaction_id, wallet_id, type, amount, status, description, order_id, source) 
           VALUES (?, ?, 'credit', ?, 'available', ?, ?, ?)`,
          [generateId('TXN'), adminWallet[0].wallet_id, adminCommission, `Komisi order ${order_id}`, order_id, `commission:${order_id}`]
        );
        await connection.query(
          'UPDATE wallets SET available_balance = available_balance + ?, total_earned = total_earned + ? WHERE wallet_id = ?',
          [adminCommission, adminCommission, adminWallet[0].wallet_id]
        );
      }
    }

    // Notifikasi
    await createNotification(connection, order.customer_id, 'Pembayaran Berhasil',
      `Pesanan ${order_id} telah dibayar dan sedang diproses.`);
    if (order.owner_id) {
      await createNotification(connection, order.owner_id, 'Pembayaran Diterima',
        `Pembayaran untuk order ${order_id} telah berhasil. Silakan proses laundry.`);
    }

    await connection.commit();

    res.json({
      success: true,
      message: 'Notification processed successfully.',
      data: {
        payment_id: paymentId,
        status: 'success',
        order_id,
        wallet_distributed: walletDistributed
      }
    });
  } catch (err) {
    await connection.rollback();
    console.error('paymentCallback error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
}
