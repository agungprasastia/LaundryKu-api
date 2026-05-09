const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Register user baru
// POST /auth/register
exports.register = async (req, res) => {
  const { name, email, password, role } = req.body;

  // Validasi input
  if (!name || !email || !password || !role) {
    return res.status(422).json({
      message: 'Validation error',
      errors: {
        ...((!name) && { name: ['Name wajib diisi'] }),
        ...((!email) && { email: ['Email wajib diisi'] }),
        ...((!password) && { password: ['Password wajib diisi'] }),
        ...((!role) && { role: ['Role wajib diisi'] })
      }
    });
  }

  const validRoles = ['customer', 'owner', 'courier', 'admin'];
  if (!validRoles.includes(role)) {
    return res.status(422).json({
      message: 'Validation error',
      errors: { role: ['Role harus customer, owner, courier, atau admin'] }
    });
  }

  try {
    // Cek apakah email sudah terdaftar
    const [existingUsers] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Generate UUID
    const userId = crypto.randomUUID();

    // Simpan user ke database
    await pool.query(
      'INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [userId, name, email, password_hash, role]
    );

    // Buat profile sesuai role
    const profileId = crypto.randomUUID();
    if (role === 'owner') {
      await pool.query(
        'INSERT INTO owner_profiles (id, user_id) VALUES (?, ?)',
        [profileId, userId]
      );
    } else if (role === 'customer') {
      await pool.query(
        'INSERT INTO customer_profiles (id, user_id) VALUES (?, ?)',
        [profileId, userId]
      );
    } else if (role === 'courier') {
      await pool.query(
        'INSERT INTO courier_profiles (id, user_id) VALUES (?, ?)',
        [profileId, userId]
      );
    }

    // Generate JWT token saat register (sesuai spec)
    const payload = { id: userId, role };
    const access_token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });

    res.status(201).json({
      message: 'Register success',
      data: {
        user_id: userId,
        name,
        role,
        access_token
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// Login user
// POST /auth/login
exports.login = async (req, res) => {
  const { email, password } = req.body;

  // Validasi input
  if (!email || !password) {
    return res.status(422).json({
      message: 'Validation error',
      errors: {
        ...((!email) && { email: ['Email wajib diisi'] }),
        ...((!password) && { password: ['Password wajib diisi'] })
      }
    });
  }

  try {
    // Cek user berdasarkan email
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = users[0];

    // Bandingkan password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Buat JWT token
    const payload = {
      id: user.id,
      role: user.role
    };

    const access_token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });

    res.json({
      message: 'Login success',
      data: {
        user_id: user.id,
        name: user.full_name,
        role: user.role,
        access_token
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// Logout user
// POST /auth/logout
exports.logout = async (req, res) => {
  // Karena JWT stateless, logout di sisi client cukup hapus token
  // Di sisi server bisa implementasi token blacklist jika diperlukan
  res.json({ message: 'Logout success' });
};
