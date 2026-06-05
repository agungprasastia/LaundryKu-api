const pool = require('../config/db');
const { isPositiveNumber } = require('../helpers/validators');

// ============================================
// 2.1. Get All Services
// GET /services
// Auth: Wajib Bearer Token (semua role)
// - Customer: hanya service yang is_active = 1
// - Owner: semua service miliknya (active/inactive)
// - Admin: semua service
// ============================================
exports.getAllServices = async (req, res) => {
  try {
    let query = '';
    let params = [];

    if (req.user.role === 'admin') {
      // Admin bisa lihat semua service
      query = `SELECT service_id, owner_id, name, description, price_per_kg_owner, price_per_kg_customer, is_active, created_at
               FROM services ORDER BY created_at DESC`;
    } else if (req.user.role === 'owner') {
      // Owner hanya lihat service miliknya (termasuk inactive)
      query = `SELECT service_id, owner_id, name, description, price_per_kg_owner, price_per_kg_customer, is_active, created_at
               FROM services WHERE owner_id = ? ORDER BY created_at DESC`;
      params = [req.user.id];
    } else {
      // Customer & courier: hanya active services
      query = `SELECT service_id, owner_id, name, description, price_per_kg_customer, is_active, created_at
               FROM services WHERE is_active = 1 ORDER BY created_at DESC`;
    }

    const [services] = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Success',
      data: services
    });
  } catch (err) {
    console.error('getAllServices error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 2.2. Get Service Detail
// GET /services/:service_id
// Auth: Wajib Bearer Token (semua role)
// ============================================
exports.getServiceById = async (req, res) => {
  const { service_id } = req.params;
  try {
    const [services] = await pool.query(
      `SELECT service_id, owner_id, name, description, price_per_kg_owner, price_per_kg_customer, is_active
       FROM services WHERE service_id = ?`,
      [service_id]
    );

    if (services.length === 0) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    res.json({ success: true, message: 'Success', data: services[0] });
  } catch (err) {
    console.error('getServiceById error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 2.3. Create Service (Owner)
// POST /services
// Auth: Wajib Bearer Token (role: owner, verified)
// ============================================
exports.createService = async (req, res) => {
  const { service_id, name, description, price_per_kg_owner } = req.body;
  const owner_id = req.user.id;

  // Validasi
  const errors = {};
  if (!service_id) errors.service_id = ['service_id wajib diisi'];
  if (!name) errors.name = ['name wajib diisi'];
  if (!price_per_kg_owner) {
    errors.price_per_kg_owner = ['price_per_kg_owner wajib diisi'];
  } else if (!isPositiveNumber(price_per_kg_owner)) {
    errors.price_per_kg_owner = ['price_per_kg_owner harus lebih dari 0'];
  }

  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ success: false, message: 'Validation error', errors });
  }

  try {
    // Cek duplikat service_id
    const [existing] = await pool.query('SELECT service_id FROM services WHERE service_id = ?', [service_id]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Service ID already exists' });
    }

    // Hitung harga customer otomatis +15%
    const price_per_kg_customer = Math.round(parseFloat(price_per_kg_owner) * 1.15);

    await pool.query(
      `INSERT INTO services (service_id, owner_id, name, description, price_per_kg_owner, price_per_kg_customer) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [service_id, owner_id, name, description || null, price_per_kg_owner, price_per_kg_customer]
    );

    res.status(201).json({
      success: true,
      message: 'Service created',
      data: {
        service_id,
        owner_id,
        name,
        price_per_kg_owner: parseFloat(price_per_kg_owner),
        price_per_kg_customer,
        is_active: true
      }
    });
  } catch (err) {
    console.error('createService error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 2.4. Update Service
// PATCH /services/:service_id
// Auth: Wajib Bearer Token (role: owner, verified)
// Owner hanya bisa update service miliknya
// ============================================
exports.updateService = async (req, res) => {
  const { service_id } = req.params;
  const { price_per_kg_owner, is_active, name, description } = req.body;
  const owner_id = req.user.id;

  try {
    // Cek service ada dan milik owner ini
    const [services] = await pool.query('SELECT * FROM services WHERE service_id = ? AND owner_id = ?', [service_id, owner_id]);
    if (services.length === 0) {
      return res.status(404).json({ success: false, message: 'Service not found or not owned by you' });
    }

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (price_per_kg_owner !== undefined) {
      if (!isPositiveNumber(price_per_kg_owner)) {
        return res.status(422).json({ success: false, message: 'price_per_kg_owner harus lebih dari 0' });
      }
      const price_per_kg_customer = Math.round(parseFloat(price_per_kg_owner) * 1.15);
      updates.push('price_per_kg_owner = ?');
      params.push(price_per_kg_owner);
      updates.push('price_per_kg_customer = ?');
      params.push(price_per_kg_customer);
    }

    if (updates.length === 0) {
      return res.status(422).json({ success: false, message: 'Validation error', errors: { body: ['Tidak ada field yang diperbarui'] } });
    }

    params.push(service_id);
    await pool.query(`UPDATE services SET ${updates.join(', ')} WHERE service_id = ?`, params);

    // Ambil data terbaru
    const [updated] = await pool.query(
      'SELECT service_id, owner_id, name, price_per_kg_owner, price_per_kg_customer, is_active FROM services WHERE service_id = ?',
      [service_id]
    );

    res.json({
      success: true,
      message: 'Service updated',
      data: updated[0]
    });
  } catch (err) {
    console.error('updateService error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 2.5. Delete Service
// DELETE /services/:service_id
// Auth: Wajib Bearer Token (role: owner, verified)
// Owner hanya bisa delete service miliknya
// ============================================
exports.deleteService = async (req, res) => {
  const { service_id } = req.params;
  const owner_id = req.user.id;

  try {
    const [services] = await pool.query('SELECT service_id FROM services WHERE service_id = ? AND owner_id = ?', [service_id, owner_id]);
    if (services.length === 0) {
      return res.status(404).json({ success: false, message: 'Service not found or not owned by you' });
    }

    await pool.query('DELETE FROM services WHERE service_id = ?', [service_id]);

    res.json({ success: true, message: 'Service deleted successfully' });
  } catch (err) {
    console.error('deleteService error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
