const pool = require('../config/db');

// ============================================
// 4.1. Lihat Invoice
// GET /payments/invoice/:invoice_id
// Auth: Bearer Token (role: customer)
// ============================================
exports.getInvoice = async (req, res) => {
  const { invoice_id } = req.params;

  try {
    const [invoices] = await pool.query('SELECT * FROM invoices WHERE invoice_id = ?', [invoice_id]);
    if (invoices.length === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const inv = invoices[0];

    res.json({
      data: {
        invoice_id: inv.invoice_id,
        amount: inv.amount,
        breakdown: {
          service_fee: inv.service_fee,
          delivery_fee: inv.delivery_fee
        },
        status: inv.status
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
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

  if (!invoice_id || !payment_method) {
    return res.status(422).json({
      message: 'Validation error',
      errors: {
        ...((!invoice_id) && { invoice_id: ['invoice_id wajib diisi'] }),
        ...((!payment_method) && { payment_method: ['payment_method wajib diisi'] })
      }
    });
  }

  try {
    const [invoices] = await pool.query('SELECT * FROM invoices WHERE invoice_id = ?', [invoice_id]);
    if (invoices.length === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoice = invoices[0];

    if (invoice.status === 'paid') {
      return res.status(400).json({ message: 'Invoice already paid' });
    }

    if (!invoice.amount || invoice.amount <= 0) {
      return res.status(400).json({ message: 'Invoice amount not yet calculated. Owner must input weight first.' });
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
      message: 'Payment created',
      data: {
        payment_id: paymentId,
        va_number: vaNumber,
        expired_at: expiredAt.toISOString(),
        status: 'pending'
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 4.3. Payment Callback (Payment Gateway)
// POST /payments/callback
// Auth: Validasi via signature (simplified)
// Distribusi saldo ke PENDING BALANCE setelah success
// ============================================
exports.paymentCallback = async (req, res) => {
  const { payment_id, status } = req.body;

  if (!payment_id || !status) {
    return res.status(400).json({ message: 'payment_id and status required' });
  }

  if (!['success', 'failed'].includes(status)) {
    return res.status(400).json({ message: 'Invalid payment status' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Cek payment
    const [payments] = await connection.query('SELECT * FROM payments WHERE payment_id = ?', [payment_id]);
    if (payments.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Payment not found' });
    }

    const payment = payments[0];

    if (status === 'failed') {
      await connection.query('UPDATE payments SET status = ? WHERE payment_id = ?', ['failed', payment_id]);
      await connection.commit();
      connection.release();
      return res.json({ message: 'Callback processed' });
    }

    // Status = success
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
    await connection.query('UPDATE orders SET status = ? WHERE order_id = ?', ['PROCESSING', order_id]);
    await connection.query(
      'INSERT INTO order_status_logs (order_id, status, changed_by) VALUES (?, ?, NULL)',
      [order_id, 'PROCESSING']
    );

    // 6. Distribusi saldo ke PENDING BALANCE wallet
    const ownerEarning = parseFloat(order.owner_earning) || 0;
    const courierEarning = parseFloat(order.courier_earning) || 0;
    const adminCommission = parseFloat(order.admin_commission) || 0;

    // Cari assignment untuk mendapat courier_id
    const [assignments] = await connection.query(
      'SELECT courier_id FROM courier_assignments WHERE order_id = ?', [order_id]
    );

    // Cari service owner — kita perlu tahu siapa owner-nya
    // Karena orders table tidak punya owner_id lagi, kita harus join via service
    // Untuk simplicity, kita cari dari services — tapi services juga tidak punya owner_id di spec v2
    // Kita simpan owner_id via assignment context atau tracking who confirmed
    // Untuk saat ini, kita cari dari order_status_logs siapa yang CONFIRMED
    const [confirmedLogs] = await connection.query(
      `SELECT changed_by FROM order_status_logs WHERE order_id = ? AND status = 'CONFIRMED' LIMIT 1`,
      [order_id]
    );

    // Distribute to wallets
    if (confirmedLogs.length > 0 && ownerEarning > 0) {
      const ownerId = confirmedLogs[0].changed_by;
      const [ownerWallet] = await connection.query('SELECT wallet_id FROM wallets WHERE user_id = ?', [ownerId]);
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

    // 7. Notifikasi
    await connection.query(
      `INSERT INTO notifications (user_id, title, body) VALUES (?, ?, ?)`,
      [order.customer_id, 'Pembayaran Berhasil', `Pesanan ${order_id} sedang diproses.`]
    );

    await connection.commit();
    connection.release();

    res.json({
      message: 'Callback processed. Saldo didistribusikan ke pending balance.',
      distribution: {
        owner_pending: ownerEarning,
        courier_pending: courierEarning,
        admin_commission: adminCommission
      }
    });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
