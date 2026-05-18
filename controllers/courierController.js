const pool = require('../config/db');

// ============================================
// 5.1. Update Lokasi Kurir
// PATCH /couriers/me/location
// Auth: Bearer Token (role: courier)
// ============================================
exports.updateLocation = async (req, res) => {
  const { lat, lng, assignment_id } = req.body;
  const courier_id = req.user.id;

  if (!lat || !lng || !assignment_id) {
    return res.status(422).json({
      message: 'Validation error',
      errors: {
        ...((!lat) && { lat: ['lat wajib diisi'] }),
        ...((!lng) && { lng: ['lng wajib diisi'] }),
        ...((!assignment_id) && { assignment_id: ['assignment_id wajib diisi'] })
      }
    });
  }

  try {
    await pool.query(
      `INSERT INTO courier_locations (courier_id, assignment_id, lat, lng) VALUES (?, ?, ?, ?)`,
      [courier_id, assignment_id, lat, lng]
    );

    res.json({
      message: 'Location updated',
      data: { courier_id, lat, lng }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 5.2. Update Status Tugas Kurir
// PATCH /couriers/tasks/:assignment_id/status
// Auth: Bearer Token (role: courier)
// ============================================
exports.updateTaskStatus = async (req, res) => {
  const { assignment_id } = req.params;
  const { status } = req.body;
  const courier_id = req.user.id;

  if (!status) {
    return res.status(422).json({ message: 'status wajib diisi' });
  }

  try {
    const [assignments] = await pool.query(
      'SELECT * FROM courier_assignments WHERE assignment_id = ?',
      [assignment_id]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    const assignment = assignments[0];

    if (assignment.courier_id !== courier_id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    let phase = assignment.current_phase;
    let orderStatusUpdate = null;
    let note = null;

    if (phase === 'pickup') {
      // Pickup phase: PICKUP_ON_THE_WAY → LAUNDRY_PICKED
      const validPickup = ['PICKUP_ON_THE_WAY', 'LAUNDRY_PICKED'];
      if (!validPickup.includes(status)) {
        connection.release();
        return res.status(422).json({ 
          message: `Invalid status transition. Current phase: pickup. Valid: ${validPickup.join(', ')}` 
        });
      }

      // Flow validation
      if (status === 'LAUNDRY_PICKED' && assignment.pickup_status !== 'PICKUP_ON_THE_WAY') {
        connection.release();
        return res.status(422).json({ message: 'Must be PICKUP_ON_THE_WAY before LAUNDRY_PICKED' });
      }

      await connection.query(
        'UPDATE courier_assignments SET pickup_status = ? WHERE assignment_id = ?',
        [status, assignment_id]
      );

      orderStatusUpdate = status;

      if (status === 'LAUNDRY_PICKED') {
        note = 'Laundry dalam perjalanan ke tempat cuci';
      }

    } else if (phase === 'delivery') {
      // Delivery phase: DELIVERY_ON_THE_WAY → DELIVERED → DONE
      const validDelivery = ['DELIVERY_ON_THE_WAY', 'DELIVERED', 'DONE'];
      if (!validDelivery.includes(status)) {
        connection.release();
        return res.status(422).json({ 
          message: `Invalid status transition. Current phase: delivery. Valid: ${validDelivery.join(', ')}` 
        });
      }

      // Flow validation
      if (status === 'DELIVERED' && assignment.delivery_status !== 'DELIVERY_ON_THE_WAY') {
        connection.release();
        return res.status(422).json({ message: 'Must be DELIVERY_ON_THE_WAY before DELIVERED' });
      }
      if (status === 'DONE' && assignment.delivery_status !== 'DELIVERED') {
        connection.release();
        return res.status(422).json({ message: 'Must be DELIVERED before DONE' });
      }

      await connection.query(
        'UPDATE courier_assignments SET delivery_status = ? WHERE assignment_id = ?',
        [status, assignment_id]
      );

      if (status === 'DONE') {
        // DONE di courier_assignments → order status menjadi DELIVERED
        orderStatusUpdate = 'DELIVERED';
        note = 'Menunggu konfirmasi customer untuk COMPLETED';
      } else {
        orderStatusUpdate = status === 'DELIVERED' ? null : status;
        if (status === 'DELIVERY_ON_THE_WAY') orderStatusUpdate = 'DELIVERY_ON_THE_WAY';
      }
    } else {
      connection.release();
      return res.status(422).json({ message: `Invalid phase: ${phase}` });
    }

    // Update order status
    if (orderStatusUpdate) {
      await connection.query(
        'UPDATE orders SET status = ? WHERE order_id = ?',
        [orderStatusUpdate, assignment.order_id]
      );
      await connection.query(
        'INSERT INTO order_status_logs (order_id, status, changed_by) VALUES (?, ?, ?)',
        [assignment.order_id, orderStatusUpdate, courier_id]
      );
    }

    await connection.commit();
    connection.release();

    const responseData = {
      assignment_id,
      phase,
      status,
      order_status_updated_to: orderStatusUpdate
    };
    if (note) responseData.note = note;

    res.json({
      message: 'Task status updated',
      data: responseData
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 5.3. Tugas Aktif Kurir
// GET /couriers/me/tasks
// Auth: Bearer Token (role: courier)
// ============================================
exports.getTasks = async (req, res) => {
  const courier_id = req.user.id;

  try {
    const [tasks] = await pool.query(
      `SELECT ca.assignment_id, ca.order_id, ca.current_phase,
              CASE 
                WHEN ca.current_phase = 'pickup' THEN ca.pickup_status
                ELSE ca.delivery_status
              END AS task_status,
              o.pickup_address AS customer_address,
              o.pickup_lat AS customer_lat,
              o.pickup_lng AS customer_lng
       FROM courier_assignments ca
       LEFT JOIN orders o ON ca.order_id = o.order_id
       WHERE ca.courier_id = ? AND ca.delivery_status != 'DONE'
       ORDER BY ca.created_at DESC`,
      [courier_id]
    );

    res.json({ data: tasks });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 5.4. Riwayat Tugas Kurir
// GET /couriers/me/tasks/history
// Auth: Bearer Token (role: courier)
// ============================================
exports.getTaskHistory = async (req, res) => {
  const courier_id = req.user.id;

  try {
    const [tasks] = await pool.query(
      `SELECT ca.assignment_id, ca.order_id, ca.pickup_status, ca.delivery_status,
              o.courier_earning, ca.updated_at AS completed_at
       FROM courier_assignments ca
       LEFT JOIN orders o ON ca.order_id = o.order_id
       WHERE ca.courier_id = ? AND ca.delivery_status = 'DONE'
       ORDER BY ca.updated_at DESC`,
      [courier_id]
    );

    res.json({ data: tasks });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 9.3. Laporan Kurir (Earnings)
// GET /couriers/me/earnings
// Auth: Bearer Token (role: courier)
// ============================================
exports.getEarnings = async (req, res) => {
  const courier_id = req.user.id;
  const { date_from, date_to } = req.query;

  try {
    let whereConditions = ['ca.courier_id = ?', "ca.delivery_status = 'DONE'"];
    let params = [courier_id];

    if (date_from) { whereConditions.push('ca.updated_at >= ?'); params.push(date_from); }
    if (date_to) { whereConditions.push('ca.updated_at <= ?'); params.push(date_to + ' 23:59:59'); }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    const [summary] = await pool.query(
      `SELECT COUNT(*) AS total_deliveries, COALESCE(SUM(o.courier_earning), 0) AS total_earned
       FROM courier_assignments ca
       LEFT JOIN orders o ON ca.order_id = o.order_id
       ${whereClause}`,
      params
    );

    // Get wallet balance
    const [wallet] = await pool.query('SELECT * FROM wallets WHERE user_id = ?', [courier_id]);
    const available_balance = wallet.length > 0 ? parseFloat(wallet[0].available_balance) : 0;
    const pending_balance = wallet.length > 0 ? parseFloat(wallet[0].pending_balance) : 0;

    const totalDeliveries = summary[0].total_deliveries;
    const totalEarned = parseFloat(summary[0].total_earned);

    // Hitung rata-rata per hari
    let days = 1;
    if (date_from && date_to) {
      const d1 = new Date(date_from);
      const d2 = new Date(date_to);
      days = Math.max(1, Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24)));
    }
    const avg_per_day = Math.round(totalEarned / days);

    // By day
    const [byDay] = await pool.query(
      `SELECT DATE(ca.updated_at) AS date, COUNT(*) AS deliveries, COALESCE(SUM(o.courier_earning), 0) AS earned
       FROM courier_assignments ca
       LEFT JOIN orders o ON ca.order_id = o.order_id
       ${whereClause}
       GROUP BY DATE(ca.updated_at)
       ORDER BY date DESC`,
      params
    );

    res.json({
      data: {
        total_deliveries: totalDeliveries,
        total_earned: totalEarned,
        available_balance,
        pending_balance,
        avg_per_day,
        by_day: byDay
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
