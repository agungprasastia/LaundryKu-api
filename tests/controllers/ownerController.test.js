const { mockQuery } = require('mysql2/promise');

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

const ownerController = require('../../controllers/ownerController');

describe('Owner Controller', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      user: { id: 1 },
      query: {}
    };
    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    
    // Silence console.error for clean test output
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  describe('getReportSummary', () => {
    it('should return report summary without dates', async () => {
      req.query = {};
      const mockSummary = [{
        total_orders: 5,
        total_revenue_gross: 50000,
        admin_commission_deducted: 5000,
        owner_net_earning: 45000
      }];
      const mockByService = [
        { service: 'Cuci Kering', orders: 2, earning: 20000 },
        { service: 'Setrika', orders: 3, earning: 25000 }
      ];

      mockQuery
        .mockResolvedValueOnce([mockSummary])
        .mockResolvedValueOnce([mockByService]);

      await ownerController.getReportSummary(req, res);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(1, expect.any(String), [1]);
      expect(mockQuery).toHaveBeenNthCalledWith(2, expect.any(String), [1]);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: {
          period: { from: null, to: null },
          total_orders: 5,
          total_revenue_gross: 50000,
          admin_commission_deducted: 5000,
          owner_net_earning: 45000,
          by_service: mockByService
        }
      });
    });

    it('should return report summary with date filters', async () => {
      req.query = { date_from: '2023-01-01', date_to: '2023-01-31' };
      const mockSummary = [{
        total_orders: 5,
        total_revenue_gross: 50000,
        admin_commission_deducted: 5000,
        owner_net_earning: 45000
      }];
      const mockByService = [];

      mockQuery
        .mockResolvedValueOnce([mockSummary])
        .mockResolvedValueOnce([mockByService]);

      await ownerController.getReportSummary(req, res);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(1, expect.any(String), [1, '2023-01-01', '2023-01-31 23:59:59']);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: {
          period: { from: '2023-01-01', to: '2023-01-31' },
          total_orders: 5,
          total_revenue_gross: 50000,
          admin_commission_deducted: 5000,
          owner_net_earning: 45000,
          by_service: []
        }
      });
    });

    it('should handle database errors in getReportSummary', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB Error'));
      await ownerController.getReportSummary(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Server error' });
    });
  });

  describe('getOwnerOrders', () => {
    it('should return owner orders without status filter', async () => {
      req.query = { page: '1', limit: '10' };
      const mockCount = [{ total: 15 }];
      const mockOrders = [
        { order_id: 1, status: 'PENDING' },
        { order_id: 2, status: 'COMPLETED' }
      ];

      mockQuery
        .mockResolvedValueOnce([mockCount])
        .mockResolvedValueOnce([mockOrders]);

      await ownerController.getOwnerOrders(req, res);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(1, expect.any(String), [1]);
      expect(mockQuery).toHaveBeenNthCalledWith(2, expect.any(String), [1, 10, 0]);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: mockOrders,
        pagination: { page: 1, limit: 10, total: 15 }
      });
    });

    it('should return owner orders with status filter', async () => {
      req.query = { status: 'COMPLETED', page: '2', limit: '5' };
      const mockCount = [{ total: 2 }];
      const mockOrders = [
        { order_id: 2, status: 'COMPLETED' },
        { order_id: 3, status: 'COMPLETED' }
      ];

      mockQuery
        .mockResolvedValueOnce([mockCount])
        .mockResolvedValueOnce([mockOrders]);

      await ownerController.getOwnerOrders(req, res);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(1, expect.any(String), [1, 'COMPLETED']);
      expect(mockQuery).toHaveBeenNthCalledWith(2, expect.any(String), [1, 'COMPLETED', 5, 5]);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: mockOrders,
        pagination: { page: 2, limit: 5, total: 2 }
      });
    });
    
    it('should return owner orders using default page and limit', async () => {
      req.query = {};
      const mockCount = [{ total: 1 }];
      const mockOrders = [
        { order_id: 1, status: 'PENDING' }
      ];

      mockQuery
        .mockResolvedValueOnce([mockCount])
        .mockResolvedValueOnce([mockOrders]);

      await ownerController.getOwnerOrders(req, res);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(1, expect.any(String), [1]);
      expect(mockQuery).toHaveBeenNthCalledWith(2, expect.any(String), [1, 10, 0]);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: mockOrders,
        pagination: { page: 1, limit: 10, total: 1 }
      });
    });

    it('should handle database errors in getOwnerOrders', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB Error'));
      await ownerController.getOwnerOrders(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Server error' });
    });
  });
});
