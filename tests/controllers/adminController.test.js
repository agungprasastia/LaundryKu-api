const mysql = require('mysql2/promise');

jest.mock('mysql2/promise', () => {
  const mockQuery = jest.fn();
  const mockGetConnection = jest.fn(() => Promise.resolve({
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
    query: mockQuery
  }));
  return {
    createPool: () => ({
      query: mockQuery,
      getConnection: mockGetConnection
    }),
    mockQuery,
    mockGetConnection
  };
});

const pool = require('../../config/db');
const { createNotification } = require('../../helpers/notification');
const { generateId } = require('../../helpers/idGenerator');
const { isPositiveNumber } = require('../../helpers/validators');

jest.mock('../../helpers/notification', () => ({
  createNotification: jest.fn()
}));

jest.mock('../../helpers/idGenerator', () => ({
  generateId: jest.fn()
}));

jest.mock('../../helpers/validators', () => ({
  isPositiveNumber: jest.fn()
}));

const adminController = require('../../controllers/adminController');

describe('Admin Controller', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    pool.getConnection = jest.fn().mockResolvedValue({
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
      query: pool.query
    });
    req = {
      query: {},
      params: {},
      body: {},
      user: {}
    };
    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
  });

  describe('getDashboardMetrics', () => {
    it('should return metrics without date filter', async () => {
      pool.query
        .mockResolvedValueOnce([[{ total: 10 }]])
        .mockResolvedValueOnce([[{ total: 20 }]])
        .mockResolvedValueOnce([[{ total: 500 }]])
        .mockResolvedValueOnce([[{ total: 50 }]])
        .mockResolvedValueOnce([[{ total: 15 }]])
        .mockResolvedValueOnce([[{ total: 5 }]]);

      await adminController.getDashboardMetrics(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          total_users: 10,
          total_orders: 20,
          total_revenue: 500,
          total_admin_commission: 50,
          orders_completed: 15,
          orders_pending: 5
        })
      }));
    });

    it('should return metrics with date filter', async () => {
      req.query = { date_from: '2023-01-01', date_to: '2023-12-31' };
      pool.query.mockResolvedValue([[{ total: 10 }]]);

      await adminController.getDashboardMetrics(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('created_at >= ? AND created_at <= ?'),
        expect.arrayContaining(['2023-01-01', '2023-12-31 23:59:59'])
      );
    });

    it('should handle db error', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB Error'));
      await adminController.getDashboardMetrics(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('verifyUser', () => {
    it('should return 422 if is_verified is missing', async () => {
      req.params = { user_id: '1' };
      req.body = {};
      await adminController.verifyUser(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('should return 404 if user not found', async () => {
      req.params = { user_id: '1' };
      req.body = { is_verified: true };
      pool.query.mockResolvedValueOnce([[]]);

      await adminController.verifyUser(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 422 if user is not owner/courier', async () => {
      req.params = { user_id: '1' };
      req.body = { is_verified: true };
      pool.query.mockResolvedValueOnce([[{ user_id: 1, role: 'customer' }]]);

      await adminController.verifyUser(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('should verify user and create wallet', async () => {
      req.params = { user_id: '1' };
      req.body = { is_verified: true };
      pool.query
        .mockResolvedValueOnce([[{ user_id: 1, role: 'owner' }]]) // SELECT user
        .mockResolvedValueOnce([]) // UPDATE user
        .mockResolvedValueOnce([[]]) // SELECT wallet
        .mockResolvedValueOnce([{ insertId: 99 }]); // INSERT wallet

      await adminController.verifyUser(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ wallet_created: true, wallet_id: 99 })
      }));
      expect(createNotification).toHaveBeenCalled();
    });

    it('should verify user and not create wallet if already exists', async () => {
      req.params = { user_id: '1' };
      req.body = { is_verified: true };
      pool.query
        .mockResolvedValueOnce([[{ user_id: 1, role: 'owner' }]])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([[{ wallet_id: 88 }]]); // Wallet exists

      await adminController.verifyUser(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ wallet_created: false, wallet_id: 88 })
      }));
    });

    it('should revoke verification', async () => {
      req.params = { user_id: '1' };
      req.body = { is_verified: false };
      pool.query
        .mockResolvedValueOnce([[{ user_id: 1, role: 'owner' }]])
        .mockResolvedValueOnce([]); // UPDATE user

      await adminController.verifyUser(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ is_verified: false })
      }));
    });

    it('should handle inner db error (rollback)', async () => {
      req.params = { user_id: '1' };
      req.body = { is_verified: true };
      pool.query
        .mockResolvedValueOnce([[{ user_id: 1, role: 'owner' }]])
        .mockRejectedValueOnce(new Error('Inner DB Error'));

      await adminController.verifyUser(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should handle outer db error', async () => {
      req.params = { user_id: '1' };
      req.body = { is_verified: true };
      pool.query.mockRejectedValueOnce(new Error('Outer DB Error'));

      await adminController.verifyUser(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getAdminWallet', () => {
    it('should return admin wallet', async () => {
      req.user = { id: 1 };
      pool.query
        .mockResolvedValueOnce([[{ wallet_id: 1, available_balance: 100, pending_balance: 50, total_earned: 200 }]])
        .mockResolvedValueOnce([[{ total: 150 }]]);

      await adminController.getAdminWallet(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ balance: 150, this_month: 150 })
      }));
    });

    it('should return 404 if admin wallet not found', async () => {
      req.user = { id: 1 };
      pool.query.mockResolvedValueOnce([[]]);
      await adminController.getAdminWallet(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should handle db error', async () => {
      req.user = { id: 1 };
      pool.query.mockRejectedValueOnce(new Error('DB Error'));
      await adminController.getAdminWallet(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('processWithdraw', () => {
    it('should return 422 if status is invalid', async () => {
      req.params = { withdraw_id: 'WD1' };
      req.body = { status: 'invalid' };
      await adminController.processWithdraw(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('should return 404 if withdrawal not found', async () => {
      req.params = { withdraw_id: 'WD1' };
      req.body = { status: 'success' };
      pool.query.mockResolvedValueOnce([[]]);
      await adminController.processWithdraw(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 422 if withdrawal already processed', async () => {
      req.params = { withdraw_id: 'WD1' };
      req.body = { status: 'success' };
      pool.query.mockResolvedValueOnce([[{ status: 'success' }]]);
      await adminController.processWithdraw(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('should process success withdrawal', async () => {
      req.params = { withdraw_id: 'WD1' };
      req.body = { status: 'success' };
      pool.query
        .mockResolvedValueOnce([[{ status: 'pending', wallet_id: 1 }]]) // SELECT
        .mockResolvedValueOnce([]) // UPDATE
        .mockResolvedValueOnce([[{ user_id: 2 }]]); // SELECT wallet user_id

      await adminController.processWithdraw(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(createNotification).toHaveBeenCalled();
    });

    it('should process failed withdrawal and refund balance', async () => {
      req.params = { withdraw_id: 'WD1' };
      req.body = { status: 'failed', note: 'error' };
      pool.query
        .mockResolvedValueOnce([[{ status: 'pending', wallet_id: 1, amount: 100 }]]) // SELECT
        .mockResolvedValueOnce([]) // UPDATE wd
        .mockResolvedValueOnce([]) // UPDATE wallets
        .mockResolvedValueOnce([[{ user_id: 2 }]]); // SELECT wallet user_id

      await adminController.processWithdraw(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(createNotification).toHaveBeenCalled();
    });

    it('should process withdrawal without wallet user_id (edge case)', async () => {
      req.params = { withdraw_id: 'WD1' };
      req.body = { status: 'success' };
      pool.query
        .mockResolvedValueOnce([[{ status: 'pending', wallet_id: 1 }]]) // SELECT
        .mockResolvedValueOnce([]) // UPDATE
        .mockResolvedValueOnce([[]]); // SELECT wallet user_id returns empty

      await adminController.processWithdraw(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should handle db error', async () => {
      req.params = { withdraw_id: 'WD1' };
      req.body = { status: 'success' };
      pool.query.mockRejectedValueOnce(new Error('DB Error'));
      await adminController.processWithdraw(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getPendingUsers', () => {
    it('should return pending users', async () => {
      pool.query.mockResolvedValueOnce([[{ user_id: 1 }]]);
      await adminController.getPendingUsers(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should handle db error', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB Error'));
      await adminController.getPendingUsers(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getAllOrders', () => {
    it('should return all orders without status filter', async () => {
      req.query = { page: '2', limit: '10' };
      pool.query
        .mockResolvedValueOnce([[{ total: 100 }]])
        .mockResolvedValueOnce([[{ order_id: 1 }]]);

      await adminController.getAllOrders(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        pagination: expect.objectContaining({ page: 2, limit: 10 })
      }));
    });

    it('should return orders with status filter', async () => {
      req.query = { status: 'COMPLETED' };
      pool.query
        .mockResolvedValueOnce([[{ total: 100 }]])
        .mockResolvedValueOnce([[{ order_id: 1 }]]);

      await adminController.getAllOrders(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should handle db error', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB Error'));
      await adminController.getAllOrders(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getAnalytics', () => {
    it('should return analytics without date filter', async () => {
      pool.query
        .mockResolvedValueOnce([[{ total: 100 }]]) // totalOrders
        .mockResolvedValueOnce([[{ total: 5000 }]]) // totalGMV
        .mockResolvedValueOnce([[{ total: 500 }]]) // totalAdminCommission
        .mockResolvedValueOnce([[{ total: 10 }]]) // activeOwners
        .mockResolvedValueOnce([[{ total: 5 }]]) // activeCouriers
        .mockResolvedValueOnce([[{ owner_id: 1 }]]) // topOwners
        .mockResolvedValueOnce([[{ courier_id: 1 }]]); // topCouriers

      await adminController.getAnalytics(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should return analytics with date filter', async () => {
      req.query = { date_from: '2023-01-01', date_to: '2023-12-31' };
      pool.query.mockResolvedValue([[{ total: 10 }]]);

      await adminController.getAnalytics(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should handle db error', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB Error'));
      await adminController.getAnalytics(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getAdminTransactions', () => {
    it('should return 404 if admin wallet not found', async () => {
      req.user = { id: 1 };
      pool.query.mockResolvedValueOnce([[]]);
      await adminController.getAdminTransactions(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return transactions', async () => {
      req.user = { id: 1 };
      pool.query
        .mockResolvedValueOnce([[{ wallet_id: 1 }]])
        .mockResolvedValueOnce([[{ transaction_id: 1 }]]);

      await adminController.getAdminTransactions(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should handle db error', async () => {
      req.user = { id: 1 };
      pool.query.mockRejectedValueOnce(new Error('DB Error'));
      await adminController.getAdminTransactions(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('adminWithdraw', () => {
    it('should return 422 if amount is invalid', async () => {
      req.user = { id: 1 };
      req.body = { amount: -100 };
      isPositiveNumber.mockReturnValueOnce(false);
      await adminController.adminWithdraw(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('should return 422 if bank and e-wallet missing', async () => {
      req.user = { id: 1 };
      req.body = { amount: 100 };
      isPositiveNumber.mockReturnValueOnce(true);
      await adminController.adminWithdraw(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('should return 404 if admin wallet not found', async () => {
      req.user = { id: 1 };
      req.body = { amount: 100, bank_account_number: '123' };
      isPositiveNumber.mockReturnValueOnce(true);
      pool.query.mockResolvedValueOnce([[]]);

      await adminController.adminWithdraw(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 if insufficient balance', async () => {
      req.user = { id: 1 };
      req.body = { amount: 100, bank_account_number: '123' };
      isPositiveNumber.mockReturnValueOnce(true);
      pool.query.mockResolvedValueOnce([[{ wallet_id: 1, available_balance: 50 }]]);

      await adminController.adminWithdraw(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should submit withdraw request', async () => {
      req.user = { id: 1 };
      req.body = { amount: 100, bank_account_number: '123' };
      isPositiveNumber.mockReturnValueOnce(true);
      generateId.mockReturnValue('ID');
      pool.query
        .mockResolvedValueOnce([[{ wallet_id: 1, available_balance: 500 }]])
        .mockResolvedValueOnce([]) // UPDATE
        .mockResolvedValueOnce([]) // INSERT wd
        .mockResolvedValueOnce([]); // INSERT txn

      await adminController.adminWithdraw(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should submit withdraw request with e-wallet', async () => {
      req.user = { id: 1 };
      req.body = { amount: 100, e_wallet_number: '123' };
      isPositiveNumber.mockReturnValueOnce(true);
      generateId.mockReturnValue('ID');
      pool.query
        .mockResolvedValueOnce([[{ wallet_id: 1, available_balance: 500 }]])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await adminController.adminWithdraw(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should handle db error', async () => {
      req.user = { id: 1 };
      req.body = { amount: 100, bank_account_number: '123' };
      isPositiveNumber.mockReturnValueOnce(true);
      pool.query.mockRejectedValueOnce(new Error('DB Error'));

      await adminController.adminWithdraw(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getPendingWithdrawals', () => {
    it('should return pending withdrawals', async () => {
      pool.query.mockResolvedValueOnce([[{ withdraw_id: 1 }]]);
      await adminController.getPendingWithdrawals(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should handle db error', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB Error'));
      await adminController.getPendingWithdrawals(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getAllWithdrawals', () => {
    it('should return all withdrawals', async () => {
      pool.query.mockResolvedValueOnce([[{ withdraw_id: 1 }]]);
      await adminController.getAllWithdrawals(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should handle db error', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB Error'));
      await adminController.getAllWithdrawals(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
