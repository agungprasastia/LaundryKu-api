const pool = require('../config/db');
const { isPositiveNumber } = require('../helpers/validators');
const { createNotification } = require('../helpers/notification');
const { generateId } = require('../helpers/idGenerator');

// ============================================
// 8.1. Lihat Saldo Wallet
// GET /wallets/me
// Auth: Bearer Token (role: owner, courier)
// ============================================
exports.getBalance = async (req, res) => {
  const user_id = req.user.id;

  try {
    const [wallets] = await pool.query('SELECT * FROM wallets WHERE user_id = ?', [user_id]);
    if (wallets.length === 0) {
      return res.status(404).json({ success: false, message: 'Wallet not found. Please wait for admin verification.' });
    }

    const w = wallets[0];
    res.json({
      success: true,
      message: 'Success',
      data: {
        wallet_id: w.wallet_id,
        available_balance: parseFloat(w.available_balance),
        pending_balance: parseFloat(w.pending_balance),
        total_earned: parseFloat(w.total_earned)
      }
    });
  } catch (err) {
    console.error('getBalance error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 8.2. Riwayat Transaksi Wallet
// GET /wallets/me/transactions
// Auth: Bearer Token (role: owner, courier)
// ============================================
exports.getTransactions = async (req, res) => {
  const user_id = req.user.id;
  const { page = 1, limit = 10, type, status } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.max(1, parseInt(limit) || 10);
  const offset = (pageNum - 1) * limitNum;

  try {
    const [wallets] = await pool.query('SELECT wallet_id FROM wallets WHERE user_id = ?', [user_id]);
    if (wallets.length === 0) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    const wallet_id = wallets[0].wallet_id;
    let whereConditions = ['wt.wallet_id = ?'];
    let params = [wallet_id];

    if (type) { whereConditions.push('wt.type = ?'); params.push(type); }
    if (status) { whereConditions.push('wt.status = ?'); params.push(status); }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM wallet_transactions wt ${whereClause}`, params);
    const total = countResult[0].total;

    const [transactions] = await pool.query(
      `SELECT transaction_id, type, amount, status, description, order_id, created_at
       FROM wallet_transactions wt ${whereClause}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      success: true,
      message: 'Success',
      data: transactions,
      pagination: { page: pageNum, limit: limitNum, total }
    });
  } catch (err) {
    console.error('getTransactions error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// 8.3. Withdraw Saldo
// POST /wallets/me/withdraw
// Auth: Bearer Token (role: owner, courier, verified)
// Hanya dari available_balance
// Saldo dikurangi saat request (deduct-on-request)
// ============================================
exports.withdraw = async (req, res) => {
  const user_id = req.user.id;
  const { amount, bank_account_number, bank_name, e_wallet_number, e_wallet_provider } = req.body;

  // Validasi
  if (!amount || !isPositiveNumber(amount)) {
    return res.status(422).json({ success: false, message: 'Validation error', errors: { amount: ['amount wajib diisi dan > 0'] } });
  }

  // Harus ada info bank atau e-wallet
  if (!bank_account_number && !e_wallet_number) {
    return res.status(422).json({ success: false, message: 'Validation error', errors: { destination: ['bank_account_number atau e_wallet_number wajib diisi'] } });
  }

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Lock wallet row untuk mencegah race condition double withdraw
    const [wallets] = await connection.query(
      'SELECT * FROM wallets WHERE user_id = ? FOR UPDATE',
      [user_id]
    );
    if (wallets.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    const wallet = wallets[0];
    const withdrawAmount = parseFloat(amount);

    if (withdrawAmount > parseFloat(wallet.available_balance)) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient available balance' });
    }

    const withdrawId = generateId('WD');

    // Kurangi available_balance dan pindahkan ke pending_balance saat request (deduct-on-request approach)
    await connection.query(
      'UPDATE wallets SET available_balance = available_balance - ?, pending_balance = pending_balance + ? WHERE wallet_id = ?',
      [withdrawAmount, withdrawAmount, wallet.wallet_id]
    );

    // Buat record withdrawal
    await connection.query(
      `INSERT INTO withdrawals (withdraw_id, wallet_id, amount, bank_account_number, bank_name, e_wallet_number, e_wallet_provider, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [withdrawId, wallet.wallet_id, withdrawAmount, bank_account_number || null, bank_name || null, e_wallet_number || null, e_wallet_provider || null]
    );

    // Catat transaksi debit
    await connection.query(
      `INSERT INTO wallet_transactions (transaction_id, wallet_id, type, amount, status, description, source)
       VALUES (?, ?, 'debit', ?, 'available', ?, ?)`,
      [`${generateId('TXN')}`, wallet.wallet_id, withdrawAmount, `Withdraw ${withdrawId}`, `withdraw:${withdrawId}`]
    );

    // Notifikasi ke admin
    const [admins] = await connection.query("SELECT user_id FROM users WHERE role = 'admin'");
    for (const admin of admins) {
      await createNotification(connection, admin.user_id, 'Withdraw Request',
        `User ${user_id} mengajukan withdraw sebesar Rp${withdrawAmount.toLocaleString('id-ID')}. ID: ${withdrawId}`);
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Withdraw request submitted',
      data: {
        withdraw_id: withdrawId,
        amount: withdrawAmount,
        status: 'pending',
        estimated_transfer_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('withdraw error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    if (connection) connection.release();
  }
};

// ============================================
// 8.4. Riwayat Withdraw
// GET /wallets/me/withdrawals
// Auth: Bearer Token (role: owner, courier)
// ============================================
exports.getWithdrawals = async (req, res) => {
  const user_id = req.user.id;
  const { status, page = 1, limit = 10 } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.max(1, parseInt(limit) || 10);
  const offset = (pageNum - 1) * limitNum;

  try {
    const [wallets] = await pool.query('SELECT wallet_id FROM wallets WHERE user_id = ?', [user_id]);
    if (wallets.length === 0) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    const wallet_id = wallets[0].wallet_id;
    let whereConditions = ['w.wallet_id = ?'];
    let params = [wallet_id];

    if (status) { whereConditions.push('w.status = ?'); params.push(status); }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    const [withdrawals] = await pool.query(
      `SELECT withdraw_id, amount, status, bank_name, bank_account_number, e_wallet_provider, e_wallet_number, note, processed_at, created_at
       FROM withdrawals w ${whereClause}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({ success: true, message: 'Success', data: withdrawals });
  } catch (err) {
    console.error('getWithdrawals error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
