const pool = require('../config/db');

// ============================================
// Lihat profil user yang login
// GET /profile
// Auth: Bearer Token (semua role)
// ============================================
exports.getProfile = async (req, res) => {
  const userId = req.user.id;

  try {
    const [users] = await pool.query(
      'SELECT id, full_name, email, role, phone, created_at FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];

    res.json({
      message: 'Profile retrieved successfully',
      data: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
