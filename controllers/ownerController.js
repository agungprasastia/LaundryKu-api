const pool = require('../config/db');

// ============================================
// 9.2. Laporan Owner
// GET /owner/reports/summary
// Auth: Bearer Token (role: owner, verified)
// Menggunakan owner_id dari orders (bukan lagi via order_status_logs)
// ============================================
exports.getReportSummary = async (req, res) => {
  const owner_id = req.user.id;
  const { date_from, date_to } = req.query;

  try {
    let dateFilter = '';
    let dateParams = [];
    if (date_from && date_to) {
      dateFilter = ' AND o.created_at >= ? AND o.created_at <= ?';
      dateParams = [date_from, date_to + ' 23:59:59'];
    }

    const baseQuery = `
      FROM orders o
      WHERE o.owner_id = ? AND o.status = 'COMPLETED'${dateFilter}
    `;
    const baseParams = [owner_id, ...dateParams];

    const [summary] = await pool.query(
      `SELECT COUNT(*) as total_orders, 
              COALESCE(SUM(o.total_amount), 0) as total_revenue_gross,
              COALESCE(SUM(o.admin_commission), 0) as admin_commission_deducted,
              COALESCE(SUM(o.owner_earning), 0) as owner_net_earning
       ${baseQuery}`,
      baseParams
    );

    // By service
    const [byService] = await pool.query(
      `SELECT s.name AS service, COUNT(*) as orders, COALESCE(SUM(o.owner_earning), 0) as earning
       FROM orders o
       JOIN services s ON o.service_id = s.service_id
       WHERE o.owner_id = ? AND o.status = 'COMPLETED'${dateFilter}
       GROUP BY s.name`,
      baseParams
    );

    res.json({
      success: true,
      message: 'Success',
      data: {
        period: { from: date_from || null, to: date_to || null },
        total_orders: summary[0].total_orders,
        total_revenue_gross: parseFloat(summary[0].total_revenue_gross),
        admin_commission_deducted: parseFloat(summary[0].admin_commission_deducted),
        owner_net_earning: parseFloat(summary[0].owner_net_earning),
        by_service: byService
      }
    });
  } catch (err) {
    console.error('getReportSummary error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 9.5. Owner: Lihat Orders Milik Owner
// GET /owner/orders
// Auth: Bearer Token (role: owner, verified)
// ============================================
exports.getOwnerOrders = async (req, res) => {
  const owner_id = req.user.id;
  const { status, page = 1, limit = 10 } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.max(1, parseInt(limit) || 10);
  const offset = (pageNum - 1) * limitNum;

  try {
    let whereConditions = ['o.owner_id = ?'];
    let params = [owner_id];

    if (status) {
      whereConditions.push('o.status = ?');
      params.push(status);
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM orders o ${whereClause}`, params);
    const total = countResult[0].total;

    const [orders] = await pool.query(
      `SELECT o.order_id, o.customer_id, o.status, s.name AS service_name, 
              o.weight_kg, o.total_amount, o.created_at
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
    console.error('getOwnerOrders error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
