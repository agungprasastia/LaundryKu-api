const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { isValidEmail, isValidPassword } = require('../helpers/validators');

// ============================================
// 1.1. Register
// POST /auth/register
// Public — tidak perlu token
// Role admin TIDAK boleh dibuat dari endpoint ini
// ============================================
exports.register = async (req, res) => {
  const { full_name, email, password, role, address, lat, lng, vehicle_name, vehicle_plate_number } = req.body;

  // Validasi input
  const errors = {};
  if (!full_name) errors.full_name = ['full_name wajib diisi'];
  if (!email) {
    errors.email = ['Email wajib diisi'];
  } else if (!isValidEmail(email)) {
    errors.email = ['Format email tidak valid'];
  }
  if (!password) {
    errors.password = ['Password wajib diisi'];
  } else if (!isValidPassword(password)) {
    errors.password = ['Password minimal 6 karakter'];
  }
  if (!role) errors.role = ['Role wajib diisi'];

  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ success: false, message: 'Validation error', errors });
  }

  // Hanya customer, owner, courier yang boleh register dari public endpoint
  const validRoles = ['customer', 'owner', 'courier'];
  if (!validRoles.includes(role)) {
    return res.status(403).json({
      success: false,
      message: 'Role admin tidak boleh didaftarkan dari endpoint ini. Hubungi administrator sistem.'
    });
  }

  try {
    // Cek apakah email sudah terdaftar
    const [existingUsers] = await pool.query('SELECT user_id FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Customer langsung verified, owner/courier harus diverifikasi admin
    const isVerified = role === 'customer' ? 1 : 0;

    // Simpan user ke database
    const [result] = await pool.query(
      `INSERT INTO users (full_name, email, password, role, is_verified, address, lat, lng, vehicle_name, vehicle_plate_number) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [full_name, email, hashedPassword, role, isVerified, address || null, lat || null, lng || null, vehicle_name || null, vehicle_plate_number || null]
    );

    const userId = result.insertId;

    // Generate JWT token
    const payload = { id: userId, role };
    const access_token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });

    // Simpan session
    await pool.query(
      'INSERT INTO sessions (user_id, token) VALUES (?, ?)',
      [userId, access_token]
    );

    const responseData = {
      user_id: userId,
      name: full_name,
      role,
      is_verified: isVerified === 1,
      access_token
    };

    // Info tambahan untuk owner/courier
    if (role !== 'customer') {
      responseData.verification_note = 'Akun Anda belum diverifikasi. Harap tunggu verifikasi dari admin sebelum menggunakan fitur utama.';
    }

    res.status(201).json({
      success: true,
      message: 'Register success',
      data: responseData
    });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 1.2. Login
// POST /auth/login
// Public
// ============================================
exports.login = async (req, res) => {
  const { email, password } = req.body;

  // Validasi input
  const errors = {};
  if (!email) {
    errors.email = ['Email wajib diisi'];
  } else if (!isValidEmail(email)) {
    errors.email = ['Format email tidak valid'];
  }
  if (!password) {
    errors.password = ['Password wajib diisi'];
  }

  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ success: false, message: 'Validation error', errors });
  }

  try {
    // Cek user berdasarkan email
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = users[0];

    // Bandingkan password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Buat JWT token
    const payload = { id: user.user_id, role: user.role };
    const access_token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });

    // Simpan session
    await pool.query(
      'INSERT INTO sessions (user_id, token) VALUES (?, ?)',
      [user.user_id, access_token]
    );

    res.json({
      success: true,
      message: 'Login success',
      data: {
        user_id: user.user_id,
        name: user.full_name,
        role: user.role,
        is_verified: !!user.is_verified,
        access_token
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 1.3. Lihat Profil
// GET /auth/profile
// Wajib Bearer Token (semua role)
// ============================================
exports.getProfile = async (req, res) => {
  const userId = req.user.id;

  try {
    const [users] = await pool.query(
      'SELECT user_id, full_name, email, role, is_verified, address, lat, lng, vehicle_name, vehicle_plate_number, created_at FROM users WHERE user_id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = users[0];

    res.json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        user_id: user.user_id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        is_verified: !!user.is_verified,
        address: user.address,
        lat: user.lat,
        lng: user.lng,
        vehicle_name: user.vehicle_name,
        vehicle_plate_number: user.vehicle_plate_number,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error('getProfile error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 1.4. Edit Profil
// PATCH /auth/profile
// Wajib Bearer Token (semua role)
// ============================================
exports.editProfile = async (req, res) => {
  const userId = req.user.id;
  const { full_name, address, lat, lng, vehicle_name, vehicle_plate_number } = req.body;

  try {
    // Build dynamic update query
    const updates = [];
    const params = [];

    if (full_name !== undefined) { updates.push('full_name = ?'); params.push(full_name); }
    if (address !== undefined) { updates.push('address = ?'); params.push(address); }
    if (lat !== undefined) { updates.push('lat = ?'); params.push(lat); }
    if (lng !== undefined) { updates.push('lng = ?'); params.push(lng); }
    if (vehicle_name !== undefined) { updates.push('vehicle_name = ?'); params.push(vehicle_name); }
    if (vehicle_plate_number !== undefined) { updates.push('vehicle_plate_number = ?'); params.push(vehicle_plate_number); }

    if (updates.length === 0) {
      return res.status(422).json({ success: false, message: 'Validation error', errors: { body: ['Tidak ada field yang diperbarui'] } });
    }

    params.push(userId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`, params);

    // Ambil data terbaru
    const [users] = await pool.query('SELECT user_id, full_name, role FROM users WHERE user_id = ?', [userId]);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user_id: users[0].user_id,
        name: users[0].full_name,
        role: users[0].role
      }
    });
  } catch (err) {
    console.error('editProfile error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 1.5. Logout
// POST /auth/logout
// Wajib Bearer Token
// ============================================
exports.logout = async (req, res) => {
  const userId = req.user.id;
  const token = req.token;

  try {
    // Hapus session dari database
    await pool.query('DELETE FROM sessions WHERE user_id = ? AND token = ?', [userId, token]);
    res.json({ success: true, message: 'Logout success' });
  } catch (err) {
    console.error('logout error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
