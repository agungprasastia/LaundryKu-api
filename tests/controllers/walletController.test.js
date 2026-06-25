const mysql = require('mysql2/promise');

jest.mock('mysql2/promise', () => {
  const mockQuery = jest.fn();
  const mockGetConnection = jest.fn().mockResolvedValue({
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
    query: mockQuery
  });
  return {
    createPool: () => ({
      query: mockQuery,
      getConnection: mockGetConnection
    }),
    mockQuery,
    mockGetConnection
  };
});

jest.mock('../../helpers/validators', () => ({
  isPositiveNumber: jest.fn()
}));
jest.mock('../../helpers/notification', () => ({
  createNotification: jest.fn()
}));
jest.mock('../../helpers/idGenerator', () => ({
  generateId: jest.fn()
}));

const walletController = require('../../controllers/walletController');
const { isPositiveNumber } = require('../../helpers/validators');
const { createNotification } = require('../../helpers/notification');
const { generateId } = require('../../helpers/idGenerator');

describe('walletController', () => {
  let req, res;
  let mockConnection;

  beforeEach(async () => {
    jest.clearAllMocks();

    req = {
      user: { id: 1 },
      query: {},
      body: {}
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    const mockConn = {
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
      query: mysql.mockQuery
    };
    mysql.mockGetConnection.mockResolvedValue(mockConn);
    mockConnection = mockConn;
  });

  describe('getBalance', () => {
    it('should return 404 if wallet not found', async () => {
      mysql.mockQuery.mockResolvedValueOnce([[]]);

      await walletController.getBalance(req, res);

      expect(mysql.mockQuery).toHaveBeenCalledWith('SELECT * FROM wallets WHERE user_id = ?', [1]);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Wallet not found. Please wait for admin verification.' });
    });

    it('should return 200 and wallet data if wallet found', async () => {
      const mockWallet = {
        wallet_id: 'W1',
        available_balance: '100.50',
        pending_balance: '20',
        total_earned: '500'
      };
      mysql.mockQuery.mockResolvedValueOnce([[mockWallet]]);

      await walletController.getBalance(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: {
          wallet_id: 'W1',
          available_balance: 100.5,
          pending_balance: 20,
          total_earned: 500
        }
      });
    });

    it('should return 500 on db error', async () => {
      mysql.mockQuery.mockRejectedValueOnce(new Error('DB Error'));

      await walletController.getBalance(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Server error' });
    });
  });

  describe('getTransactions', () => {
    it('should return 404 if wallet not found', async () => {
      mysql.mockQuery.mockResolvedValueOnce([[]]);

      await walletController.getTransactions(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Wallet not found' });
    });

    it('should return transactions with default pagination', async () => {
      mysql.mockQuery
        .mockResolvedValueOnce([[{ wallet_id: 'W1' }]])
        .mockResolvedValueOnce([[{ total: 10 }]])
        .mockResolvedValueOnce([[{ transaction_id: 'TXN1' }]]);

      await walletController.getTransactions(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: [{ transaction_id: 'TXN1' }],
        pagination: { page: 1, limit: 10, total: 10 }
      });
    });

    it('should return transactions with pagination and optional filters', async () => {
      req.query = { page: '2', limit: '5', type: 'credit', status: 'completed' };
      
      mysql.mockQuery
        .mockResolvedValueOnce([[{ wallet_id: 'W1' }]])
        .mockResolvedValueOnce([[{ total: 15 }]])
        .mockResolvedValueOnce([[{ transaction_id: 'TXN1' }]]);

      await walletController.getTransactions(req, res);

      expect(mysql.mockQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT COUNT(*) as total FROM wallet_transactions wt'), ['W1', 'credit', 'completed']);
      expect(mysql.mockQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT transaction_id, type, amount, status, description, order_id, created_at'), ['W1', 'credit', 'completed', 5, 5]);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: [{ transaction_id: 'TXN1' }],
        pagination: { page: 2, limit: 5, total: 15 }
      });
    });

    it('should return 500 on db error', async () => {
      mysql.mockQuery.mockRejectedValueOnce(new Error('DB Error'));

      await walletController.getTransactions(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Server error' });
    });
  });

  describe('withdraw', () => {
    beforeEach(() => {
      isPositiveNumber.mockReturnValue(true);
      generateId.mockReturnValueOnce('WD1').mockReturnValueOnce('TXN1');
    });

    it('should return 422 if amount is not provided', async () => {
      req.body = { bank_account_number: '123' };

      await walletController.withdraw(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Validation error',
        errors: { amount: ['amount wajib diisi dan > 0'] }
      });
    });

    it('should return 422 if amount is invalid', async () => {
      req.body = { amount: -10, bank_account_number: '123' };
      isPositiveNumber.mockReturnValueOnce(false);

      await walletController.withdraw(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Validation error',
        errors: { amount: ['amount wajib diisi dan > 0'] }
      });
    });

    it('should return 422 if neither bank nor e-wallet info provided', async () => {
      req.body = { amount: 100 };

      await walletController.withdraw(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Validation error',
        errors: { destination: ['bank_account_number atau e_wallet_number wajib diisi'] }
      });
    });

    it('should rollback and return 404 if wallet not found', async () => {
      req.body = { amount: 100, bank_account_number: '123' };
      mysql.mockQuery.mockResolvedValueOnce([[]]);

      await walletController.withdraw(req, res);

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Wallet not found' });
    });

    it('should rollback and return 400 if insufficient available balance', async () => {
      req.body = { amount: 1000, bank_account_number: '123' };
      mysql.mockQuery.mockResolvedValueOnce([[{ available_balance: '500' }]]);

      await walletController.withdraw(req, res);

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Insufficient available balance' });
    });

    it('should process withdrawal, commit, and return 201', async () => {
      req.body = { amount: 100, bank_account_number: '123', bank_name: 'BCA' };
      mysql.mockQuery
        .mockResolvedValueOnce([[{ wallet_id: 'W1', available_balance: '500' }]])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([[{ user_id: 2 }]]);

      await walletController.withdraw(req, res);

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mysql.mockQuery).toHaveBeenCalledWith(
        'UPDATE wallets SET available_balance = available_balance - ? WHERE wallet_id = ?',
        [100, 'W1']
      );
      expect(mysql.mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO withdrawals'),
        ['WD1', 'W1', 100, '123', 'BCA', null, null]
      );
      expect(mysql.mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO wallet_transactions'),
        ['TXN1', 'W1', 100, 'Withdraw WD1', 'withdraw:WD1']
      );
      expect(createNotification).toHaveBeenCalledWith(mockConnection, 2, 'Withdraw Request', expect.any(String));
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Withdraw request submitted'
      }));
    });

    it('should process withdrawal with e-wallet, commit, and return 201', async () => {
      req.body = { amount: 100, e_wallet_number: '08123', e_wallet_provider: 'OVO' };
      mysql.mockQuery
        .mockResolvedValueOnce([[{ wallet_id: 'W1', available_balance: '500' }]])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([[]]); // no admins

      await walletController.withdraw(req, res);

      expect(mysql.mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO withdrawals'),
        ['WD1', 'W1', 100, null, null, '08123', 'OVO']
      );
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should return 500 and rollback on db error', async () => {
      req.body = { amount: 100, bank_account_number: '123' };
      mysql.mockQuery.mockRejectedValueOnce(new Error('DB Error'));

      await walletController.withdraw(req, res);

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Server error' });
    });

    it('should return 500 gracefully on connection fetch error', async () => {
      req.body = { amount: 100, bank_account_number: '123' };
      mysql.mockGetConnection.mockRejectedValueOnce(new Error('Connection Error'));

      await walletController.withdraw(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Server error' });
    });
  });

  describe('getWithdrawals', () => {
    it('should return 404 if wallet not found', async () => {
      mysql.mockQuery.mockResolvedValueOnce([[]]);

      await walletController.getWithdrawals(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Wallet not found' });
    });

    it('should return withdrawals with default pagination', async () => {
      mysql.mockQuery
        .mockResolvedValueOnce([[{ wallet_id: 'W1' }]])
        .mockResolvedValueOnce([[{ withdraw_id: 'WD1' }]]);

      await walletController.getWithdrawals(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: [{ withdraw_id: 'WD1' }]
      });
    });

    it('should return withdrawals with pagination and status filter', async () => {
      req.query = { page: '2', limit: '5', status: 'pending' };
      mysql.mockQuery
        .mockResolvedValueOnce([[{ wallet_id: 'W1' }]])
        .mockResolvedValueOnce([[{ withdraw_id: 'WD1' }]]);

      await walletController.getWithdrawals(req, res);

      expect(mysql.mockQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT withdraw_id, amount, status, bank_name, bank_account_number, e_wallet_provider, e_wallet_number, note, processed_at, created_at'), ['W1', 'pending', 5, 5]);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: [{ withdraw_id: 'WD1' }]
      });
    });

    it('should return 500 on db error', async () => {
      mysql.mockQuery.mockRejectedValueOnce(new Error('DB Error'));

      await walletController.getWithdrawals(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Server error' });
    });
  });
});
