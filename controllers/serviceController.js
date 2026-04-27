const pool = require('../config/db');

// Mendapatkan semua layanan
exports.getAllServices = async (req, res) => {
  try {
    const [services] = await pool.query('SELECT * FROM laundry_services');
    res.json(services);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// Mendapatkan detail layanan berdasarkan ID
exports.getServiceById = async (req, res) => {
  const { id } = req.params;
  try {
    const [services] = await pool.query('SELECT * FROM laundry_services WHERE id = ?', [id]);
    
    if (services.length === 0) {
      return res.status(404).json({ error: 'Layanan tidak ditemukan' });
    }

    res.json(services[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// (Opsional) Menambahkan layanan baru (Hanya untuk owner)
exports.createService = async (req, res) => {
  const { name, price_per_kg } = req.body;
  const owner_id = req.user.id;

  try {
    const [result] = await pool.query(
      'INSERT INTO laundry_services (owner_id, name, price_per_kg) VALUES (?, ?, ?)',
      [owner_id, name, price_per_kg]
    );

    res.status(201).json({
      id: result.insertId,
      owner_id,
      name,
      price_per_kg
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};
