const pool = require('../config/db');

// ============================================
// Admin Dashboard Metrics
// GET /admin/dashboard/metrics?date_from=&date_to=
// Auth: Bearer Token (role: admin)
// ============================================
exports.getDashboardMetrics = async (req, res) => {
  const { date_from, date_to } = req.query;

  try {
    // Total users
    const [totalUsersResult] = await pool.query('SELECT COUNT(*) as total FROM users');
    const total_users = totalUsersResult[0].total;

    // New users this period
    let new_users_this_period = 0;
    if (date_from && date_to) {
      const [newUsersResult] = await pool.query(
        'SELECT COUNT(*) as total FROM users WHERE created_at >= ? AND created_at <= ?',
        [date_from, date_to + ' 23:59:59']
      );
      new_users_this_period = newUsersResult[0].total;
    }

    // Total orders
    const [totalOrdersResult] = await pool.query('SELECT COUNT(*) as total FROM orders');
    const total_orders = totalOrdersResult[0].total;

    // Orders this period
    let orders_this_period = 0;
    if (date_from && date_to) {
      const [ordersResult] = await pool.query(
        'SELECT COUNT(*) as total FROM orders WHERE created_at >= ? AND created_at <= ?',
        [date_from, date_to + ' 23:59:59']
      );
      orders_this_period = ordersResult[0].total;
    }

    // Total revenue (dari payments yang status = paid)
    const [totalRevenueResult] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'paid'"
    );
    const total_revenue = totalRevenueResult[0].total;

    // Revenue this period
    let revenue_this_period = 0;
    if (date_from && date_to) {
      const [revenueResult] = await pool.query(
        "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'paid' AND paid_at >= ? AND paid_at <= ?",
        [date_from, date_to + ' 23:59:59']
      );
      revenue_this_period = revenueResult[0].total;
    }

    // Active couriers
    const [activeCouriersResult] = await pool.query(
      "SELECT COUNT(*) as total FROM users WHERE role = 'courier' AND is_active = TRUE"
    );
    const active_couriers = activeCouriersResult[0].total;

    // Active owners
    const [activeOwnersResult] = await pool.query(
      "SELECT COUNT(*) as total FROM users WHERE role = 'owner' AND is_active = TRUE"
    );
    const active_owners = activeOwnersResult[0].total;

    // Order status summary
    const [statusSummary] = await pool.query(
      `SELECT 
        SUM(CASE WHEN status = 'pending_payment' THEN 1 ELSE 0 END) as pending_payment,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status = 'washing' THEN 1 ELSE 0 END) as washing,
        SUM(CASE WHEN status = 'delivering' THEN 1 ELSE 0 END) as delivering,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
       FROM orders`
    );

    res.json({
      message: 'Success',
      data: {
        total_users,
        new_users_this_period,
        total_orders,
        orders_this_period,
        total_revenue,
        revenue_this_period,
        active_couriers,
        active_owners,
        order_status_summary: {
          pending_payment: statusSummary[0].pending_payment || 0,
          confirmed: statusSummary[0].confirmed || 0,
          washing: statusSummary[0].washing || 0,
          delivering: statusSummary[0].delivering || 0,
          completed: statusSummary[0].completed || 0
        }
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
