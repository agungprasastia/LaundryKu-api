const { mockQuery, mockGetConnection } = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authController = require('../../controllers/authController');
const { isValidEmail, isValidPassword, isValidLatLng } = require('../../helpers/validators');

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

jest.mock('bcryptjs');
jest.mock('jsonwebtoken');
jest.mock('../../helpers/validators', () => ({
  isValidEmail: jest.fn(),
  isValidPassword: jest.fn(),
  isValidLatLng: jest.fn(),
}));

describe('Auth Controller', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      body: {},
      user: {},
      token: 'some-token'
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    // Default valid mock implementations
    isValidEmail.mockReturnValue(true);
    isValidPassword.mockReturnValue(true);
    isValidLatLng.mockReturnValue(true);

    process.env.JWT_SECRET = 'test-secret';
  });

  describe('register', () => {
    it('should return 422 if full_name is missing', async () => {
      req.body = { email: 'test@test.com', password: 'password', role: 'customer' };
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Validation error',
        errors: expect.objectContaining({ full_name: ['full_name wajib diisi'] })
      }));
    });

    it('should return 422 if email is missing or invalid format', async () => {
      isValidEmail.mockReturnValue(false);
      req.body = { full_name: 'Test', password: 'password', role: 'customer' };
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.objectContaining({ email: ['Email wajib diisi'] })
      }));

      req.body.email = 'invalid-email';
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.objectContaining({ email: ['Format email tidak valid'] })
      }));
    });

    it('should return 422 if password is missing or invalid', async () => {
      isValidPassword.mockReturnValue(false);
      req.body = { full_name: 'Test', email: 'test@test.com', role: 'customer' };
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.objectContaining({ password: ['Password wajib diisi'] })
      }));

      req.body.password = '123';
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.objectContaining({ password: ['Password minimal 6 karakter'] })
      }));
    });

    it('should return 422 if role is missing', async () => {
      req.body = { full_name: 'Test', email: 'test@test.com', password: 'password' };
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.objectContaining({ role: ['Role wajib diisi'] })
      }));
    });

    it('should return 422 if lat and lng are not paired or invalid', async () => {
      req.body = { full_name: 'Test', email: 't@t.com', password: 'password', role: 'customer', lat: 10 };
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.objectContaining({ coordinates: ['lat dan lng harus dikirim berpasangan'] })
      }));

      isValidLatLng.mockReturnValue(false);
      req.body = { full_name: 'Test', email: 't@t.com', password: 'password', role: 'customer', lat: 100, lng: 200 };
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.objectContaining({ coordinates: ['lat harus -90..90, lng harus -180..180'] })
      }));
    });

    it('should return 403 if role is not allowed', async () => {
      req.body = { full_name: 'Admin', email: 'a@a.com', password: 'password', role: 'admin' };
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('should return 409 if email already registered', async () => {
      req.body = { full_name: 'Test', email: 'test@test.com', password: 'password', role: 'customer' };
      mockQuery.mockResolvedValueOnce([[{ user_id: 1 }]]); // existing user
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Email already registered' }));
    });

    it('should handle successful registration for customer', async () => {
      req.body = { full_name: 'Test', email: 'test@test.com', password: 'password', role: 'customer', address: 'addr', lat: 1, lng: 1 };
      mockQuery
        .mockResolvedValueOnce([[]]) // no existing user
        .mockResolvedValueOnce([{ insertId: 1 }]) // insert user
        .mockResolvedValueOnce([]); // insert session

      bcrypt.genSalt.mockResolvedValue('salt');
      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mockToken');

      await authController.register(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          user_id: 1,
          is_verified: true,
          access_token: 'mockToken'
        })
      }));
    });

    it('should handle successful registration for owner/courier and return verification note', async () => {
      req.body = { full_name: 'Test', email: 'test@test.com', password: 'password', role: 'owner' };
      mockQuery
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ insertId: 2 }])
        .mockResolvedValueOnce([]);

      bcrypt.genSalt.mockResolvedValue('salt');
      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mockToken');

      await authController.register(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          is_verified: false,
          verification_note: expect.any(String)
        })
      }));
    });

    it('should handle server error', async () => {
      req.body = { full_name: 'Test', email: 'test@test.com', password: 'password', role: 'customer' };
      mockQuery.mockRejectedValue(new Error('DB Error'));
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Server error' }));
    });
  });

  describe('login', () => {
    it('should return 422 if email or password missing', async () => {
      isValidEmail.mockReturnValue(false);
      req.body = {};
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.objectContaining({
          email: ['Email wajib diisi'],
          password: ['Password wajib diisi']
        })
      }));

      req.body.email = 'invalid';
      req.body.password = 'password';
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.objectContaining({ email: ['Format email tidak valid'] })
      }));
    });

    it('should return 401 if user not found', async () => {
      req.body = { email: 't@t.com', password: 'password' };
      mockQuery.mockResolvedValueOnce([[]]);
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid email or password' }));
    });

    it('should return 401 if password does not match', async () => {
      req.body = { email: 't@t.com', password: 'wrong' };
      mockQuery.mockResolvedValueOnce([[{ user_id: 1, password: 'hashedPassword' }]]);
      bcrypt.compare.mockResolvedValue(false);
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid email or password' }));
    });

    it('should handle successful login', async () => {
      req.body = { email: 't@t.com', password: 'password' };
      mockQuery
        .mockResolvedValueOnce([[{ user_id: 1, password: 'hashedPassword', full_name: 'Test', role: 'customer', is_verified: 1 }]])
        .mockResolvedValueOnce([]); // insert session
      bcrypt.compare.mockResolvedValue(true);
      jwt.sign.mockReturnValue('mockToken');

      await authController.login(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          user_id: 1,
          access_token: 'mockToken'
        })
      }));
    });

    it('should handle server error', async () => {
      req.body = { email: 't@t.com', password: 'password' };
      mockQuery.mockRejectedValue(new Error('DB Error'));
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Server error' }));
    });
  });

  describe('getProfile', () => {
    it('should return 404 if user not found', async () => {
      req.user = { id: 1 };
      mockQuery.mockResolvedValueOnce([[]]);
      await authController.getProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'User not found' }));
    });

    it('should return profile data successfully', async () => {
      req.user = { id: 1 };
      mockQuery.mockResolvedValueOnce([[{ user_id: 1, full_name: 'Test', email: 't@t.com' }]]);
      await authController.getProfile(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ user_id: 1, full_name: 'Test' })
      }));
    });

    it('should handle server error', async () => {
      req.user = { id: 1 };
      mockQuery.mockRejectedValue(new Error('DB Error'));
      await authController.getProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Server error' }));
    });
  });

  describe('editProfile', () => {
    it('should return 422 if lat and lng are not paired or invalid', async () => {
      req.user = { id: 1 };
      req.body = { lat: 10 }; // missing lng
      await authController.editProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.objectContaining({ coordinates: ['lat dan lng harus dikirim berpasangan'] })
      }));

      req.body = { lat: 100, lng: 200 };
      isValidLatLng.mockReturnValue(false);
      await authController.editProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.objectContaining({ coordinates: ['lat harus -90..90, lng harus -180..180'] })
      }));
    });

    it('should return 422 if no fields are updated', async () => {
      req.user = { id: 1 };
      req.body = {};
      await authController.editProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.objectContaining({ body: ['Tidak ada field yang diperbarui'] })
      }));
    });

    it('should successfully update and return profile', async () => {
      req.user = { id: 1 };
      req.body = { full_name: 'New Name', address: 'New Addr', vehicle_name: 'Car', vehicle_plate_number: 'B1234' };
      
      mockQuery
        .mockResolvedValueOnce([]) // update
        .mockResolvedValueOnce([[{ user_id: 1, full_name: 'New Name' }]]); // select

      await authController.editProfile(req, res);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[0][0]).toContain('UPDATE users SET full_name = ?, address = ?, vehicle_name = ?, vehicle_plate_number = ? WHERE user_id = ?');
      expect(mockQuery.mock.calls[0][1]).toEqual(['New Name', 'New Addr', 'Car', 'B1234', 1]);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ full_name: 'New Name' })
      }));
    });

    it('should successfully update with lat/lng', async () => {
      req.user = { id: 1 };
      req.body = { lat: 10, lng: 10 };
      isValidLatLng.mockReturnValue(true);
      
      mockQuery
        .mockResolvedValueOnce([]) // update
        .mockResolvedValueOnce([[{ user_id: 1, lat: 10, lng: 10 }]]); // select

      await authController.editProfile(req, res);

      expect(mockQuery.mock.calls[0][0]).toContain('UPDATE users SET lat = ?, lng = ? WHERE user_id = ?');
      expect(mockQuery.mock.calls[0][1]).toEqual([10, 10, 1]);
    });

    it('should handle server error', async () => {
      req.user = { id: 1 };
      req.body = { full_name: 'New Name' };
      mockQuery.mockRejectedValue(new Error('DB Error'));
      await authController.editProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Server error' }));
    });
  });

  describe('logout', () => {
    it('should successfully logout', async () => {
      req.user = { id: 1 };
      req.token = 'some-token';
      mockQuery.mockResolvedValueOnce([]);

      await authController.logout(req, res);
      expect(mockQuery).toHaveBeenCalledWith('DELETE FROM sessions WHERE user_id = ? AND token = ?', [1, 'some-token']);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Logout success' }));
    });

    it('should handle server error', async () => {
      req.user = { id: 1 };
      req.token = 'some-token';
      mockQuery.mockRejectedValue(new Error('DB Error'));

      await authController.logout(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Server error' }));
    });
  });
});
