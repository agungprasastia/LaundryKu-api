// ============================================
// Script untuk seed admin user
// Jalankan: node seed.js
// ============================================
const bcrypt = require('bcryptjs');
const pool = require('./config/db');
require('dotenv').config();

const seedAdmin = async () => {
  const email = 'admin@laundryku.com';
  const password = 'admin123';
  const fullName = 'Admin LaundryKu';

  try {
    // Cek apakah admin sudah ada
    const [existing] = await pool.query('SELECT user_id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      console.log('Admin user already exists. Updating password and checking wallet...');
      const adminId = existing[0].user_id;
      
      // Update password (supaya selalu sinkron)
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      await pool.query('UPDATE users SET password = ? WHERE user_id = ?', [hashedPassword, adminId]);
      console.log('Admin password updated.');

      // Cek wallet
      const [wallet] = await pool.query('SELECT wallet_id FROM wallets WHERE user_id = ? AND role = ?', [adminId, 'admin']);
      if (wallet.length === 0) {
        await pool.query('INSERT INTO wallets (user_id, role) VALUES (?, ?)', [adminId, 'admin']);
        console.log('Admin wallet created.');
      } else {
        console.log('Admin wallet already exists.');
      }

      console.log('\n=== Admin Credentials ===');
      console.log(`Email: ${email}`);
      console.log(`Password: ${password}`);
      console.log('========================\n');
      
      process.exit(0);
      return;
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    console.log('Generated hash for admin password:', hashedPassword);

    // Insert admin user
    const [result] = await pool.query(
      `INSERT INTO users (full_name, email, password, role, is_verified) VALUES (?, ?, ?, 'admin', 1)`,
      [fullName, email, hashedPassword]
    );

    const adminId = result.insertId;
    console.log(`Admin user created with ID: ${adminId}`);

    // Create admin wallet
    await pool.query('INSERT INTO wallets (user_id, role) VALUES (?, ?)', [adminId, 'admin']);
    console.log('Admin wallet created.');

    console.log('\n=== Admin Credentials ===');
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log('========================\n');

    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err.message);
    process.exit(1);
  }
};

seedAdmin();
