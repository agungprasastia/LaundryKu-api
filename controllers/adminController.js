  const pool = require('../config/db');
const { createNotification } = require('../helpers/notification');
const { generateId } = require('../helpers/idGenerator');
const { isPositiveNumber } = require('../helpers/validators');

// ============================================
// 7.1. Dashboard Metrics
// GET /admin/dashboard/metrics
// Auth: Bearer Token (role: admin)
// ============================================
exports.getDashboardMetrics = async (req, res) => {
  const { date_from, date_to } = req.query;

  try {
    let dateFilter = '';
    let dateParams = [];
    if (date_from && date_to) {
      dateFilter = ' AND created_at >= ? AND created_at <= ?';
      dateParams = [date_from, date_to + ' 23:59:59'];
    }

    // User counts — master data, tidak di-filter by date (users exist regardless of date range)
    // Order/revenue/commission counts — di-filter by date jika date_from & date_to dikirim
    const [totalUsers] = await pool.query('SELECT COUNT(*) as total FROM users');
    const [totalOrders] = await pool.query(`SELECT COUNT(*) as total FROM orders WHERE 1=1${dateFilter}`, dateParams);
    const [totalRevenue] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'success'${dateFilter.replaceAll('created_at', 'paid_at')}`,
      dateParams
    );
    const [totalAdminCommission] = await pool.query(
      `SELECT COALESCE(SUM(admin_commission), 0) as total FROM orders WHERE status = 'COMPLETED'${dateFilter}`,
      dateParams
    );
    const [ordersCompleted] = await pool.query(
      `SELECT COUNT(*) as total FROM orders WHERE status = 'COMPLETED'${dateFilter}`, dateParams
    );
    const [ordersPending] = await pool.query(
      `SELECT COUNT(*) as total FROM orders WHERE status NOT IN ('COMPLETED', 'DELIVERED')${dateFilter}`, dateParams
    );
    const [activeCouriers] = await pool.query("SELECT COUNT(*) as total FROM users WHERE role = 'courier' AND is_verified = 1");
    const [totalCustomers] = await pool.query("SELECT COUNT(*) as total FROM users WHERE role = 'customer'");
    const [totalCouriers] = await pool.query("SELECT COUNT(*) as total FROM users WHERE role = 'courier'");
    const [totalOwners] = await pool.query("SELECT COUNT(*) as total FROM users WHERE role = 'owner'");

    res.json({
      success: true,
      message: 'Success',
      data: {
        total_users: totalUsers[0].total,
        total_orders: totalOrders[0].total,
        total_revenue: parseFloat(totalRevenue[0].total),
        total_admin_commission: parseFloat(totalAdminCommission[0].total),
        orders_completed: ordersCompleted[0].total,
        orders_pending: ordersPending[0].total,
        active_couriers: activeCouriers[0].total,
        total_customers: totalCustomers[0].total,
        total_couriers: totalCouriers[0].total,
        total_owners: totalOwners[0].total
      }
    });
  } catch (err) {
    console.error('getDashboardMetrics error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 7.2. Verifikasi User
// PATCH /admin/users/:user_id/verify
// Auth: Bearer Token (role: admin)
// Otomatis membuat wallet setelah verify
// ============================================
exports.verifyUser = async (req, res) => {
  const { user_id } = req.params;
  const { is_verified } = req.body;

  if (is_verified === undefined || is_verified === null) {
    return res.status(422).json({ success: false, message: 'is_verified wajib diisi (true/false)' });
  }

  // FIX: Strict boolean — "false" (string) tidak boleh dianggap true
  const verified = is_verified === true || is_verified === 1;

  try {
    const [users] = await pool.query('SELECT * FROM users WHERE user_id = ?', [user_id]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = users[0];

    // Hanya owner dan courier yang perlu verifikasi
    if (!['owner', 'courier'].includes(user.role)) {
      return res.status(422).json({ success: false, message: 'Only owner and courier can be verified' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query('UPDATE users SET is_verified = ? WHERE user_id = ?', [verified ? 1 : 0, user_id]);

      let wallet_created = false;
      let wallet_id = null;

      // Jika verified → buat wallet otomatis
      if (verified) {
        const [existingWallet] = await connection.query('SELECT wallet_id FROM wallets WHERE user_id = ?', [user_id]);
        if (existingWallet.length === 0) {
          const [walletResult] = await connection.query(
            'INSERT INTO wallets (user_id, role) VALUES (?, ?)',
            [user_id, user.role]
          );
          wallet_created = true;
          wallet_id = walletResult.insertId;
        } else {
          wallet_id = existingWallet[0].wallet_id;
        }
      }

      // Notifikasi ke user
      const verifyStatus = verified ? 'diverifikasi' : 'dibatalkan verifikasinya';
      await createNotification(connection, parseInt(user_id), 'Status Verifikasi',
        `Akun Anda telah ${verifyStatus} oleh admin.${verified && wallet_created ? ' Wallet Anda telah dibuat.' : ''}`);

      await connection.commit();

      res.json({
        success: true,
        message: verified ? 'User verified. Wallet created automatically.' : 'User verification revoked.',
        data: {
          user_id: parseInt(user_id),
          role: user.role,
          is_verified: verified,
          wallet_created,
          wallet_id
        }
      });
    } catch (err) {
      await connection.rollback();
      console.error('verifyUser error:', err.message);
      res.status(500).json({ success: false, message: 'Server error' });
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('verifyUser error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 7.3. Lihat Wallet Admin
// GET /admin/wallets/me
// Auth: Bearer Token (role: admin)
// ============================================
exports.getAdminWallet = async (req, res) => {
  const admin_id = req.user.id;

  try {
    const [wallets] = await pool.query("SELECT * FROM wallets WHERE user_id = ? AND role = 'admin'", [admin_id]);

    if (wallets.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin wallet not found' });
    }

    const w = wallets[0];

    // Hitung komisi bulan ini
    const now = new Date();
    const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const [thisMonth] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM wallet_transactions 
       WHERE wallet_id = ? AND source LIKE 'commission:%' AND created_at >= ?`,
      [w.wallet_id, firstDay]
    );

    res.json({
      success: true,
      message: 'Success',
      data: {
        wallet_id: w.wallet_id,
        role: 'admin',
        balance: parseFloat(w.available_balance) + parseFloat(w.pending_balance),
        available_balance: parseFloat(w.available_balance),
        pending_balance: parseFloat(w.pending_balance),
        total_earned: parseFloat(w.total_earned),
        total_commission_earned: parseFloat(w.total_earned),
        this_month: parseFloat(thisMonth[0].total)
      }
    });
  } catch (err) {
    console.error('getAdminWallet error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 7.4. Proses Withdraw
// PATCH /admin/wallets/withdrawals/:withdraw_id/process
// Auth: Bearer Token (role: admin)
// Jika failed, kembalikan saldo (deduct-on-request approach)
// ============================================
exports.processWithdraw = async (req, res) => {
  const { withdraw_id } = req.params;
  const { status, note } = req.body;

  if (!status || !['success', 'failed'].includes(status)) {
    return res.status(422).json({ success: false, message: 'status harus success atau failed' });
  }

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Lock withdrawal row untuk mencegah double processing oleh 2 admin
    const [withdrawals] = await connection.query(
      'SELECT * FROM withdrawals WHERE withdraw_id = ? FOR UPDATE',
      [withdraw_id]
    );
    if (withdrawals.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    }

    const withdrawal = withdrawals[0];
    if (withdrawal.status !== 'pending') {
      await connection.rollback();
      return res.status(422).json({ success: false, message: 'Withdrawal already processed' });
    }

    await connection.query(
      'UPDATE withdrawals SET status = ?, note = ?, processed_at = NOW() WHERE withdraw_id = ?',
      [status, note || null, withdraw_id]
    );

    // Update wallet balance (selalu kurangi pending_balance, kembalikan ke available_balance hanya jika failed)
    if (status === 'failed') {
      await connection.query(
        'UPDATE wallets SET available_balance = available_balance + ?, pending_balance = pending_balance - ? WHERE wallet_id = ?',
        [withdrawal.amount, withdrawal.amount, withdrawal.wallet_id]
      );
    } else if (status === 'success') {
      await connection.query(
        'UPDATE wallets SET pending_balance = pending_balance - ? WHERE wallet_id = ?',
        [withdrawal.amount, withdrawal.wallet_id]
      );
    }

    // Notifikasi ke user
    const [walletInfo] = await connection.query('SELECT user_id FROM wallets WHERE wallet_id = ?', [withdrawal.wallet_id]);
    if (walletInfo.length > 0) {
      const statusText = status === 'success' ? 'disetujui' : 'ditolak';
      await createNotification(connection, walletInfo[0].user_id, 'Withdraw Diproses',
        `Withdraw ${withdraw_id} telah ${statusText}. ${note ? `Catatan: ${note}` : ''}`);
    }

    await connection.commit();

    return res.json({
      success: true,
      message: 'Withdraw processed',
      data: {
        withdraw_id,
        status,
        processed_at: new Date().toISOString()
      }
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('processWithdraw error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    if (connection) connection.release();
  }
};

// ============================================
// 7.5. Lihat Users Pending Verification
// GET /admin/users/pending
// Auth: Bearer Token (role: admin)
// ============================================
exports.getPendingUsers = async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT user_id, full_name, email, role, is_verified, address, vehicle_name, vehicle_plate_number, created_at
       FROM users 
       WHERE role IN ('owner', 'courier') AND is_verified = 0
       ORDER BY created_at ASC`
    );

    res.json({
      success: true,
      message: 'Success',
      data: users
    });
  } catch (err) {
    console.error('getPendingUsers error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 7.6. Lihat Semua Orders (Admin)
// GET /admin/orders
// Auth: Bearer Token (role: admin)
// ============================================
exports.getAllOrders = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.max(1, parseInt(limit) || 10);
  const offset = (pageNum - 1) * limitNum;

  try {
    let whereConditions = [];
    let params = [];

    if (status) {
      whereConditions.push('o.status = ?');
      params.push(status);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM orders o ${whereClause}`, params);
    const total = countResult[0].total;

    const [orders] = await pool.query(
      `SELECT o.order_id, o.customer_id, o.owner_id, o.status, s.name AS service_name, 
              o.total_amount, o.weight_kg, o.created_at, o.pickup_scheduled_at
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
    console.error('getAllOrders error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 9.4. Admin Analytics
// GET /admin/analytics
// Auth: Bearer Token (role: admin)
// ============================================
exports.getAnalytics = async (req, res) => {
  const { date_from, date_to } = req.query;

  try {
    let dateFilter = '';
    let dateParams = [];
    if (date_from && date_to) {
      dateFilter = ' AND o.created_at >= ? AND o.created_at <= ?';
      dateParams = [date_from, date_to + ' 23:59:59'];
    }

    const [totalOrders] = await pool.query(`SELECT COUNT(*) as total FROM orders o WHERE 1=1${dateFilter}`, dateParams);
    const [totalGMV] = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM orders o WHERE status = 'COMPLETED'${dateFilter}`, dateParams
    );
    const [totalAdminCommission] = await pool.query(
      `SELECT COALESCE(SUM(admin_commission), 0) as total FROM orders o WHERE status = 'COMPLETED'${dateFilter}`, dateParams
    );
    const [totalUsers] = await pool.query("SELECT COUNT(*) as total FROM users");
    const [activeOwners] = await pool.query("SELECT COUNT(*) as total FROM users WHERE role = 'owner' AND is_verified = 1");
    const [activeCouriers] = await pool.query("SELECT COUNT(*) as total FROM users WHERE role = 'courier' AND is_verified = 1");

    // Top owners (by owner_id di orders)
    const [topOwners] = await pool.query(
      `SELECT o.owner_id, u.full_name AS name, COUNT(*) AS orders
       FROM orders o
       JOIN users u ON o.owner_id = u.user_id
       WHERE o.status = 'COMPLETED'
       GROUP BY o.owner_id, u.full_name
       ORDER BY orders DESC LIMIT 5`
    );

    // Top couriers
    const [topCouriers] = await pool.query(
      `SELECT ca.courier_id, u.full_name AS name, COUNT(*) AS deliveries
       FROM courier_assignments ca
       JOIN users u ON ca.courier_id = u.user_id
       WHERE ca.delivery_status = 'DONE'
       GROUP BY ca.courier_id, u.full_name
       ORDER BY deliveries DESC LIMIT 5`
    );

    res.json({
      success: true,
      message: 'Success',
      data: {
        total_orders: totalOrders[0].total,
        total_gmv: parseFloat(totalGMV[0].total),
        total_admin_commission: parseFloat(totalAdminCommission[0].total),
        total_users: totalUsers[0].total,
        active_owners: activeOwners[0].total,
        active_couriers: activeCouriers[0].total,
        top_owners: topOwners,
        top_couriers: topCouriers
      }
    });
  } catch (err) {
    console.error('getAnalytics error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 9.5. Admin Wallet Transactions
// GET /admin/wallets/me/transactions
// Auth: Bearer Token (role: admin)
// ============================================
exports.getAdminTransactions = async (req, res) => {
  const admin_id = req.user.id;

  try {
    const [wallets] = await pool.query(
      "SELECT wallet_id FROM wallets WHERE user_id = ? AND role = 'admin'",
      [admin_id]
    );
    if (wallets.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin wallet not found' });
    }

    const wallet_id = wallets[0].wallet_id;
    const [transactions] = await pool.query(
      `SELECT transaction_id, type, amount, status, description, order_id, source, created_at
       FROM wallet_transactions
       WHERE wallet_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [wallet_id]
    );

    res.json({ success: true, message: 'Success', data: transactions });
  } catch (err) {
    console.error('getAdminTransactions error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 9.6. Admin Withdraw
// POST /admin/wallets/me/withdraw
// Auth: Bearer Token (role: admin)
// ============================================
exports.adminWithdraw = async (req, res) => {
  const admin_id = req.user.id;
  const { amount, bank_account_number, bank_name, e_wallet_number, e_wallet_provider } = req.body;

  if (!amount || !isPositiveNumber(amount)) {
    return res.status(422).json({ success: false, message: 'amount wajib diisi dan > 0' });
  }
  if (!bank_account_number && !e_wallet_number) {
    return res.status(422).json({ success: false, message: 'bank_account_number atau e_wallet_number wajib diisi' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [wallets] = await connection.query(
      "SELECT * FROM wallets WHERE user_id = ? AND role = 'admin' FOR UPDATE",
      [admin_id]
    );
    if (wallets.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Admin wallet not found' });
    }

    const wallet = wallets[0];
    const withdrawAmount = parseFloat(amount);

    if (withdrawAmount > parseFloat(wallet.available_balance)) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient available balance' });
    }

    const withdrawId = generateId('WD');

    await connection.query(
      'UPDATE wallets SET available_balance = available_balance - ? WHERE wallet_id = ?',
      [withdrawAmount, wallet.wallet_id]
    );

    await connection.query(
      `INSERT INTO withdrawals (withdraw_id, wallet_id, amount, bank_account_number, bank_name, e_wallet_number, e_wallet_provider, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [withdrawId, wallet.wallet_id, withdrawAmount, bank_account_number || null, bank_name || null, e_wallet_number || null, e_wallet_provider || null]
    );

    await connection.query(
      `INSERT INTO wallet_transactions (transaction_id, wallet_id, type, amount, status, description, source)
       VALUES (?, ?, 'debit', ?, 'available', ?, ?)`,
      [generateId('TXN'), wallet.wallet_id, withdrawAmount, `Withdraw ${withdrawId}`, `withdraw:${withdrawId}`]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Withdraw request submitted',
      data: { withdraw_id: withdrawId, amount: withdrawAmount, status: 'pending' }
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('adminWithdraw error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    if (connection) connection.release();
  }
};

// ============================================
// 9.7. Pending Withdrawals (semua user)
// GET /admin/wallets/withdrawals/pending
// Auth: Bearer Token (role: admin)
// ============================================
exports.getPendingWithdrawals = async (req, res) => {
  try {
    const [withdrawals] = await pool.query(
      `SELECT wd.withdraw_id, wd.wallet_id, wd.amount, wd.bank_account_number, wd.bank_name,
              wd.e_wallet_number, wd.e_wallet_provider, wd.status, wd.note, wd.created_at,
              u.full_name, u.email
       FROM withdrawals wd
       JOIN wallets w ON wd.wallet_id = w.wallet_id
       JOIN users u ON w.user_id = u.user_id
       WHERE wd.status = 'pending'
       ORDER BY wd.created_at ASC`
    );

    res.json({ success: true, message: 'Success', data: withdrawals });
  } catch (err) {
    console.error('getPendingWithdrawals error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 9.8. Semua Withdrawals (history)
// GET /admin/wallets/withdrawals
// Auth: Bearer Token (role: admin)
// ============================================
exports.getAllWithdrawals = async (req, res) => {
  try {
    const [withdrawals] = await pool.query(
      `SELECT wd.withdraw_id, wd.wallet_id, wd.amount, wd.bank_account_number, wd.bank_name,
              wd.e_wallet_number, wd.e_wallet_provider, wd.status, wd.note, wd.processed_at, wd.created_at,
              u.full_name, u.email
       FROM withdrawals wd
       JOIN wallets w ON wd.wallet_id = w.wallet_id
       JOIN users u ON w.user_id = u.user_id
       ORDER BY wd.created_at DESC
       LIMIT 100`
    );

    res.json({ success: true, message: 'Success', data: withdrawals });
  } catch (err) {
    console.error('getAllWithdrawals error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
