const crypto = require('crypto');
const pool = require('../config/db');

// ============================================
// Update lokasi kurir (Real-time)
// PATCH /couriers/me/location
// Auth: Bearer Token (role: courier)
// ============================================
exports.updateLocation = async (req, res) => {
  const { lat, lng, assignment_id } = req.body;
  const courier_id = req.user.id;

  if (!lat || !lng) {
    return res.status(422).json({
      message: 'Validation error',
      errors: {
        ...((!lat) && { lat: ['Latitude wajib diisi'] }),
        ...((!lng) && { lng: ['Longitude wajib diisi'] })
      }
    });
  }

  try {
    // Verifikasi bahwa user ini memang courier
    const [couriers] = await pool.query(
      "SELECT id FROM users WHERE id = ? AND role = 'courier'",
      [courier_id]
    );
    if (couriers.length === 0) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const locationId = crypto.randomUUID();
    const recordedAt = new Date().toISOString();

    await pool.query(
      `INSERT INTO courier_locations (id, courier_id, assignment_id, lat, lng) 
       VALUES (?, ?, ?, ?, ?)`,
      [locationId, courier_id, assignment_id || null, lat, lng]
    );

    res.json({
      message: 'Location updated',
      data: {
        courier_id,
        lat,
        lng,
        recorded_at: recordedAt
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// Lihat daftar tugas kurir
// GET /couriers/me/tasks?status=&page=1&limit=10
// Auth: Bearer Token (role: courier)
// ============================================
exports.getTasks = async (req, res) => {
  const courier_id = req.user.id;
  const { status, page = 1, limit = 10 } = req.query;
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  try {
    let whereConditions = ['ca.courier_id = ?'];
    let params = [courier_id];

    if (status === 'active') {
      whereConditions.push("ca.status NOT IN ('done', 'cancelled')");
    } else if (status) {
      whereConditions.push('ca.status = ?');
      params.push(status);
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    // Count
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM courier_assignments ca ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    // Fetch
    const [tasks] = await pool.query(
      `SELECT ca.id AS assignment_id,
              ca.order_id,
              ca.task_type,
              ca.status,
              o.pickup_address,
              u.full_name AS customer_name,
              u.phone AS customer_phone,
              o.pickup_scheduled_at AS scheduled_at
       FROM courier_assignments ca
       LEFT JOIN orders o ON ca.order_id = o.id
       LEFT JOIN users u ON o.customer_id = u.id
       ${whereClause}
       ORDER BY ca.assigned_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      message: 'Success',
      data: tasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// History pekerjaan kurir
// GET /couriers/me/tasks/history?page=1&limit=10&date_from=&date_to=
// Auth: Bearer Token (role: courier)
// ============================================
exports.getTaskHistory = async (req, res) => {
  const courier_id = req.user.id;
  const { page = 1, limit = 10, date_from, date_to } = req.query;
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  try {
    let whereConditions = ["ca.courier_id = ?", "ca.status = 'done'"];
    let params = [courier_id];

    if (date_from) {
      whereConditions.push('ca.done_at >= ?');
      params.push(date_from);
    }

    if (date_to) {
      whereConditions.push('ca.done_at <= ?');
      params.push(date_to + ' 23:59:59');
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    // Count
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM courier_assignments ca ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    // Fetch
    const [tasks] = await pool.query(
      `SELECT ca.id AS assignment_id,
              ca.order_id,
              ca.task_type,
              ca.status,
              o.pickup_address,
              u.full_name AS customer_name,
              ca.done_at AS completed_at
       FROM courier_assignments ca
       LEFT JOIN orders o ON ca.order_id = o.id
       LEFT JOIN users u ON o.customer_id = u.id
       ${whereClause}
       ORDER BY ca.done_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      message: 'Success',
      data: tasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// Melihat tracking berdasarkan order_id
// GET /tracking/:order_id
// Auth: Bearer Token
// ============================================
exports.getTracking = async (req, res) => {
  const { order_id } = req.params;

  try {
    // Cari assignment kurir untuk order ini
    const [assignments] = await pool.query(
      'SELECT * FROM courier_assignments WHERE order_id = ? ORDER BY assigned_at DESC LIMIT 1',
      [order_id]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ message: 'No courier assigned for this order' });
    }

    const assignment = assignments[0];
    const courier_id = assignment.courier_id;

    // Cari lokasi terakhir kurir
    const [locations] = await pool.query(
      'SELECT lat, lng, recorded_at FROM courier_locations WHERE courier_id = ? ORDER BY recorded_at DESC LIMIT 1',
      [courier_id]
    );

    res.json({
      message: 'Success',
      data: {
        assignment_status: assignment.status,
        task_type: assignment.task_type,
        courier_id,
        last_location: locations.length > 0 ? locations[0] : null
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
