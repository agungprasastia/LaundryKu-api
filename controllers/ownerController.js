const pool = require('../config/db');

// ============================================
// 9.2. Laporan Owner
// GET /owner/reports/summary
// Auth: Bearer Token (role: owner)
// ============================================
exports.getReportSummary = async (req, res) => {
  const owner_id = req.user.id;
  const { date_from, date_to, group_by } = req.query;

  try {
    let dateFilter = '';
    let dateParams = [];
    if (date_from && date_to) {
      dateFilter = ' AND o.created_at >= ? AND o.created_at <= ?';
      dateParams = [date_from, date_to + ' 23:59:59'];
    }

    // Ambil orders yang dikonfirmasi oleh owner ini
    const baseQuery = `
      FROM orders o
      JOIN order_status_logs osl ON o.order_id = osl.order_id AND osl.status = 'CONFIRMED' AND osl.changed_by = ?
      WHERE o.status = 'COMPLETED'${dateFilter}
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

    // By service (proper JOIN)
    const [byServiceFixed] = await pool.query(
      `SELECT s.name AS service, COUNT(*) as orders, COALESCE(SUM(o.owner_earning), 0) as earning
       FROM orders o
       JOIN order_status_logs osl ON o.order_id = osl.order_id AND osl.status = 'CONFIRMED' AND osl.changed_by = ?
       JOIN services s ON o.service_id = s.service_id
       WHERE o.status = 'COMPLETED'${dateFilter}
       GROUP BY s.name`,
      baseParams
    );

    res.json({
      data: {
        period: { from: date_from || null, to: date_to || null },
        total_orders: summary[0].total_orders,
        total_revenue_gross: parseFloat(summary[0].total_revenue_gross),
        admin_commission_deducted: parseFloat(summary[0].admin_commission_deducted),
        owner_net_earning: parseFloat(summary[0].owner_net_earning),
        by_service: byServiceFixed
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
