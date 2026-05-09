const crypto = require('crypto');
const pool = require('../config/db');

// ============================================
// Memberikan rating dan review
// POST /ratings
// Auth: Bearer Token (role: customer)
// ============================================
exports.createRating = async (req, res) => {
  const { order_id, score, review } = req.body;
  const customer_id = req.user.id;

  // Validasi input
  if (!order_id || !score) {
    return res.status(422).json({
      message: 'Validation error',
      errors: {
        ...((!order_id) && { order_id: ['Order ID wajib diisi'] }),
        ...((!score) && { score: ['Score wajib diisi'] })
      }
    });
  }

  if (score < 1 || score > 5) {
    return res.status(422).json({
      message: 'Validation error',
      errors: { score: ['Score harus antara 1 dan 5'] }
    });
  }

  try {
    // Pastikan order ini milik customer tersebut
    const [orders] = await pool.query(
      'SELECT * FROM orders WHERE id = ? AND customer_id = ?',
      [order_id, customer_id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (orders[0].status !== 'completed') {
      return res.status(400).json({ message: 'Order belum selesai' });
    }

    // Cek apakah sudah pernah memberi rating
    const [existingRating] = await pool.query(
      'SELECT id FROM ratings WHERE order_id = ?',
      [order_id]
    );

    if (existingRating.length > 0) {
      return res.status(409).json({ message: 'Rating already given for this order' });
    }

    // Insert rating
    const ratingId = crypto.randomUUID();

    await pool.query(
      'INSERT INTO ratings (id, order_id, customer_id, score, review) VALUES (?, ?, ?, ?, ?)',
      [ratingId, order_id, customer_id, score, review || null]
    );

    res.status(201).json({
      message: 'Rating created',
      data: {
        rating_id: ratingId,
        order_id,
        customer_id,
        score,
        review: review || null
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
