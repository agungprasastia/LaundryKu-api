const pool = require('../config/db');
const { createNotification } = require('../helpers/notification');
const { isValidLatLng } = require('../helpers/validators');

// ============================================
// 5.1. Update Lokasi Kurir
// PATCH /couriers/me/location
// Auth: Bearer Token (role: courier, verified)
// ============================================
exports.updateLocation = async (req, res) => {
  const { lat, lng, assignment_id } = req.body;
  const courier_id = req.user.id;

  // Validasi
  const errors = {};
  if (lat === undefined || lat === null) errors.lat = ['lat wajib diisi'];
  if (lng === undefined || lng === null) errors.lng = ['lng wajib diisi'];
  if (!assignment_id) errors.assignment_id = ['assignment_id wajib diisi'];

  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ success: false, message: 'Validation error', errors });
  }

  if (!isValidLatLng(lat, lng)) {
    return res.status(422).json({ success: false, message: 'lat harus -90..90, lng harus -180..180' });
  }

  try {
    // Cek assignment milik courier ini
    const [assignments] = await pool.query(
      'SELECT assignment_id FROM courier_assignments WHERE assignment_id = ? AND courier_id = ?',
      [assignment_id, courier_id]
    );
    if (assignments.length === 0) {
      return res.status(403).json({ success: false, message: 'Assignment not found or not assigned to you' });
    }

    await pool.query(
      `INSERT INTO courier_locations (courier_id, assignment_id, lat, lng) VALUES (?, ?, ?, ?)`,
      [courier_id, assignment_id, lat, lng]
    );

    res.json({
      success: true,
      message: 'Location updated',
      data: { courier_id, lat: parseFloat(lat), lng: parseFloat(lng) }
    });
  } catch (err) {
    console.error('updateLocation error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 5.2. Update Status Tugas Kurir
// PATCH /couriers/tasks/:assignment_id/status
// Auth: Bearer Token (role: courier, verified)
// FIX: try/catch/finally untuk connection leak
// ============================================
exports.updateTaskStatus = async (req, res) => {
  const { assignment_id } = req.params;
  const { status } = req.body;
  const courier_id = req.user.id;

  if (!status) {
    return res.status(422).json({ success: false, message: 'status wajib diisi' });
  }

  try {
    const [assignments] = await pool.query(
      'SELECT * FROM courier_assignments WHERE assignment_id = ?',
      [assignment_id]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    const assignment = assignments[0];

    if (assignment.courier_id !== courier_id) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      let phase = assignment.current_phase;
      let orderStatusUpdate = null;

      const [orders] = await connection.query('SELECT * FROM orders WHERE order_id = ?', [assignment.order_id]);
      const order = orders.length > 0 ? orders[0] : null;

      if (phase === 'pickup') {
        const validPickup = ['PICKUP_ON_THE_WAY', 'LAUNDRY_PICKED'];
        if (!validPickup.includes(status)) {
          await connection.rollback();
          return res.status(422).json({ 
            success: false,
            message: `Invalid status for pickup phase. Valid: ${validPickup.join(', ')}. Received: ${status}` 
          });
        }

        if (status === 'PICKUP_ON_THE_WAY' && assignment.pickup_status) {
          await connection.rollback();
          return res.status(422).json({ success: false, message: `Pickup already started. Current status: ${assignment.pickup_status}` });
        }
        if (status === 'LAUNDRY_PICKED' && assignment.pickup_status !== 'PICKUP_ON_THE_WAY') {
          await connection.rollback();
          return res.status(422).json({ success: false, message: `Must be PICKUP_ON_THE_WAY before LAUNDRY_PICKED. Current: ${assignment.pickup_status}` });
        }

        await connection.query(
          'UPDATE courier_assignments SET pickup_status = ? WHERE assignment_id = ?',
          [status, assignment_id]
        );
        orderStatusUpdate = status;

        if (order) {
          if (status === 'PICKUP_ON_THE_WAY') {
            await createNotification(connection, order.customer_id, 'Kurir Dalam Perjalanan',
              `Kurir sedang menuju lokasi Anda untuk mengambil laundry (Order ${assignment.order_id}).`);
          } else if (status === 'LAUNDRY_PICKED') {
            await createNotification(connection, order.customer_id, 'Laundry Diambil',
              `Laundry Anda telah diambil oleh kurir (Order ${assignment.order_id}).`);
            if (order.owner_id) {
              await createNotification(connection, order.owner_id, 'Laundry Diambil',
                `Kurir telah mengambil laundry untuk order ${assignment.order_id}. Silakan input berat setelah menerima.`);
            }
          }
        }

      } else if (phase === 'delivery') {
        const validDelivery = ['DELIVERY_ON_THE_WAY', 'DELIVERED', 'DONE'];
        if (!validDelivery.includes(status)) {
          await connection.rollback();
          return res.status(422).json({ 
            success: false,
            message: `Invalid status for delivery phase. Valid: ${validDelivery.join(', ')}. Received: ${status}` 
          });
        }

        if (status === 'DELIVERY_ON_THE_WAY' && assignment.delivery_status) {
          await connection.rollback();
          return res.status(422).json({ success: false, message: `Delivery already started. Current: ${assignment.delivery_status}` });
        }
        if (status === 'DELIVERED' && assignment.delivery_status !== 'DELIVERY_ON_THE_WAY') {
          await connection.rollback();
          return res.status(422).json({ success: false, message: `Must be DELIVERY_ON_THE_WAY before DELIVERED. Current: ${assignment.delivery_status}` });
        }
        if (status === 'DONE' && assignment.delivery_status !== 'DELIVERED') {
          await connection.rollback();
          return res.status(422).json({ success: false, message: `Must be DELIVERED before DONE. Current: ${assignment.delivery_status}` });
        }

        await connection.query(
          'UPDATE courier_assignments SET delivery_status = ? WHERE assignment_id = ?',
          [status, assignment_id]
        );

        if (status === 'DONE') {
          orderStatusUpdate = 'DELIVERED';
        } else if (status === 'DELIVERY_ON_THE_WAY') {
          orderStatusUpdate = 'DELIVERY_ON_THE_WAY';
        }

        if (order) {
          if (status === 'DELIVERY_ON_THE_WAY') {
            await createNotification(connection, order.customer_id, 'Laundry Sedang Diantar',
              `Kurir sedang mengantar laundry Anda (Order ${assignment.order_id}).`);
          } else if (status === 'DONE') {
            await createNotification(connection, order.customer_id, 'Laundry Tiba',
              `Laundry Anda telah diantar (Order ${assignment.order_id}). Silakan konfirmasi penerimaan.`);
          }
        }
      } else {
        await connection.rollback();
        return res.status(422).json({ success: false, message: `Invalid phase: ${phase}` });
      }

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

      res.json({
        success: true,
        message: 'Task status updated',
        data: { assignment_id, phase, status, order_status_updated_to: orderStatusUpdate }
      });
    } catch (innerErr) {
      await connection.rollback();
      throw innerErr;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('updateTaskStatus error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 5.3. Tugas Aktif Kurir
// GET /couriers/me/tasks
// Auth: Bearer Token (role: courier, verified)
// ============================================
exports.getTasks = async (req, res) => {
  const courier_id = req.user.id;

  try {
    const [tasks] = await pool.query(
      `SELECT ca.assignment_id, ca.order_id, ca.current_phase,
              ca.pickup_status, ca.delivery_status,
              CASE 
                WHEN ca.current_phase = 'pickup' THEN ca.pickup_status
                ELSE ca.delivery_status
              END AS status,
              o.status AS order_status,
              o.pickup_address,
              o.pickup_lat,
              o.pickup_lng,
              o.delivery_address,
              o.delivery_lat,
              o.delivery_lng,
              ow.lat AS owner_lat,
              ow.lng AS owner_lng,
              c.full_name AS customer_name,
              s.name AS service_name
       FROM courier_assignments ca
       LEFT JOIN orders o ON ca.order_id = o.order_id
       LEFT JOIN users c ON o.customer_id = c.user_id
       LEFT JOIN users ow ON o.owner_id = ow.user_id
       LEFT JOIN services s ON o.service_id = s.service_id
       WHERE ca.courier_id = ? AND (ca.delivery_status IS NULL OR ca.delivery_status != 'DONE')
       ORDER BY ca.created_at DESC`,
      [courier_id]
    );

    res.json({ success: true, message: 'Success', data: tasks });
  } catch (err) {
    console.error('getTasks error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 5.4. Riwayat Tugas Kurir
// GET /couriers/me/tasks/history
// Auth: Bearer Token (role: courier, verified)
// ============================================
exports.getTaskHistory = async (req, res) => {
  const courier_id = req.user.id;

  try {
    const [tasks] = await pool.query(
      `SELECT ca.assignment_id, ca.order_id, ca.pickup_status, ca.delivery_status,
              o.courier_earning, ca.updated_at AS completed_at,
              o.status AS order_status,
              o.pickup_address,
              o.delivery_address,
              c.full_name AS customer_name,
              s.name AS service_name
       FROM courier_assignments ca
       LEFT JOIN orders o ON ca.order_id = o.order_id
       LEFT JOIN users c ON o.customer_id = c.user_id
       LEFT JOIN services s ON o.service_id = s.service_id
       WHERE ca.courier_id = ? AND ca.delivery_status = 'DONE'
       ORDER BY ca.updated_at DESC`,
      [courier_id]
    );

    res.json({ success: true, message: 'Success', data: tasks });
  } catch (err) {
    console.error('getTaskHistory error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 5.5. Courier Tersedia
// GET /couriers/available
// Auth: Bearer Token (role: owner, admin)
// ============================================
exports.getAvailableCouriers = async (req, res) => {
  try {
    const [couriers] = await pool.query(
      `SELECT u.user_id, u.full_name, u.vehicle_name, u.vehicle_plate_number, u.address
       FROM users u
       WHERE u.role = 'courier' AND u.is_verified = 1
       AND u.user_id NOT IN (
         SELECT ca.courier_id FROM courier_assignments ca
         WHERE ca.delivery_status IS NULL OR ca.delivery_status != 'DONE'
       )
       ORDER BY u.full_name ASC`
    );

    res.json({ success: true, message: 'Success', data: couriers });
  } catch (err) {
    console.error('getAvailableCouriers error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 9.3. Laporan Kurir (Earnings)
// GET /couriers/me/earnings
// Auth: Bearer Token (role: courier, verified)
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

    const [wallet] = await pool.query('SELECT * FROM wallets WHERE user_id = ?', [courier_id]);
    const available_balance = wallet.length > 0 ? parseFloat(wallet[0].available_balance) : 0;
    const pending_balance = wallet.length > 0 ? parseFloat(wallet[0].pending_balance) : 0;

    const totalDeliveries = summary[0].total_deliveries;
    const totalEarned = parseFloat(summary[0].total_earned);

    let days = 1;
    if (date_from && date_to) {
      const d1 = new Date(date_from);
      const d2 = new Date(date_to);
      days = Math.max(1, Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24)));
    }
    const avg_per_day = Math.round(totalEarned / days);

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
      success: true,
      message: 'Success',
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
    console.error('getEarnings error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
