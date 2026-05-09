const crypto = require('crypto');
const pool = require('../config/db');

// Mendapatkan semua layanan (dengan pagination dan filter)
// GET /services?owner_id=&keyword=&page=1&limit=10
exports.getAllServices = async (req, res) => {
  try {
    const { owner_id, keyword, page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let whereConditions = ['ls.is_active = TRUE'];
    let params = [];

    if (owner_id) {
      whereConditions.push('ls.owner_id = ?');
      params.push(owner_id);
    }

    if (keyword) {
      whereConditions.push('(ls.name LIKE ? OR ls.description LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    // Count total
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM laundry_services ls ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    // Fetch data with JOIN to owner_profiles for shop_name
    const [services] = await pool.query(
      `SELECT ls.id AS service_id, 
              op.shop_name,
              ls.name AS service_name, 
              ls.price_per_kg, 
              ls.estimated_days
       FROM laundry_services ls
       LEFT JOIN owner_profiles op ON ls.owner_id = op.user_id
       ${whereClause}
       ORDER BY ls.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      message: 'Success',
      data: services,
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

// Mendapatkan detail layanan berdasarkan ID
// GET /services/:id
exports.getServiceById = async (req, res) => {
  const { id } = req.params;
  try {
    const [services] = await pool.query(
      `SELECT ls.id AS service_id,
              op.shop_name,
              ls.owner_id,
              ls.name AS service_name,
              ls.description,
              ls.price_per_kg,
              ls.minimum_kg,
              ls.estimated_days,
              op.shop_address AS address,
              ls.is_active
       FROM laundry_services ls
       LEFT JOIN owner_profiles op ON ls.owner_id = op.user_id
       WHERE ls.id = ?`,
      [id]
    );
    
    if (services.length === 0) {
      return res.status(404).json({ message: 'Service not found' });
    }

    res.json({
      message: 'Success',
      data: services[0]
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// Menambahkan layanan baru (Hanya untuk owner)
// POST /services
exports.createService = async (req, res) => {
  const { name, description, price_per_kg, minimum_kg, estimated_days } = req.body;
  const owner_id = req.user.id;

  if (!name || !price_per_kg) {
    return res.status(422).json({
      message: 'Validation error',
      errors: {
        ...((!name) && { name: ['Nama layanan wajib diisi'] }),
        ...((!price_per_kg) && { price_per_kg: ['Harga per kg wajib diisi'] })
      }
    });
  }

  try {
    const serviceId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO laundry_services (id, owner_id, name, description, price_per_kg, minimum_kg, estimated_days) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [serviceId, owner_id, name, description || null, price_per_kg, minimum_kg || 1, estimated_days || 1]
    );

    res.status(201).json({
      message: 'Service created',
      data: {
        service_id: serviceId,
        owner_id,
        name,
        description,
        price_per_kg,
        minimum_kg: minimum_kg || 1,
        estimated_days: estimated_days || 1,
        is_active: true
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
