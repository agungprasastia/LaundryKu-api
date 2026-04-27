const jwt = require('jsonwebtoken');

// Middleware untuk verifikasi token JWT
const authenticate = (req, res, next) => {
  const authHeader = req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Akses ditolak. Token tidak ditemukan atau format salah.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Menyimpan data user (id, role) ke request
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token tidak valid.' });
  }
};

// Middleware untuk membatasi akses berdasarkan role
const authorize = (roles = []) => {
  if (typeof roles === 'string') {
    roles = [roles];
  }

  return (req, res, next) => {
    if (!req.user || (roles.length && !roles.includes(req.user.role))) {
      return res.status(403).json({ error: 'Akses dilarang. Role Anda tidak diizinkan.' });
    }
    next();
  };
};

module.exports = { authenticate, authorize };
