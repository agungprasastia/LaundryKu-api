const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// ============================================
// Middleware: authenticate
// Verifikasi token JWT + cek session blacklist
// ============================================
const authenticate = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
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
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    req.user = decoded; // Menyimpan data user (id, role) ke request
    req.token = token;  // Simpan token untuk logout
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
  }
};

// ============================================
// Middleware: authorizeRole
// Membatasi akses berdasarkan role
// ============================================
const authorizeRole = (roles = []) => {
  if (typeof roles === 'string') {
    roles = [roles];
  }

  return (req, res, next) => {
    if (!req.user || (roles.length && !roles.includes(req.user.role))) {
      return res.status(403).json({ success: false, message: 'Forbidden: insufficient role' });
    }
    next();
  };
};

// Alias lama untuk backward compatibility di route files
const authorize = authorizeRole;

// ============================================
// Middleware: requireVerifiedAccount
// Cek is_verified untuk owner dan courier
// Customer dan admin di-skip (langsung next)
// ============================================
const requireVerifiedAccount = async (req, res, next) => {
  // Customer dan admin tidak perlu verifikasi
  if (!req.user || req.user.role === 'customer' || req.user.role === 'admin') {
    return next();
  }

  // Owner dan courier harus verified
  try {
    const [users] = await pool.query(
      'SELECT is_verified FROM users WHERE user_id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    if (!users[0].is_verified) {
      return res.status(403).json({ 
        success: false, 
        message: 'Account not verified. Please wait for admin verification before accessing this feature.' 
      });
    }

    next();
  } catch (err) {
    console.error('requireVerifiedAccount error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { authenticate, authorize, authorizeRole, requireVerifiedAccount };
