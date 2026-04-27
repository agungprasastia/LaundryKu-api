const pool = require('../config/db');

// Assign kurir ke order (Biasanya dilakukan oleh admin atau owner, atau kurir mengambil sendiri)
exports.assignCourier = async (req, res) => {
  const { order_id, courier_id } = req.body;

  try {
    const [result] = await pool.query(
      'INSERT INTO courier_assignments (order_id, courier_id) VALUES (?, ?)',
      [order_id, courier_id]
    );

    res.status(201).json({
      message: 'Kurir berhasil di-assign',
      assignment: {
        id: result.insertId,
        order_id,
        courier_id,
        status: 'assigned'
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// Melihat tracking berdasarkan order_id
exports.getTracking = async (req, res) => {
  const { order_id } = req.params;

  try {
    // Cari assignment kurir untuk order ini
    const [assignments] = await pool.query(
      'SELECT * FROM courier_assignments WHERE order_id = ?',
      [order_id]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ error: 'Belum ada kurir yang di-assign untuk order ini' });
    }

    const assignment = assignments[0];
    const courier_id = assignment.courier_id;

    // Cari lokasi terakhir kurir
    const [locations] = await pool.query(
      'SELECT lat, lng, updated_at FROM courier_locations WHERE courier_id = ? ORDER BY updated_at DESC LIMIT 1',
      [courier_id]
    );

    res.json({
      status_pengiriman: assignment.status,
      lokasi_terakhir: locations.length > 0 ? locations[0] : null
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// (Opsional) Kurir update lokasi
exports.updateLocation = async (req, res) => {
  const { lat, lng } = req.body;
  const courier_id = req.user.id;

  try {
    // Insert lokasi kurir
    const [result] = await pool.query(
      'INSERT INTO courier_locations (courier_id, lat, lng) VALUES (?, ?, ?)',
      [courier_id, lat, lng]
    );

    res.json({
      message: 'Lokasi berhasil diupdate',
      location: {
        id: result.insertId,
        courier_id,
        lat,
        lng
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};
