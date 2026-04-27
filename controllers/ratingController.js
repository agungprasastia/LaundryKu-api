const pool = require('../config/db');

// Memberikan rating
exports.createRating = async (req, res) => {
  const { order_id, score } = req.body;
  const customer_id = req.user.id;

  try {
    // Pastikan order ini milik customer tersebut
    const [orders] = await pool.query(
      'SELECT * FROM orders WHERE id = ? AND customer_id = ?',
      [order_id, customer_id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order tidak ditemukan atau Anda tidak berhak.' });
    }

    if (orders[0].status !== 'completed') {
      // Untuk simulasi, kita biarkan saja atau beri warning. Idealnya order harus 'completed'.
      // return res.status(400).json({ error: 'Order belum selesai.' });
    }

    // Insert rating
    const [result] = await pool.query(
      'INSERT INTO ratings (order_id, customer_id, score) VALUES (?, ?, ?)',
      [order_id, customer_id, score]
    );

    res.status(201).json({
      message: 'Rating berhasil diberikan',
      rating: {
        id: result.insertId,
        order_id,
        customer_id,
        score
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};
