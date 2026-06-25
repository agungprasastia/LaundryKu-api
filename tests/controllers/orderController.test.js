// tests/controllers/orderController.test.js
// Mock mysql2 pool FIRST
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

jest.mock('../../helpers/notification', () => ({
  createNotification: jest.fn().mockResolvedValue(true)
}));

process.env.ALLOW_MANUAL_DISTANCE = 'true';

const request = require('supertest');
const express = require('express');
const orderController = require('../../controllers/orderController');
const { mockQuery, mockGetConnection } = require('mysql2/promise');

// Setup express app for testing
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  req.user = {
    id: parseInt(req.headers.user_id || '1', 10),
    role: req.headers.user_role || 'customer'
  };
  next();
});

// Since the controller checks req.user, we simulate the middleware via headers
app.post('/orders', orderController.createOrder);
app.get('/orders/my-orders', orderController.getMyOrders);
app.get('/orders/history', orderController.getOrderHistory);
app.get('/orders/:order_id', orderController.getOrderDetail);
app.patch('/orders/:order_id/status', orderController.updateOrderStatus);
app.post('/orders/:order_id/assign-courier', orderController.assignCourier);
app.patch('/orders/:order_id/weight', orderController.inputWeight);
app.patch('/orders/:order_id/activate-delivery', orderController.activateDelivery);
app.get('/orders/:order_id/tracking', orderController.trackOrder);
app.patch('/orders/:order_id/complete', orderController.completeOrder);

