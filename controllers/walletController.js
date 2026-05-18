const pool = require('../config/db');

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
      return res.status(404).json({ message: 'Wallet not found. Please wait for admin verification.' });
    }

    const w = wallets[0];
    res.json({
      data: {
        wallet_id: w.wallet_id,
        available_balance: parseFloat(w.available_balance),
        pending_balance: parseFloat(w.pending_balance),
        total_earned: parseFloat(w.total_earned)
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
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
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  try {
    const [wallets] = await pool.query('SELECT wallet_id FROM wallets WHERE user_id = ?', [user_id]);
    if (wallets.length === 0) {
      return res.status(404).json({ message: 'Wallet not found' });
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
      data: transactions,
      pagination: { page: pageNum, limit: limitNum, total }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 8.3. Withdraw Saldo
// POST /wallets/me/withdraw
// Auth: Bearer Token (role: owner, courier)
// ============================================
exports.withdraw = async (req, res) => {
  const user_id = req.user.id;
  const { amount, bank_account_number, bank_name, e_wallet_number, e_wallet_provider } = req.body;

  if (!amount || amount <= 0) {
    return res.status(422).json({ message: 'Validation error', errors: { amount: ['amount wajib diisi dan > 0'] } });
  }

  try {
    const [wallets] = await pool.query('SELECT * FROM wallets WHERE user_id = ?', [user_id]);
    if (wallets.length === 0) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    const wallet = wallets[0];

    if (amount > parseFloat(wallet.available_balance)) {
      return res.status(400).json({ message: 'Insufficient available balance' });
    }

    const withdrawId = `WD${Date.now()}`;

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    // Kurangi available_balance
    await connection.query(
      'UPDATE wallets SET available_balance = available_balance - ? WHERE wallet_id = ?',
      [amount, wallet.wallet_id]
    );

    // Buat record withdrawal
    await connection.query(
      `INSERT INTO withdrawals (withdraw_id, wallet_id, amount, bank_account_number, bank_name, e_wallet_number, e_wallet_provider, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [withdrawId, wallet.wallet_id, amount, bank_account_number || null, bank_name || null, e_wallet_number || null, e_wallet_provider || null]
    );

    // Catat transaksi debit
    await connection.query(
      `INSERT INTO wallet_transactions (transaction_id, wallet_id, type, amount, status, description, source)
       VALUES (?, ?, 'debit', ?, 'available', ?, ?)`,
      [`TXN${Date.now()}`, wallet.wallet_id, amount, `Withdraw ${withdrawId}`, `withdraw:${withdrawId}`]
    );

    await connection.commit();
    connection.release();

    res.status(201).json({
      message: 'Withdraw request submitted',
      data: {
        withdraw_id: withdrawId,
        amount,
        status: 'pending',
        estimated_transfer_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
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
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  try {
    const [wallets] = await pool.query('SELECT wallet_id FROM wallets WHERE user_id = ?', [user_id]);
    if (wallets.length === 0) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    const wallet_id = wallets[0].wallet_id;
    let whereConditions = ['w.wallet_id = ?'];
    let params = [wallet_id];

    if (status) { whereConditions.push('w.status = ?'); params.push(status); }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    const [withdrawals] = await pool.query(
      `SELECT withdraw_id, amount, status, bank_name, bank_account_number, e_wallet_provider, e_wallet_number, created_at
       FROM withdrawals w ${whereClause}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({ data: withdrawals });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
