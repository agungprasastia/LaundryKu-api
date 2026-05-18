const pool = require('../config/db');

// ============================================
// 2.1. Get All Services
// GET /services
// Auth: Wajib Bearer Token (semua role)
// ============================================
exports.getAllServices = async (req, res) => {
  try {
    const [services] = await pool.query(
      `SELECT service_id, name, price_per_kg_owner, price_per_kg_customer, is_active
       FROM services WHERE is_active = 1
       ORDER BY created_at DESC`
    );

    res.json({
      message: 'Success',
      data: services
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
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
      `SELECT service_id, name, description, price_per_kg_owner, price_per_kg_customer, is_active
       FROM services WHERE service_id = ?`,
      [service_id]
    );

    if (services.length === 0) {
      return res.status(404).json({ message: 'Service not found' });
    }

    res.json({ data: services[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 2.3. Create Service (Owner)
// POST /services
// Auth: Wajib Bearer Token (role: owner)
// ============================================
exports.createService = async (req, res) => {
  const { service_id, name, description, price_per_kg_owner } = req.body;

  // Validasi
  const errors = {};
  if (!service_id) errors.service_id = ['service_id wajib diisi'];
  if (!name) errors.name = ['name wajib diisi'];
  if (!price_per_kg_owner) errors.price_per_kg_owner = ['price_per_kg_owner wajib diisi'];

  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ message: 'Validation error', errors });
  }

  try {
    // Cek duplikat service_id
    const [existing] = await pool.query('SELECT service_id FROM services WHERE service_id = ?', [service_id]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Service ID already exists' });
    }

    // Hitung harga customer otomatis +15%
    const price_per_kg_customer = Math.round(price_per_kg_owner * 1.15);

    await pool.query(
      `INSERT INTO services (service_id, name, description, price_per_kg_owner, price_per_kg_customer) 
       VALUES (?, ?, ?, ?, ?)`,
      [service_id, name, description || null, price_per_kg_owner, price_per_kg_customer]
    );

    res.status(201).json({
      message: 'Service created',
      data: {
        service_id,
        price_per_kg_owner,
        price_per_kg_customer,
        is_active: true
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 2.4. Update Service
// PATCH /services/:service_id
// Auth: Wajib Bearer Token (role: owner)
// ============================================
exports.updateService = async (req, res) => {
  const { service_id } = req.params;
  const { price_per_kg_owner, is_active, name, description } = req.body;

  try {
    // Cek service ada
    const [services] = await pool.query('SELECT * FROM services WHERE service_id = ?', [service_id]);
    if (services.length === 0) {
      return res.status(404).json({ message: 'Service not found' });
    }

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (price_per_kg_owner !== undefined) {
      const price_per_kg_customer = Math.round(price_per_kg_owner * 1.15);
      updates.push('price_per_kg_owner = ?');
      params.push(price_per_kg_owner);
      updates.push('price_per_kg_customer = ?');
      params.push(price_per_kg_customer);
    }

    if (updates.length === 0) {
      return res.status(422).json({ message: 'Validation error', errors: { body: ['Tidak ada field yang diperbarui'] } });
    }

    params.push(service_id);
    await pool.query(`UPDATE services SET ${updates.join(', ')} WHERE service_id = ?`, params);

    // Ambil data terbaru
    const [updated] = await pool.query(
      'SELECT service_id, price_per_kg_owner, price_per_kg_customer FROM services WHERE service_id = ?',
      [service_id]
    );

    res.json({
      message: 'Service updated',
      data: updated[0]
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 2.5. Delete Service
// DELETE /services/:service_id
// Auth: Wajib Bearer Token (role: owner)
// ============================================
exports.deleteService = async (req, res) => {
  const { service_id } = req.params;

  try {
    const [services] = await pool.query('SELECT service_id FROM services WHERE service_id = ?', [service_id]);
    if (services.length === 0) {
      return res.status(404).json({ message: 'Service not found' });
    }

    await pool.query('DELETE FROM services WHERE service_id = ?', [service_id]);

    res.json({ message: 'Service deleted successfully' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
