const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Middleware untuk verifikasi token JWT + cek session blacklist
const authenticate = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Cek apakah token masih ada di sessions (belum logout)
    const [sessions] = await pool.query(
      'SELECT id FROM sessions WHERE user_id = ? AND token = ?',
      [decoded.id, token]
    );
    
    if (sessions.length === 0) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    req.user = decoded; // Menyimpan data user (id, role) ke request
    req.token = token;  // Simpan token untuk logout
    next();
  } catch (err) {
    res.status(401).json({ message: 'Unauthorized' });
  }
};

// Middleware untuk membatasi akses berdasarkan role
const authorize = (roles = []) => {
  if (typeof roles === 'string') {
    roles = [roles];
  }

  return (req, res, next) => {
    if (!req.user || (roles.length && !roles.includes(req.user.role))) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
};

module.exports = { authenticate, authorize };
