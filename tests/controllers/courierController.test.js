jest.mock('../../config/db', () => {
  const mockQuery = jest.fn();
  const mockRelease = jest.fn();
  const mockBeginTransaction = jest.fn();
  const mockCommit = jest.fn();
  const mockRollback = jest.fn();

  const mockConnection = {
    beginTransaction: mockBeginTransaction,
    commit: mockCommit,
    rollback: mockRollback,
    release: mockRelease,
    query: mockQuery
  };

  const mockGetConnection = jest.fn().mockImplementation(() => Promise.resolve(mockConnection));

  return {
    query: mockQuery,
    getConnection: mockGetConnection,
    mockRelease,
    mockBeginTransaction,
    mockCommit,
    mockRollback,
    mockConnection
  };
});

const mockDb = require('../../config/db');
const mockQuery = mockDb.query;
const mockGetConnection = mockDb.getConnection;
const mockRelease = mockDb.mockRelease;
const mockBeginTransaction = mockDb.mockBeginTransaction;
const mockCommit = mockDb.mockCommit;
const mockRollback = mockDb.mockRollback;
const mockConnection = mockDb.mockConnection;

jest.mock('../../helpers/notification', () => ({
  createNotification: jest.fn()
}));

jest.mock('../../helpers/validators', () => ({
  isValidLatLng: jest.fn()
}));

const { createNotification } = require('../../helpers/notification');
const { isValidLatLng } = require('../../helpers/validators');
const courierController = require('../../controllers/courierController');