describe('Order Controller TDD', () => {
  let mockConn;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConn = {
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue([[]])
    };
    mockGetConnection.mockResolvedValue(mockConn);
    mockQuery.mockResolvedValue([[]]);
  });

  describe('POST /orders (createOrder)', () => {
    it('should fail if service_id missing', async () => {
      const res = await request(app).post('/orders').send({});
      expect(res.status).toBe(422);
    });

    it('should fail if invalid coordinates or datetime', async () => {
      const res = await request(app).post('/orders').send({
        service_id: 1,
        pickup_lat: 100,
        pickup_lng: 200,
        pickup_scheduled_at: 'invalid'
      });
      expect(res.status).toBe(422);
    });

    it('should fail if service not found or inactive', async () => {
      mockConn.query.mockResolvedValueOnce([[]]);
      const res = await request(app).post('/orders').send({ service_id: 1 });
      expect(res.status).toBe(404);
    });

    it('should create order successfully', async () => {
      const mockService = { owner_id: 2, price_per_kg_owner: 5000, price_per_kg_customer: 7000 };
      mockConn.query.mockImplementation((q) => {
        if (q.includes('SELECT * FROM services')) return [[mockService]];
        return [[]];
      });

      const res = await request(app).post('/orders').send({ service_id: 1 });
      expect(res.status).toBe(201);
      expect(res.body.data.order_id).toEqual(expect.any(String));
      expect(mockConn.beginTransaction).toHaveBeenCalled();
      expect(mockConn.commit).toHaveBeenCalled();
    });

    it('should rollback on DB error', async () => {
      mockConn.query.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app).post('/orders').send({ service_id: 1 });
      expect(res.status).toBe(500);
      expect(mockConn.rollback).toHaveBeenCalled();
    });
  });

  describe('GET /orders/my-orders (getMyOrders)', () => {
    it('should fetch orders successfully', async () => {
      mockQuery.mockImplementation((q) => {
        if (q.includes('COUNT(*)')) return [[{ total: 1 }]];
        return [[{ order_id: 'ORD-1' }]];
      });
      const res = await request(app).get('/orders/my-orders?status=CONFIRMED&page=1&limit=10');
      expect(res.status).toBe(200);
      expect(res.body.data[0].order_id).toBe('ORD-1');
    });

    it('should handle DB error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app).get('/orders/my-orders');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /orders/:order_id (getOrderDetail)', () => {
    it('should fail if order not found', async () => {
      mockQuery.mockResolvedValueOnce([[]]);
      const res = await request(app).get('/orders/ORD-1');
      expect(res.status).toBe(404);
    });

    it('should fail if forbidden customer', async () => {
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1', customer_id: 2 }]]);
      const res = await request(app).get('/orders/ORD-1').set({ user_id: '1', user_role: 'customer' });
      expect(res.status).toBe(403);
    });

    it('should fail if forbidden owner', async () => {
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1', owner_id: 2 }]]);
      const res = await request(app).get('/orders/ORD-1').set({ user_id: '1', user_role: 'owner' });
      expect(res.status).toBe(403);
    });

    it('should fail if forbidden courier', async () => {
      mockQuery.mockImplementation((q) => {
        if (q.includes('SELECT o.*')) return [[{ order_id: 'ORD-1' }]];
        if (q.includes('courier_assignments')) return [[]]; // not assigned
        return [[]];
      });
      const res = await request(app).get('/orders/ORD-1').set({ user_id: '1', user_role: 'courier' });
      expect(res.status).toBe(403);
    });

    it('should fetch order details for admin', async () => {
      mockQuery.mockImplementation((q) => {
        if (q.includes('SELECT o.*')) return [[{ order_id: 'ORD-1', customer_id: 1, owner_id: 2 }]];
        if (q.includes('courier_assignments')) return [[{ courier_name: 'John', vehicle_name: 'Bike' }]];
        if (q.includes('order_status_logs')) return [[{ status: 'CONFIRMED' }]];
        if (q.includes('invoices')) return [[{ invoice_id: 'INV-1' }]];
        return [[]];
      });
      const res = await request(app).get('/orders/ORD-1').set({ user_id: '99', user_role: 'admin' });
      expect(res.status).toBe(200);
      expect(res.body.data.order_id).toBe('ORD-1');
    });

    it('should handle DB error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app).get('/orders/ORD-1');
      expect(res.status).toBe(500);
    });
  });

  describe('PATCH /orders/:order_id/status (updateOrderStatus)', () => {
    it('should fail if invalid status', async () => {
      const res = await request(app).patch('/orders/ORD-1/status').send({ status: 'INVALID' });
      expect(res.status).toBe(422);
    });

    it('should fail if order not found or not owned', async () => {
      mockConn.query.mockResolvedValueOnce([[]]);
      const res = await request(app).patch('/orders/ORD-1/status').send({ status: 'CONFIRMED' });
      expect(res.status).toBe(404);
    });

    it('should fail if invalid status flow', async () => {
      mockConn.query.mockResolvedValueOnce([[{ order_id: 'ORD-1', status: 'COMPLETED' }]]);
      const res = await request(app).patch('/orders/ORD-1/status').send({ status: 'CONFIRMED' });
      expect(res.status).toBe(422);
    });

    it('should update status to CONFIRMED successfully', async () => {
      mockConn.query.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ order_id: 'ORD-1', status: 'WAITING_OWNER_CONFIRMATION', customer_id: 1 }]];
        return [[]];
      });
      const res = await request(app).patch('/orders/ORD-1/status').send({ status: 'CONFIRMED' });
      expect(res.status).toBe(200);
      expect(mockConn.commit).toHaveBeenCalled();
    });

    it('should handle DB error', async () => {
      mockConn.query.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app).patch('/orders/ORD-1/status').send({ status: 'CONFIRMED' });
      expect(res.status).toBe(500);
    });
  });

  describe('POST /orders/:order_id/assign-courier (assignCourier)', () => {
    it('should fail if missing courier_id', async () => {
      const res = await request(app).post('/orders/ORD-1/assign-courier').send({});
      expect(res.status).toBe(422);
    });

    it('should fail if order not found', async () => {
      mockConn.query.mockResolvedValueOnce([[]]);
      const res = await request(app).post('/orders/ORD-1/assign-courier').send({ courier_id: 3 });
      expect(res.status).toBe(404);
    });

    it('should fail if order not CONFIRMED', async () => {
      mockConn.query.mockResolvedValueOnce([[{ status: 'WAITING_OWNER_CONFIRMATION' }]]);
      const res = await request(app).post('/orders/ORD-1/assign-courier').send({ courier_id: 3 });
      expect(res.status).toBe(422);
    });

    it('should fail if courier not found', async () => {
      mockConn.query.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ status: 'CONFIRMED' }]];
        if (q.includes('SELECT user_id')) return [[]];
        return [[]];
      });
      const res = await request(app).post('/orders/ORD-1/assign-courier').send({ courier_id: 3 });
      expect(res.status).toBe(404);
    });

    it('should fail if courier not verified', async () => {
      mockConn.query.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ status: 'CONFIRMED' }]];
        if (q.includes('SELECT user_id')) return [[{ is_verified: 0 }]];
        return [[]];
      });
      const res = await request(app).post('/orders/ORD-1/assign-courier').send({ courier_id: 3 });
      expect(res.status).toBe(422);
    });

    it('should assign courier successfully', async () => {
      mockConn.query.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ status: 'CONFIRMED' }]];
        if (q.includes('SELECT user_id')) return [[{ is_verified: 1 }]];
        return [[]];
      });
      const res = await request(app).post('/orders/ORD-1/assign-courier').send({ courier_id: 3 });
      expect(res.status).toBe(201);
      expect(mockConn.commit).toHaveBeenCalled();
    });

    it('should handle duplicate assignment error', async () => {
      mockConn.query.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ status: 'CONFIRMED' }]];
        if (q.includes('SELECT user_id')) return [[{ is_verified: 1 }]];
        if (q.includes('INSERT INTO courier_assignments')) {
          const err = new Error('Duplicate');
          err.code = 'ER_DUP_ENTRY';
          throw err;
        }
        return [[]];
      });
      const res = await request(app).post('/orders/ORD-1/assign-courier').send({ courier_id: 3 });
      expect(res.status).toBe(409);
    });
  });

  describe('PATCH /orders/:order_id/weight (inputWeight)', () => {
    it('should fail if weight is invalid', async () => {
      const res = await request(app).patch('/orders/ORD-1/weight').send({ weight_kg: -5 });
      expect(res.status).toBe(422);
    });

    it('should fail if manual distance is invalid', async () => {
      const res = await request(app).patch('/orders/ORD-1/weight').send({ weight_kg: 5, distance_km: -2 });
      expect(res.status).toBe(422);
    });

    it('should fail if order not found', async () => {
      mockConn.query.mockResolvedValueOnce([[]]);
      const res = await request(app).patch('/orders/ORD-1/weight').send({ weight_kg: 5 });
      expect(res.status).toBe(404);
    });

    it('should update weight successfully via haversine', async () => {
      mockConn.query.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ 
          order_id: 'ORD-1', status: 'LAUNDRY_PICKED', 
          pickup_lat: -6.2, pickup_lng: 106.8, 
          price_per_kg_owner: 5000, price_per_kg_customer: 7000, customer_id: 1
        }]];
        if (q.includes('SELECT lat, lng FROM users')) return [[{ lat: -6.3, lng: 106.9 }]];
        return [[]];
      });
      const res = await request(app).patch('/orders/ORD-1/weight').send({ weight_kg: 5 });
      expect(res.status).toBe(200);
      expect(res.body.data.distance_source).toBe('haversine');
      expect(mockConn.commit).toHaveBeenCalled();
    });

    it('should update weight successfully via manual distance', async () => {
      mockConn.query.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ 
          order_id: 'ORD-1', status: 'LAUNDRY_PICKED', 
          pickup_lat: null, pickup_lng: null, 
          price_per_kg_owner: 5000, price_per_kg_customer: 7000, customer_id: 1
        }]];
        return [[]];
      });
      const res = await request(app).patch('/orders/ORD-1/weight').send({ weight_kg: 5, distance_km: 10 });
      expect(res.status).toBe(200);
      expect(res.body.data.distance_source).toBe('manual');
      expect(mockConn.commit).toHaveBeenCalled();
    });

    it('should fail if order not LAUNDRY_PICKED', async () => {
      mockConn.query.mockResolvedValueOnce([[{ status: 'CONFIRMED' }]]);
      const res = await request(app).patch('/orders/ORD-1/weight').send({ weight_kg: 5 });
      expect(res.status).toBe(422);
    });
  });

    it('should fail if manual distance is disabled and haversine fails', async () => {
      mockConn.query.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ 
          order_id: 'ORD-1', status: 'LAUNDRY_PICKED', 
          pickup_lat: null, pickup_lng: null, 
          price_per_kg_owner: 5000, price_per_kg_customer: 7000, customer_id: 1
        }]];
        return [[]];
      });
      process.env.ALLOW_MANUAL_DISTANCE = 'false';
      const res = await request(app).patch('/orders/ORD-1/weight').send({ weight_kg: 5, distance_km: 10 });
      expect(res.status).toBe(422);
      process.env.ALLOW_MANUAL_DISTANCE = 'true';
    });

    it('should fail if no distance calculated', async () => {
      mockConn.query.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ 
          order_id: 'ORD-1', status: 'LAUNDRY_PICKED', 
          pickup_lat: null, pickup_lng: null, 
          price_per_kg_owner: 5000, price_per_kg_customer: 7000, customer_id: 1
        }]];
        return [[]];
      });
      const res = await request(app).patch('/orders/ORD-1/weight').send({ weight_kg: 5 });
      expect(res.status).toBe(422);
    });

  describe('PATCH /orders/:order_id/activate-delivery (activateDelivery)', () => {
    it('should fail if order not found', async () => {
      mockQuery.mockResolvedValueOnce([[]]);
      const res = await request(app).patch('/orders/ORD-1/activate-delivery');
      expect(res.status).toBe(404);
    });

    it('should fail if order not READY_FOR_DELIVERY', async () => {
      mockQuery.mockResolvedValueOnce([[{ status: 'CONFIRMED' }]]);
      const res = await request(app).patch('/orders/ORD-1/activate-delivery');
      expect(res.status).toBe(422);
    });

    it('should fail if no courier assigned', async () => {
      mockQuery.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ status: 'READY_FOR_DELIVERY' }]];
        if (q.includes('SELECT * FROM courier_assignments')) return [[]];
        return [[]];
      });
      const res = await request(app).patch('/orders/ORD-1/activate-delivery');
      expect(res.status).toBe(404);
    });

    it('should activate delivery successfully', async () => {
      mockQuery.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ status: 'READY_FOR_DELIVERY' }]];
        if (q.includes('SELECT * FROM courier_assignments')) return [[{ courier_id: 3 }]];
        return [[]];
      });
      const res = await request(app).patch('/orders/ORD-1/activate-delivery');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /orders/:order_id/tracking (trackOrder)', () => {
    it('should return tracking data successfully', async () => {
      mockQuery.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ order_id: 'ORD-1', status: 'DELIVERY_ON_THE_WAY', customer_id: 1 }]];
        if (q.includes('courier_assignments')) return [[{ current_phase: 'delivery', delivery_status: 'ongoing', courier_name: 'John', vehicle_name: 'Bike' }]];
        if (q.includes('courier_locations')) return [[{ lat: -6.2, lng: 106.8, updated_at: '2023-10-10' }]];
        return [[]];
      });
      const res = await request(app).get('/orders/ORD-1/tracking').set({ user_id: '1', user_role: 'customer' });
      expect(res.status).toBe(200);
      expect(res.body.data.current_phase).toBe('delivery');
    });

    it('should fail if no courier assigned', async () => {
      mockQuery.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ order_id: 'ORD-1', customer_id: 1 }]];
        if (q.includes('courier_assignments')) return [[]];
        return [[]];
      });
      const res = await request(app).get('/orders/ORD-1/tracking').set({ user_id: '1', user_role: 'customer' });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /orders/:order_id/complete (completeOrder)', () => {
    it('should fail if order not found', async () => {
      mockConn.query.mockResolvedValueOnce([[]]);
      const res = await request(app).patch('/orders/ORD-1/complete').set({ user_id: '1', user_role: 'customer' });
      expect(res.status).toBe(404);
    });

    it('should be idempotent if already COMPLETED', async () => {
      mockConn.query.mockResolvedValueOnce([[{ customer_id: 1, status: 'COMPLETED' }]]);
      const res = await request(app).patch('/orders/ORD-1/complete').set({ user_id: '1', user_role: 'customer' });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Order already completed');
    });

    it('should complete order successfully', async () => {
      mockConn.query.mockImplementation((q) => {
        if (q.includes('SELECT * FROM orders')) return [[{ customer_id: 1, status: 'DELIVERED', owner_id: 2 }]];
        if (q.includes('wallet_transactions')) return [[{ transaction_id: 1, wallet_id: 2, amount: 5000, user_id: 2, role: 'owner' }]];
        if (q.includes('courier_assignments')) return [[{ courier_id: 3 }]];
        return [[]];
      });
      const res = await request(app).patch('/orders/ORD-1/complete').set({ user_id: '1', user_role: 'customer' });
      expect(res.status).toBe(200);
      expect(mockConn.commit).toHaveBeenCalled();
    });
  });

  describe('GET /orders/history (getOrderHistory)', () => {
    it('should fetch history successfully', async () => {
      mockQuery.mockImplementation((q) => {
        if (q.includes('COUNT(*)')) return [[{ total: 1 }]];
        if (q.includes('SUM(o.total_amount)')) return [[{ total_spent: 50000 }]];
        return [[{ order_id: 'ORD-1' }]];
      });
      const res = await request(app).get('/orders/history?date_from=2023-01-01&date_to=2023-12-31').set({ user_id: '1', user_role: 'customer' });
      expect(res.status).toBe(200);
      expect(res.body.summary.total_spent).toBe(50000);
    });

    it('should handle DB error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app).get('/orders/history');
      expect(res.status).toBe(500);
    });
  });
});
