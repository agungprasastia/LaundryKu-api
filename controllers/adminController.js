const pool = require('../config/db');

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

    const [totalUsers] = await pool.query('SELECT COUNT(*) as total FROM users');
    const [totalOrders] = await pool.query(`SELECT COUNT(*) as total FROM orders WHERE 1=1${dateFilter}`, dateParams);
    const [totalRevenue] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'success'${dateFilter.replace('created_at', 'paid_at')}`,
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

    res.json({
      data: {
        total_users: totalUsers[0].total,
        total_orders: totalOrders[0].total,
        total_revenue: parseFloat(totalRevenue[0].total),
        total_admin_commission: parseFloat(totalAdminCommission[0].total),
        orders_completed: ordersCompleted[0].total,
        orders_pending: ordersPending[0].total
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 7.2. Verifikasi User
// PATCH /admin/users/:user_id/verify
// Auth: Bearer Token (role: admin)
// ============================================
exports.verifyUser = async (req, res) => {
  const { user_id } = req.params;
  const { is_verified } = req.body;

  try {
    const [users] = await pool.query('SELECT * FROM users WHERE user_id = ?', [user_id]);
    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];

    // Hanya owner dan courier yang perlu verifikasi
    if (!['owner', 'courier'].includes(user.role)) {
      return res.status(422).json({ message: 'Only owner and courier can be verified' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    await connection.query('UPDATE users SET is_verified = ? WHERE user_id = ?', [is_verified ? 1 : 0, user_id]);

    let wallet_created = false;
    let wallet_id = null;

    // Jika verified → buat wallet otomatis
    if (is_verified) {
      // Cek apakah wallet sudah ada
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

    await connection.commit();
    connection.release();

    res.json({
      message: 'User verified. Wallet created automatically.',
      data: {
        user_id: parseInt(user_id),
        is_verified: is_verified ? true : false,
        wallet_created,
        wallet_id
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
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
      return res.status(404).json({ message: 'Admin wallet not found' });
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
      data: {
        wallet_id: w.wallet_id,
        role: 'admin',
        available_balance: parseFloat(w.available_balance),
        total_commission_earned: parseFloat(w.total_earned),
        this_month: parseFloat(thisMonth[0].total)
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 7.4. Proses Withdraw
// PATCH /admin/wallets/withdrawals/:withdraw_id/process
// Auth: Bearer Token (role: admin)
// ============================================
exports.processWithdraw = async (req, res) => {
  const { withdraw_id } = req.params;
  const { status, note } = req.body;

  if (!status || !['success', 'failed'].includes(status)) {
    return res.status(422).json({ message: 'status harus success atau failed' });
  }

  try {
    const [withdrawals] = await pool.query('SELECT * FROM withdrawals WHERE withdraw_id = ?', [withdraw_id]);
    if (withdrawals.length === 0) {
      return res.status(404).json({ message: 'Withdrawal not found' });
    }

    const withdrawal = withdrawals[0];
    if (withdrawal.status !== 'pending') {
      return res.status(422).json({ message: 'Withdrawal already processed' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    await connection.query(
      'UPDATE withdrawals SET status = ?, note = ?, processed_at = NOW() WHERE withdraw_id = ?',
      [status, note || null, withdraw_id]
    );

    // Jika failed, kembalikan saldo
    if (status === 'failed') {
      await connection.query(
        'UPDATE wallets SET available_balance = available_balance + ? WHERE wallet_id = ?',
        [withdrawal.amount, withdrawal.wallet_id]
      );
    }

    await connection.commit();
    connection.release();

    res.json({
      message: 'Withdraw processed',
      data: {
        withdraw_id,
        status,
        processed_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 9.4. Admin Analytics
// GET /admin/analytics
// Auth: Bearer Token (role: admin)
// ============================================
exports.getAnalytics = async (req, res) => {
  const { date_from, date_to, group_by } = req.query;

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
    const [activeOwners] = await pool.query("SELECT COUNT(*) as total FROM users WHERE role = 'owner' AND is_verified = 1");
    const [activeCouriers] = await pool.query("SELECT COUNT(*) as total FROM users WHERE role = 'courier' AND is_verified = 1");

    // Top owners
    const [topOwners] = await pool.query(
      `SELECT osl.changed_by AS owner_id, u.full_name AS name, COUNT(DISTINCT osl.order_id) AS orders
       FROM order_status_logs osl
       JOIN users u ON osl.changed_by = u.user_id
       WHERE osl.status = 'CONFIRMED' AND u.role = 'owner'
       GROUP BY osl.changed_by, u.full_name
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
      data: {
        total_orders: totalOrders[0].total,
        total_gmv: parseFloat(totalGMV[0].total),
        total_admin_commission: parseFloat(totalAdminCommission[0].total),
        active_owners: activeOwners[0].total,
        active_couriers: activeCouriers[0].total,
        top_owners: topOwners,
        top_couriers: topCouriers
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