describe('Courier Controller', () => {
  let req, res;
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnection.mockImplementation(() => Promise.resolve(mockConnection));
    
    // Silence console.error for tests
    jest.spyOn(console, 'error').mockImplementation(() => {});

    req = {
      body: {},
      params: {},
      query: {},
      user: { id: 1 }
    };
    
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
  });
  
  describe('updateLocation', () => {
    it('should return 422 if lat is missing', async () => {
      req.body = { lng: 106.8, assignment_id: 1 };
      await courierController.updateLocation(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Validation error',
        errors: expect.objectContaining({ lat: ['lat wajib diisi'] })
      }));
    });

    it('should return 422 if lng is missing', async () => {
      req.body = { lat: -6.2, assignment_id: 1 };
      await courierController.updateLocation(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('should return 422 if assignment_id is missing', async () => {
      req.body = { lat: -6.2, lng: 106.8 };
      await courierController.updateLocation(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('should return 422 if isValidLatLng returns false', async () => {
      req.body = { lat: -200, lng: 200, assignment_id: 1 };
      isValidLatLng.mockReturnValue(false);
      await courierController.updateLocation(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'lat harus -90..90, lng harus -180..180' });
    });

    it('should return 403 if assignment not found or not assigned to courier', async () => {
      req.body = { lat: -6.2, lng: 106.8, assignment_id: 1 };
      isValidLatLng.mockReturnValue(true);
      mockQuery.mockResolvedValue([[]]); // empty assignments
      
      await courierController.updateLocation(req, res);
      
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT assignment_id FROM courier_assignments WHERE assignment_id = ? AND courier_id = ?',
        [1, 1]
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should insert location and return success', async () => {
      req.body = { lat: -6.2, lng: 106.8, assignment_id: 1 };
      isValidLatLng.mockReturnValue(true);
      
      // Mock first query (SELECT)
      mockQuery.mockResolvedValueOnce([[{ assignment_id: 1 }]]);
      // Mock second query (INSERT)
      mockQuery.mockResolvedValueOnce([{}]);
      
      await courierController.updateLocation(req, res);
      
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        'INSERT INTO courier_locations (courier_id, assignment_id, lat, lng) VALUES (?, ?, ?, ?)',
        [1, 1, -6.2, 106.8]
      );
      
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Location updated',
        data: { courier_id: 1, lat: -6.2, lng: 106.8 }
      });
    });

    it('should handle server error', async () => {
      req.body = { lat: -6.2, lng: 106.8, assignment_id: 1 };
      isValidLatLng.mockReturnValue(true);
      mockQuery.mockRejectedValue(new Error('DB Error'));
      
      await courierController.updateLocation(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('updateTaskStatus', () => {
    beforeEach(() => {
      req.params = { assignment_id: 1 };
    });

    it('should return 422 if status is missing', async () => {
      req.body = {};
      await courierController.updateTaskStatus(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'status wajib diisi' });
    });

    it('should return 404 if assignment not found', async () => {
      req.body = { status: 'PICKUP_ON_THE_WAY' };
      mockQuery.mockResolvedValueOnce([[]]);
      
      await courierController.updateTaskStatus(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 403 if assignment belongs to another courier', async () => {
      req.body = { status: 'PICKUP_ON_THE_WAY' };
      mockQuery.mockResolvedValueOnce([[{ courier_id: 999 }]]);
      
      await courierController.updateTaskStatus(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    // Pickup Phase tests
    describe('Phase: pickup', () => {
      let assignment;
      beforeEach(() => {
        assignment = { courier_id: 1, current_phase: 'pickup', order_id: 1, pickup_status: null };
        req.body = { status: 'PICKUP_ON_THE_WAY' };
      });

      it('should return 422 for invalid status', async () => {
        req.body.status = 'INVALID_STATUS';
        mockQuery.mockResolvedValueOnce([[assignment]]); // select assignment
        mockQuery.mockResolvedValueOnce([[{ customer_id: 2 }]]); // select order (inside tx)
        
        await courierController.updateTaskStatus(req, res);
        
        expect(res.status).toHaveBeenCalledWith(422);
        expect(mockRollback).toHaveBeenCalled();
      });

      it('should return 422 if PICKUP_ON_THE_WAY but already started', async () => {
        assignment.pickup_status = 'PICKUP_ON_THE_WAY';
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[{ customer_id: 2 }]]);
        
        await courierController.updateTaskStatus(req, res);
        
        expect(res.status).toHaveBeenCalledWith(422);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Pickup already started' }));
        expect(mockRollback).toHaveBeenCalled();
      });

      it('should return 422 if LAUNDRY_PICKED but not PICKUP_ON_THE_WAY', async () => {
        req.body.status = 'LAUNDRY_PICKED';
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[{ customer_id: 2 }]]);
        
        await courierController.updateTaskStatus(req, res);
        
        expect(res.status).toHaveBeenCalledWith(422);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Must be PICKUP_ON_THE_WAY before LAUNDRY_PICKED' }));
      });

      it('should update status to PICKUP_ON_THE_WAY and notify customer', async () => {
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[{ customer_id: 2, order_id: 1 }]]); // order
        
        await courierController.updateTaskStatus(req, res);
        
        expect(mockQuery).toHaveBeenCalledWith(
          'UPDATE courier_assignments SET pickup_status = ? WHERE assignment_id = ?',
          ['PICKUP_ON_THE_WAY', 1]
        );
        expect(createNotification).toHaveBeenCalledWith(expect.anything(), 2, 'Kurir Dalam Perjalanan', expect.any(String));
        
        // Assert order update
        expect(mockQuery).toHaveBeenCalledWith(
          'UPDATE orders SET status = ? WHERE order_id = ?',
          ['PICKUP_ON_THE_WAY', 1]
        );
        expect(mockQuery).toHaveBeenCalledWith(
          'INSERT INTO order_status_logs (order_id, status, changed_by) VALUES (?, ?, ?)',
          [1, 'PICKUP_ON_THE_WAY', 1]
        );
        expect(mockCommit).toHaveBeenCalled();
        expect(mockRelease).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      });

      it('should update status to LAUNDRY_PICKED and notify customer and owner', async () => {
        req.body.status = 'LAUNDRY_PICKED';
        assignment.pickup_status = 'PICKUP_ON_THE_WAY';
        
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[{ customer_id: 2, order_id: 1, owner_id: 3 }]]); // order
        
        await courierController.updateTaskStatus(req, res);
        
        expect(createNotification).toHaveBeenCalledWith(expect.anything(), 2, 'Laundry Diambil', expect.any(String));
        expect(createNotification).toHaveBeenCalledWith(expect.anything(), 3, 'Laundry Diambil', expect.any(String));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      });
      
      it('should handle LAUNDRY_PICKED when no owner_id in order', async () => {
        req.body.status = 'LAUNDRY_PICKED';
        assignment.pickup_status = 'PICKUP_ON_THE_WAY';
        
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[{ customer_id: 2, order_id: 1 }]]); // order without owner_id
        
        await courierController.updateTaskStatus(req, res);
        
        expect(createNotification).toHaveBeenCalledWith(expect.anything(), 2, 'Laundry Diambil', expect.any(String));
        expect(createNotification).not.toHaveBeenCalledWith(expect.anything(), undefined, 'Laundry Diambil', expect.any(String));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      });
      
      it('should work even if order is null', async () => {
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[]]); // empty orders
        
        await courierController.updateTaskStatus(req, res);
        
        expect(createNotification).not.toHaveBeenCalled();
        expect(mockCommit).toHaveBeenCalled();
      });
    });

    describe('Phase: delivery', () => {
      let assignment;
      beforeEach(() => {
        assignment = { courier_id: 1, current_phase: 'delivery', order_id: 1, delivery_status: null };
        req.body = { status: 'DELIVERY_ON_THE_WAY' };
      });

      it('should return 422 for invalid status', async () => {
        req.body.status = 'INVALID';
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[{ customer_id: 2 }]]);
        
        await courierController.updateTaskStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
      });

      it('should return 422 if DELIVERY_ON_THE_WAY but already started', async () => {
        assignment.delivery_status = 'DELIVERY_ON_THE_WAY';
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[{ customer_id: 2 }]]);
        
        await courierController.updateTaskStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
      });

      it('should return 422 if DELIVERED but not DELIVERY_ON_THE_WAY', async () => {
        req.body.status = 'DELIVERED';
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[{ customer_id: 2 }]]);
        
        await courierController.updateTaskStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
      });

      it('should return 422 if DONE but not DELIVERED', async () => {
        req.body.status = 'DONE';
        assignment.delivery_status = 'DELIVERY_ON_THE_WAY';
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[{ customer_id: 2 }]]);
        
        await courierController.updateTaskStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
      });

      it('should update status to DELIVERY_ON_THE_WAY and notify customer', async () => {
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[{ customer_id: 2, order_id: 1 }]]); // order
        
        await courierController.updateTaskStatus(req, res);
        
        expect(mockQuery).toHaveBeenCalledWith(
          'UPDATE courier_assignments SET delivery_status = ? WHERE assignment_id = ?',
          ['DELIVERY_ON_THE_WAY', 1]
        );
        expect(createNotification).toHaveBeenCalledWith(expect.anything(), 2, 'Laundry Sedang Diantar', expect.any(String));
        
        expect(mockQuery).toHaveBeenCalledWith(
          'UPDATE orders SET status = ? WHERE order_id = ?',
          ['DELIVERY_ON_THE_WAY', 1]
        );
      });

      it('should update status to DELIVERED without notifying or updating order status', async () => {
        req.body.status = 'DELIVERED';
        assignment.delivery_status = 'DELIVERY_ON_THE_WAY';
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[{ customer_id: 2, order_id: 1 }]]); // order
        
        await courierController.updateTaskStatus(req, res);
        
        expect(mockQuery).toHaveBeenCalledWith(
          'UPDATE courier_assignments SET delivery_status = ? WHERE assignment_id = ?',
          ['DELIVERED', 1]
        );
        expect(createNotification).not.toHaveBeenCalled();
      });

      it('should update status to DONE and notify customer', async () => {
        req.body.status = 'DONE';
        assignment.delivery_status = 'DELIVERED';
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[{ customer_id: 2, order_id: 1 }]]); // order
        
        await courierController.updateTaskStatus(req, res);
        
        expect(mockQuery).toHaveBeenCalledWith(
          'UPDATE courier_assignments SET delivery_status = ? WHERE assignment_id = ?',
          ['DONE', 1]
        );
        expect(createNotification).toHaveBeenCalledWith(expect.anything(), 2, 'Laundry Tiba', expect.any(String));
        expect(mockQuery).toHaveBeenCalledWith(
          'UPDATE orders SET status = ? WHERE order_id = ?',
          ['DELIVERED', 1]
        );
      });
      
      it('should handle DONE when order is null', async () => {
        req.body.status = 'DONE';
        assignment.delivery_status = 'DELIVERED';
        mockQuery.mockResolvedValueOnce([[assignment]]);
        mockQuery.mockResolvedValueOnce([[]]); // no order
        
        await courierController.updateTaskStatus(req, res);
        
        expect(createNotification).not.toHaveBeenCalled();
      });
    });

    it('should rollback if phase is invalid', async () => {
      req.body = { status: 'ANY' };
      mockQuery.mockResolvedValueOnce([[{ courier_id: 1, current_phase: 'unknown', order_id: 1 }]]);
      mockQuery.mockResolvedValueOnce([[{}]]);
      
      await courierController.updateTaskStatus(req, res);
      
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid phase: unknown' }));
      expect(mockRollback).toHaveBeenCalled();
    });

    it('should throw inner error and rollback', async () => {
      req.body = { status: 'PICKUP_ON_THE_WAY' };
      mockQuery.mockResolvedValueOnce([[{ courier_id: 1, current_phase: 'pickup', order_id: 1, pickup_status: null }]]);
      mockQuery.mockRejectedValueOnce(new Error('Inner Error')); // Query inside transaction fails
      
      await courierController.updateTaskStatus(req, res);
      
      expect(mockRollback).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should handle outer server error', async () => {
      req.body = { status: 'PICKUP_ON_THE_WAY' };
      mockQuery.mockRejectedValueOnce(new Error('Outer Error')); // SELECT assignment fails
      
      await courierController.updateTaskStatus(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getTasks', () => {
    it('should return tasks successfully', async () => {
      const mockTasks = [{ assignment_id: 1 }];
      mockQuery.mockResolvedValueOnce([mockTasks]);
      
      await courierController.getTasks(req, res);
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT ca.assignment_id'),
        [1]
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Success', data: mockTasks });
    });

    it('should handle server error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB Error'));
      await courierController.getTasks(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getTaskHistory', () => {
    it('should return task history successfully', async () => {
      const mockHistory = [{ assignment_id: 1 }];
      mockQuery.mockResolvedValueOnce([mockHistory]);
      
      await courierController.getTaskHistory(req, res);
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("ca.delivery_status = 'DONE'"),
        [1]
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Success', data: mockHistory });
    });

    it('should handle server error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB Error'));
      await courierController.getTaskHistory(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getAvailableCouriers', () => {
    it('should return available couriers', async () => {
      const mockCouriers = [{ user_id: 2, full_name: 'Courier A' }];
      mockQuery.mockResolvedValueOnce([mockCouriers]);
      
      await courierController.getAvailableCouriers(req, res);
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE u.role = 'courier' AND u.is_verified = 1")
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Success', data: mockCouriers });
    });

    it('should handle server error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB Error'));
      await courierController.getAvailableCouriers(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getEarnings', () => {
    it('should return earnings without dates and with empty wallet', async () => {
      const mockSummary = [{ total_deliveries: 5, total_earned: '50000' }];
      const mockWallet = [];
      const mockByDay = [{ date: '2023-01-01', deliveries: 5, earned: 50000 }];
      
      mockQuery
        .mockResolvedValueOnce([mockSummary])
        .mockResolvedValueOnce([mockWallet])
        .mockResolvedValueOnce([mockByDay]);
      
      await courierController.getEarnings(req, res);
      
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT COUNT(*) AS total_deliveries'),
        [1]
      );
      
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: {
          total_deliveries: 5,
          total_earned: 50000,
          available_balance: 0,
          pending_balance: 0,
          avg_per_day: 50000,
          by_day: mockByDay
        }
      });
    });

    it('should return earnings with date filter and wallet data', async () => {
      req.query = { date_from: '2023-01-01', date_to: '2023-01-02' };
      const mockSummary = [{ total_deliveries: 10, total_earned: '100000' }];
      const mockWallet = [{ available_balance: '20000', pending_balance: '10000' }];
      const mockByDay = [{ date: '2023-01-01', deliveries: 10, earned: 100000 }];
      
      mockQuery
        .mockResolvedValueOnce([mockSummary])
        .mockResolvedValueOnce([mockWallet])
        .mockResolvedValueOnce([mockByDay]);
      
      await courierController.getEarnings(req, res);
      
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('ca.updated_at >= ? AND ca.updated_at <= ?'),
        [1, '2023-01-01', '2023-01-02 23:59:59']
      );
      
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          total_earned: 100000,
          available_balance: 20000,
          pending_balance: 10000,
          avg_per_day: 100000
        })
      }));
    });
    
    it('should return earnings with dates that are identical (days=1)', async () => {
      req.query = { date_from: '2023-01-01', date_to: '2023-01-01' };
      const mockSummary = [{ total_deliveries: 2, total_earned: '20000' }];
      
      mockQuery
        .mockResolvedValueOnce([mockSummary])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]]);
        
      await courierController.getEarnings(req, res);
      
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          avg_per_day: 20000
        })
      }));
    });

    it('should apply date_from only', async () => {
      req.query = { date_from: '2023-01-01' };
      const mockSummary = [{ total_deliveries: 2, total_earned: '20000' }];
      mockQuery.mockResolvedValue([[]]).mockResolvedValueOnce([mockSummary]).mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
      
      await courierController.getEarnings(req, res);
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('ca.updated_at >= ?'),
        [1, '2023-01-01']
      );
    });

    it('should apply date_to only', async () => {
      req.query = { date_to: '2023-01-02' };
      const mockSummary = [{ total_deliveries: 2, total_earned: '20000' }];
      mockQuery.mockResolvedValue([[]]).mockResolvedValueOnce([mockSummary]).mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
      
      await courierController.getEarnings(req, res);
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('ca.updated_at <= ?'),
        [1, '2023-01-02 23:59:59']
      );
    });

    it('should handle server error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB Error'));
      await courierController.getEarnings(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
