const { mockQuery } = require('mysql2/promise');
const { isPositiveNumber } = require('../../helpers/validators');
const {
  getAllServices,
  getServiceById,
  createService,
  updateService,
  deleteService
} = require('../../controllers/serviceController');

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

describe('Service Controller', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      user: { id: 1, role: 'admin' },
      params: {},
      body: {}
    };
    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
  });

  describe('getAllServices', () => {
    it('should return all services for admin', async () => {
      req.user.role = 'admin';
      const mockServices = [{ service_id: 'S1', name: 'Wash' }];
      mockQuery.mockResolvedValue([mockServices]);

      await getAllServices(req, res);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT service_id, owner_id, name, description, price_per_kg_owner, price_per_kg_customer, is_active, created_at'),
        []
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: mockServices
      });
    });

    it('should return owned services for owner', async () => {
      req.user.role = 'owner';
      req.user.id = 2;
      const mockServices = [{ service_id: 'S2', owner_id: 2, name: 'Wash' }];
      mockQuery.mockResolvedValue([mockServices]);

      await getAllServices(req, res);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE owner_id = ?'),
        [2]
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: mockServices
      });
    });

    it('should return active services for customer/courier', async () => {
      req.user.role = 'customer';
      const mockServices = [{ service_id: 'S3', name: 'Wash' }];
      mockQuery.mockResolvedValue([mockServices]);

      await getAllServices(req, res);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE is_active = 1'),
        []
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: mockServices
      });
    });

    it('should handle db errors', async () => {
      req.user.role = 'admin';
      mockQuery.mockRejectedValue(new Error('DB error'));

      await getAllServices(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Server error' });
    });
  });

  describe('getServiceById', () => {
    it('should return 404 if service not found', async () => {
      req.params.service_id = 'S1';
      mockQuery.mockResolvedValue([[]]);

      await getServiceById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Service not found' });
    });

    it('should return 403 if owner requests other owner service', async () => {
      req.params.service_id = 'S1';
      req.user = { role: 'owner', id: 1 };
      mockQuery.mockResolvedValue([[{ service_id: 'S1', owner_id: 2 }]]);

      await getServiceById(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Forbidden: not your service' });
    });

    it('should return 404 if customer requests inactive service', async () => {
      req.params.service_id = 'S1';
      req.user = { role: 'customer', id: 1 };
      mockQuery.mockResolvedValue([[{ service_id: 'S1', is_active: 0 }]]);

      await getServiceById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Service not found' });
    });

    it('should delete price_per_kg_owner if role is customer', async () => {
      req.params.service_id = 'S1';
      req.user = { role: 'customer', id: 1 };
      mockQuery.mockResolvedValue([[{ service_id: 'S1', is_active: 1, price_per_kg_owner: 5000 }]]);

      await getServiceById(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: { service_id: 'S1', is_active: 1 } // price_per_kg_owner should be deleted
      });
    });

    it('should delete price_per_kg_owner if role is courier', async () => {
      req.params.service_id = 'S1';
      req.user = { role: 'courier', id: 1 };
      mockQuery.mockResolvedValue([[{ service_id: 'S1', is_active: 1, price_per_kg_owner: 5000 }]]);

      await getServiceById(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: { service_id: 'S1', is_active: 1 } // price_per_kg_owner should be deleted
      });
    });

    it('should return full service data for owner if they own it', async () => {
      req.params.service_id = 'S1';
      req.user = { role: 'owner', id: 1 };
      mockQuery.mockResolvedValue([[{ service_id: 'S1', owner_id: 1, is_active: 1, price_per_kg_owner: 5000 }]]);

      await getServiceById(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: { service_id: 'S1', owner_id: 1, is_active: 1, price_per_kg_owner: 5000 }
      });
    });

    it('should handle db errors', async () => {
      req.params.service_id = 'S1';
      mockQuery.mockRejectedValue(new Error('DB Error'));

      await getServiceById(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Server error' });
    });
  });

  describe('createService', () => {
    beforeEach(() => {
      req.user = { role: 'owner', id: 1 };
      req.body = {
        service_id: 'S1',
        name: 'Wash',
        price_per_kg_owner: 5000
      };
      isPositiveNumber.mockReturnValue(true);
    });

    it('should validate missing fields', async () => {
      req.body = {};

      await createService(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Validation error',
        errors: {
          service_id: ['service_id wajib diisi'],
          name: ['name wajib diisi'],
          price_per_kg_owner: ['price_per_kg_owner wajib diisi']
        }
      }));
    });

    it('should validate invalid price_per_kg_owner', async () => {
      req.body.price_per_kg_owner = -100;
      isPositiveNumber.mockReturnValue(false);

      await createService(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Validation error',
        errors: {
          price_per_kg_owner: ['price_per_kg_owner harus lebih dari 0']
        }
      }));
    });

    it('should return 409 if service_id already exists', async () => {
      mockQuery.mockResolvedValueOnce([[{ service_id: 'S1' }]]); // existing check

      await createService(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Service ID already exists' });
    });

    it('should successfully create service', async () => {
      mockQuery.mockResolvedValueOnce([[]]); // existing check
      mockQuery.mockResolvedValueOnce([{}]); // insert

      req.body.description = 'Desc';

      await createService(req, res);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Service created',
        data: {
          service_id: 'S1',
          owner_id: 1,
          name: 'Wash',
          price_per_kg_owner: 5000,
          price_per_kg_customer: 5750, // 5000 * 1.15
          is_active: true
        }
      });
    });

    it('should successfully create service without description', async () => {
      mockQuery.mockResolvedValueOnce([[]]); // existing check
      mockQuery.mockResolvedValueOnce([{}]); // insert

      delete req.body.description;

      await createService(req, res);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO services'),
        ['S1', 1, 'Wash', null, 5000, 5750]
      );
    });

    it('should handle db errors', async () => {
      mockQuery.mockRejectedValue(new Error('DB Error'));

      await createService(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Server error' });
    });
  });

  describe('updateService', () => {
    beforeEach(() => {
      req.user = { role: 'owner', id: 1 };
      req.params = { service_id: 'S1' };
      req.body = {
        name: 'Wash New',
        description: 'Desc New',
        is_active: false,
        price_per_kg_owner: 6000
      };
      isPositiveNumber.mockReturnValue(true);
    });

    it('should return 404 if service not found or not owned', async () => {
      mockQuery.mockResolvedValue([[]]);

      await updateService(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Service not found or not owned by you' });
    });

    it('should validate invalid price_per_kg_owner', async () => {
      mockQuery.mockResolvedValue([[{ service_id: 'S1', owner_id: 1 }]]);
      isPositiveNumber.mockReturnValue(false);

      await updateService(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'price_per_kg_owner harus lebih dari 0' });
    });

    it('should return 422 if no fields updated', async () => {
      mockQuery.mockResolvedValue([[{ service_id: 'S1', owner_id: 1 }]]);
      req.body = {};

      await updateService(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Validation error',
        errors: { body: ['Tidak ada field yang diperbarui'] }
      }));
    });

    it('should update service fields successfully', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ service_id: 'S1', owner_id: 1 }]]) // check exist
        .mockResolvedValueOnce([{}]) // update
        .mockResolvedValueOnce([[{ service_id: 'S1', name: 'Wash New' }]]); // get updated

      await updateService(req, res);

      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Service updated',
        data: { service_id: 'S1', name: 'Wash New' }
      });
    });

    it('should update is_active to 1 if true', async () => {
      req.body = { is_active: true };
      mockQuery
        .mockResolvedValueOnce([[{ service_id: 'S1', owner_id: 1 }]]) // check exist
        .mockResolvedValueOnce([{}]) // update
        .mockResolvedValueOnce([[{ service_id: 'S1', is_active: 1 }]]); // get updated

      await updateService(req, res);

      expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('is_active = ?'), [1, 'S1']);
    });

    it('should handle db errors', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));

      await updateService(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Server error' });
    });
  });

  describe('deleteService', () => {
    beforeEach(() => {
      req.user = { role: 'owner', id: 1 };
      req.params = { service_id: 'S1' };
    });

    it('should return 404 if not found or not owned', async () => {
      mockQuery.mockResolvedValue([[]]);

      await deleteService(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Service not found or not owned by you' });
    });

    it('should return already deactivated if is_active is 0', async () => {
      mockQuery.mockResolvedValue([[{ service_id: 'S1', is_active: 0 }]]);

      await deleteService(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Service already deactivated' });
      expect(mockQuery).toHaveBeenCalledTimes(1); // No update query called
    });

    it('should deactivate service successfully', async () => {
      mockQuery.mockResolvedValueOnce([[{ service_id: 'S1', is_active: 1 }]]); // check
      mockQuery.mockResolvedValueOnce([{}]); // update

      await deleteService(req, res);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(2, 'UPDATE services SET is_active = 0 WHERE service_id = ?', ['S1']);
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Service deactivated (soft delete)' });
    });

    it('should handle db errors', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));

      await deleteService(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Server error' });
    });
  });
});
