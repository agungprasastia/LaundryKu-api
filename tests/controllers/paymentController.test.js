const mockQuery = jest.fn();
const mockBeginTransaction = jest.fn();
const mockCommit = jest.fn();
const mockRollback = jest.fn();
const mockRelease = jest.fn();

const mockGetConnection = jest.fn().mockResolvedValue({
  beginTransaction: mockBeginTransaction,
  commit: mockCommit,
  rollback: mockRollback,
  release: mockRelease,
  query: mockQuery
});

jest.mock('mysql2/promise', () => {
  return {
    createPool: () => ({
      query: mockQuery,
      getConnection: mockGetConnection
    }),
    mockQuery,
    mockGetConnection
  };
});

jest.mock('../../helpers/idGenerator', () => ({
  generateId: jest.fn((prefix) => `${prefix}-12345`)
}));

jest.mock('../../helpers/notification', () => ({
  createNotification: jest.fn()
}));

const mockCreateTransaction = jest.fn();
jest.mock('midtrans-client', () => {
  return {
    Snap: jest.fn().mockImplementation(() => ({
      createTransaction: mockCreateTransaction
    }))
  };
});

const crypto = require('crypto');
const pool = require('../../config/db');

describe('Payment Controller', () => {
  let paymentController;

  const loadController = (dummyPayment, midtransKey) => {
    jest.isolateModules(() => {
      process.env.USE_DUMMY_PAYMENT = dummyPayment ? 'true' : 'false';
      if (midtransKey !== undefined) {
        process.env.MIDTRANS_SERVER_KEY = midtransKey;
      } else {
        delete process.env.MIDTRANS_SERVER_KEY;
      }
      paymentController = require('../../controllers/paymentController');
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnection.mockResolvedValue({
      beginTransaction: mockBeginTransaction,
      commit: mockCommit,
      rollback: mockRollback,
      release: mockRelease,
      query: mockQuery
    });
    
    // restore other mocks
    require('../../helpers/idGenerator').generateId.mockImplementation((prefix) => `${prefix}-12345`);
    
    const midtrans = require('midtrans-client');
    if (midtrans.Snap && midtrans.Snap.mockImplementation) {
      midtrans.Snap.mockImplementation(() => ({
        createTransaction: mockCreateTransaction
      }));
    }
  });

  describe('Initialization', () => {
    it('should warn if midtrans-client is not installed when dummy mode is false', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const midtrans = require('midtrans-client');
      midtrans.Snap.mockImplementationOnce(() => {
        throw new Error('Snap not available');
      });
      loadController(false, 'valid-key');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('midtrans-client not installed'));
      consoleSpy.mockRestore();
    });
  });

  describe('getInvoice', () => {
    let req, res;
    beforeEach(() => {
      loadController(true, 'key');
      req = { params: { invoice_id: 'INV-1' }, user: { id: 1, role: 'customer' } };
      res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    });

    it('should return 404 if invoice not found', async () => {
      mockQuery.mockResolvedValueOnce([[]]);
      await paymentController.getInvoice(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 403 if customer accesses other invoice', async () => {
      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', customer_id: 2, order_id: 'ORD-1' }]]);
      await paymentController.getInvoice(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 403 if owner accesses other invoice', async () => {
      req.user.role = 'owner';
      req.user.id = 99;
      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', owner_id: 2, order_id: 'ORD-1' }]]);
      await paymentController.getInvoice(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 403 if courier not assigned', async () => {
      req.user.role = 'courier';
      req.user.id = 3;
      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', order_id: 'ORD-1' }]]);
      mockQuery.mockResolvedValueOnce([[]]); // assignments
      await paymentController.getInvoice(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 200 with invoice data for assigned courier', async () => {
      req.user.role = 'courier';
      req.user.id = 3;
      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', order_id: 'ORD-1', amount: 100, service_fee: 80, delivery_fee: 20, status: 'unpaid' }]]);
      mockQuery.mockResolvedValueOnce([[{ assignment_id: 1 }]]); // assignments
      await paymentController.getInvoice(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should return 200 with invoice data for admin', async () => {
      req.user.role = 'admin';
      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', order_id: 'ORD-1', amount: 100, service_fee: 80, delivery_fee: 20, status: 'unpaid' }]]);
      await paymentController.getInvoice(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should return 500 on db error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('db error'));
      await paymentController.getInvoice(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('createPayment', () => {
    let req, res;
    beforeEach(() => {
      req = { body: { invoice_id: 'INV-1' }, user: { id: 1 } };
      res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    });

    it('should return 422 if invoice_id is missing', async () => {
      loadController(true);
      req.body = {};
      await paymentController.createPayment(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('should return 404 if invoice not found', async () => {
      loadController(true);
      mockQuery.mockResolvedValueOnce([[]]);
      await paymentController.createPayment(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 403 if invoice not belonging to user', async () => {
      loadController(true);
      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', customer_id: 99 }]]);
      await paymentController.createPayment(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 400 if invoice already paid', async () => {
      loadController(true);
      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', customer_id: 1, status: 'paid' }]]);
      await paymentController.createPayment(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 if invoice amount <= 0', async () => {
      loadController(true);
      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', customer_id: 1, status: 'unpaid', amount: 0 }]]);
      await paymentController.createPayment(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 409 if existing pending payment', async () => {
      loadController(true);
      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', customer_id: 1, status: 'unpaid', amount: 100 }]]);
      mockQuery.mockResolvedValueOnce([[{ payment_id: 'PAY-1', va_number: '123' }]]);
      await paymentController.createPayment(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('should create dummy payment when USE_DUMMY_PAYMENT=true', async () => {
      loadController(true);
      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', customer_id: 1, status: 'unpaid', amount: 100, order_id: 'ORD-1' }]]);
      mockQuery.mockResolvedValueOnce([[]]);
      mockQuery.mockResolvedValueOnce([[{ full_name: 'John', email: 'a@b.com' }]]);
      mockQuery.mockResolvedValueOnce([]); // insert payment

      await paymentController.createPayment(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ mode: 'dummy' })
      }));
    });

    it('should return 503 if midtrans server key is default placeholder', async () => {
      loadController(false, 'SB-Mid-server-xxxxxxxxxxxxxxxxxxxxxxxx');
      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', customer_id: 1, status: 'unpaid', amount: 100, order_id: 'ORD-1' }]]);
      mockQuery.mockResolvedValueOnce([[]]);
      mockQuery.mockResolvedValueOnce([[{ full_name: 'John', email: 'a@b.com' }]]);

      await paymentController.createPayment(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('should return 503 if midtrans client is unavailable (snap is null)', async () => {
      const midtrans = require('midtrans-client');
      midtrans.Snap.mockImplementationOnce(() => {
        throw new Error('Snap not available');
      });
      loadController(false, 'valid-key');

      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', customer_id: 1, status: 'unpaid', amount: 100, order_id: 'ORD-1' }]]);
      mockQuery.mockResolvedValueOnce([[]]);
      mockQuery.mockResolvedValueOnce([[{ full_name: 'John', email: 'a@b.com' }]]);

      await paymentController.createPayment(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('should return 502 and log error if midtrans snap fails', async () => {
      loadController(false, 'valid-key');
      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', customer_id: 1, status: 'unpaid', amount: 100, order_id: 'ORD-1' }]]);
      mockQuery.mockResolvedValueOnce([[]]);
      mockQuery.mockResolvedValueOnce([[{ full_name: 'John', email: 'a@b.com' }]]);

      const err = new Error('Snap failed');
      err.ApiResponse = { error_messages: ['Failed'] };
      mockCreateTransaction.mockRejectedValueOnce(err);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      await paymentController.createPayment(req, res);

      expect(res.status).toHaveBeenCalledWith(502);
      expect(consoleSpy).toHaveBeenCalledWith('Midtrans API Response:', JSON.stringify(err.ApiResponse));
      consoleSpy.mockRestore();
    });

    it('should create midtrans payment successfully', async () => {
      loadController(false, 'valid-key');
      mockQuery.mockResolvedValueOnce([[{ invoice_id: 'INV-1', customer_id: 1, status: 'unpaid', amount: 100, order_id: 'ORD-1' }]]);
      mockQuery.mockResolvedValueOnce([[]]);
      mockQuery.mockResolvedValueOnce([[{ full_name: 'John', email: 'a@b.com' }]]);
      mockCreateTransaction.mockResolvedValueOnce({ token: 'snap-token', redirect_url: 'http://midtrans.com' });
      mockQuery.mockResolvedValueOnce([]); // insert

      await paymentController.createPayment(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ snap_token: 'snap-token' })
      }));
    });

    it('should return 500 on db error', async () => {
      loadController(true);
      mockQuery.mockRejectedValueOnce(new Error('db error'));
      await paymentController.createPayment(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('paymentCallback', () => {
    let req, res;
    beforeEach(() => {
      req = { body: {} };
      res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      mockBeginTransaction.mockClear();
      mockCommit.mockClear();
      mockRollback.mockClear();
      mockRelease.mockClear();
      mockQuery.mockClear();
    });

    const validSignature = (orderId, statusCode, grossAmount, serverKey) => {
      return crypto.createHash('sha512').update(orderId + statusCode + grossAmount + serverKey).digest('hex');
    };

    // --- Dummy Mode ---
    it('should return 400 if dummy payment_id missing', async () => {
      loadController(true);
      await paymentController.paymentCallback(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 200 early if dummy status is pending', async () => {
      loadController(true);
      req.body = { payment_id: 'PAY-1', status: 'pending' };
      await paymentController.paymentCallback(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('pending') }));
    });

    it('should return 200 early if dummy status is unhandled', async () => {
      loadController(true);
      req.body = { payment_id: 'PAY-1', status: 'unknown_status' };
      await paymentController.paymentCallback(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Unhandled status') }));
    });

    it('should process failed dummy payment', async () => {
      loadController(true);
      req.body = { payment_id: 'PAY-1', status: 'failed' };
      mockQuery.mockResolvedValueOnce([[{ payment_id: 'PAY-1', status: 'pending', amount: 100 }]]);
      mockQuery.mockResolvedValueOnce([]); // update status
      
      await paymentController.paymentCallback(req, res);
      expect(mockCommit).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('marked as failed') }));
    });

    // --- Midtrans Mode ---
    it('should return 400 if midtrans missing required fields', async () => {
      loadController(false, 'key');
      req.body = { order_id: 'PAY-1' };
      await paymentController.paymentCallback(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 503 if midtrans key not configured', async () => {
      loadController(false, '');
      req.body = { order_id: 'PAY-1', status_code: '200', gross_amount: '100.00', signature_key: 'sig' };
      await paymentController.paymentCallback(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('should return 403 if invalid signature', async () => {
      loadController(false, 'key');
      req.body = { order_id: 'PAY-1', status_code: '200', gross_amount: '100.00', signature_key: 'invalid' };
      await paymentController.paymentCallback(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 200 early if midtrans status is pending', async () => {
      loadController(false, 'key');
      const sig = validSignature('PAY-1', '201', '100.00', 'key');
      req.body = { order_id: 'PAY-1', status_code: '201', gross_amount: '100.00', signature_key: sig, transaction_status: 'pending' };
      await paymentController.paymentCallback(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('pending') }));
    });

    it('should return 200 early for unhandled midtrans transaction_status', async () => {
      loadController(false, 'key');
      const sig = validSignature('PAY-1', '200', '100.00', 'key');
      req.body = { order_id: 'PAY-1', status_code: '200', gross_amount: '100.00', signature_key: sig, transaction_status: 'refund' };
      await paymentController.paymentCallback(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Unhandled status') }));
    });

    it('should process failed midtrans capture (fraud != accept)', async () => {
      loadController(false, 'key');
      const sig = validSignature('PAY-1', '200', '100.00', 'key');
      req.body = { order_id: 'PAY-1', status_code: '200', gross_amount: '100.00', signature_key: sig, transaction_status: 'capture', fraud_status: 'challenge' };
      
      mockQuery.mockResolvedValueOnce([[{ payment_id: 'PAY-1', status: 'pending', amount: 100 }]]);
      mockQuery.mockResolvedValueOnce([]); // update failed
      
      await paymentController.paymentCallback(req, res);
      expect(mockCommit).toHaveBeenCalled();
    });

    it('should process failed midtrans settlement (deny/cancel/expire)', async () => {
      loadController(false, 'key');
      const sig = validSignature('PAY-1', '200', '100.00', 'key');
      req.body = { order_id: 'PAY-1', status_code: '200', gross_amount: '100.00', signature_key: sig, transaction_status: 'cancel' };
      
      mockQuery.mockResolvedValueOnce([[{ payment_id: 'PAY-1', status: 'pending', amount: 100 }]]);
      mockQuery.mockResolvedValueOnce([]); // update failed
      
      await paymentController.paymentCallback(req, res);
      expect(mockCommit).toHaveBeenCalled();
    });

    it('should process success midtrans capture (fraud = accept) and not downgrade order status', async () => {
      loadController(false, 'key');
      const sig = validSignature('PAY-1', '200', '100.00', 'key');
      req.body = { order_id: 'PAY-1', status_code: '200', gross_amount: '100.00', signature_key: sig, transaction_status: 'capture', fraud_status: 'accept' };
      
      mockQuery.mockResolvedValueOnce([[{ payment_id: 'PAY-1', invoice_id: 'INV-1', status: 'pending', amount: 100 }]]);
      mockQuery.mockResolvedValueOnce([]); // update payment
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1' }]]); // invoice
      mockQuery.mockResolvedValueOnce([]); // update invoice
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1', status: 'COMPLETED' }]]); // order (no status update)
      mockQuery.mockResolvedValueOnce([[]]); // existing txns
      mockQuery.mockResolvedValueOnce([[]]); // assignments
      // Note: we might need more mocks if createNotification makes queries? No, it's mocked globally.
      
      await paymentController.paymentCallback(req, res);
      // Assert that no error occurred
      if (res.status.mock.calls.length > 0) {
        console.error('Response status called with:', res.status.mock.calls[0][0]);
      }
      expect(mockCommit).toHaveBeenCalled();
    });

    // --- processCallbackInternal specifics ---
    it('should return 404 if payment not found', async () => {
      loadController(true);
      req.body = { payment_id: 'PAY-1', status: 'success' };
      mockQuery.mockResolvedValueOnce([[]]);
      await paymentController.paymentCallback(req, res);
      expect(mockRollback).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 200 early if already processed', async () => {
      loadController(true);
      req.body = { payment_id: 'PAY-1', status: 'success' };
      mockQuery.mockResolvedValueOnce([[{ payment_id: 'PAY-1', status: 'success' }]]); 
      await paymentController.paymentCallback(req, res);
      expect(mockRollback).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('already processed') }));
    });

    it('should return 400 on amount mismatch for midtrans mode', async () => {
      loadController(false, 'key');
      const sig = validSignature('PAY-1', '200', '100.00', 'key');
      req.body = { order_id: 'PAY-1', status_code: '200', gross_amount: '100.00', signature_key: sig, transaction_status: 'settlement' };
      
      mockQuery.mockResolvedValueOnce([[{ payment_id: 'PAY-1', status: 'pending', amount: 50 }]]);
      
      await paymentController.paymentCallback(req, res);
      expect(mockRollback).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should distribute wallets on success', async () => {
      loadController(true);
      req.body = { payment_id: 'PAY-1', status: 'success', payment_type: 'bank_transfer' };
      
      mockQuery.mockResolvedValueOnce([[{ payment_id: 'PAY-1', invoice_id: 'INV-1', status: 'pending' }]]);
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1' }]]);
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1', status: 'CONFIRMED', customer_id: 1, owner_id: 2, owner_earning: 50, courier_earning: 30, admin_commission: 20 }]]);
      mockQuery.mockResolvedValueOnce([]); // update status
      mockQuery.mockResolvedValueOnce([]); // insert log
      mockQuery.mockResolvedValueOnce([[]]); // existing txns
      
      mockQuery.mockResolvedValueOnce([[{ wallet_id: 'W-OWNER' }]]); // owner wallet
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([]);
      
      mockQuery.mockResolvedValueOnce([[{ courier_id: 3 }]]); // courier assignments
      mockQuery.mockResolvedValueOnce([[{ wallet_id: 'W-COURIER' }]]); // courier wallet
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([]);
      
      mockQuery.mockResolvedValueOnce([[{ wallet_id: 'W-ADMIN' }]]); // admin wallet
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([]);
      
      await paymentController.paymentCallback(req, res);
      expect(mockCommit).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ wallet_distributed: true })
      }));
    });

    it('should skip wallet distribution if already distributed', async () => {
      loadController(true);
      req.body = { payment_id: 'PAY-1', status: 'success', payment_type: 'bank_transfer' };
      
      mockQuery.mockResolvedValueOnce([[{ payment_id: 'PAY-1', invoice_id: 'INV-1', status: 'pending' }]]);
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1' }]]);
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1', status: 'CONFIRMED', customer_id: 1, owner_id: 2, owner_earning: 50 }]]);
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([[{ transaction_id: 'TXN-1' }]]); // existing txns
      
      await paymentController.paymentCallback(req, res);
      expect(mockCommit).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ wallet_distributed: false })
      }));
    });

    it('should skip owner notification if owner_id is null', async () => {
      loadController(true);
      req.body = { payment_id: 'PAY-1', status: 'success' };
      
      mockQuery.mockResolvedValueOnce([[{ payment_id: 'PAY-1', invoice_id: 'INV-1', status: 'pending' }]]);
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1' }]]);
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1', status: 'CONFIRMED', customer_id: 1, owner_id: null, admin_commission: 20 }]]);
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([[]]); 
      
      mockQuery.mockResolvedValueOnce([[]]); // assignments
      mockQuery.mockResolvedValueOnce([[{ wallet_id: 'W-ADMIN' }]]);
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([]);
      
      await paymentController.paymentCallback(req, res);
      expect(mockCommit).toHaveBeenCalled();
    });

    it('should return 500 if owner wallet is missing', async () => {
      loadController(true);
      req.body = { payment_id: 'PAY-1', status: 'success' };
      
      mockQuery.mockResolvedValueOnce([[{ payment_id: 'PAY-1', invoice_id: 'INV-1', status: 'pending' }]]);
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1' }]]);
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1', status: 'CONFIRMED', customer_id: 1, owner_id: 2, owner_earning: 50 }]]);
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([[]]); 
      mockQuery.mockResolvedValueOnce([[]]); // empty owner wallet
      
      await paymentController.paymentCallback(req, res);
      expect(mockRollback).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Owner wallet not found') }));
    });

    it('should return 500 if courier wallet is missing', async () => {
      loadController(true);
      req.body = { payment_id: 'PAY-1', status: 'success' };
      
      mockQuery.mockResolvedValueOnce([[{ payment_id: 'PAY-1', invoice_id: 'INV-1', status: 'pending' }]]);
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1' }]]);
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1', status: 'CONFIRMED', customer_id: 1, courier_earning: 30 }]]);
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([[]]); 
      
      mockQuery.mockResolvedValueOnce([[{ courier_id: 3 }]]); // assignments
      mockQuery.mockResolvedValueOnce([[]]); // empty courier wallet
      
      await paymentController.paymentCallback(req, res);
      expect(mockRollback).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Courier wallet not found') }));
    });

    it('should return 500 if admin wallet is missing', async () => {
      loadController(true);
      req.body = { payment_id: 'PAY-1', status: 'success' };
      
      mockQuery.mockResolvedValueOnce([[{ payment_id: 'PAY-1', invoice_id: 'INV-1', status: 'pending' }]]);
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1' }]]);
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([[{ order_id: 'ORD-1', status: 'CONFIRMED', customer_id: 1, admin_commission: 20 }]]);
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([]); 
      mockQuery.mockResolvedValueOnce([[]]); 
      
      mockQuery.mockResolvedValueOnce([[]]); // assignments
      mockQuery.mockResolvedValueOnce([[]]); // empty admin wallet
      
      await paymentController.paymentCallback(req, res);
      expect(mockRollback).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Admin wallet not found') }));
    });

    it('should handle 500 on internal processCallbackInternal error', async () => {
      loadController(true);
      req.body = { payment_id: 'PAY-1', status: 'success' };
      mockQuery.mockRejectedValueOnce(new Error('db error'));
      
      await paymentController.paymentCallback(req, res);
      expect(mockRollback).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
