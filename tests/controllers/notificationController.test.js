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

const notificationController = require('../../controllers/notificationController');

describe('Notification Controller', () => {
  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    req = {
      user: { id: 1 },
      params: {},
      body: {}
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  describe('getNotifications', () => {
    it('should return 200 and list of notifications on success', async () => {
      const mockNotifications = [
        { notification_id: 1, title: 'Test', body: 'Message', is_read: 0, created_at: '2023-10-01' }
      ];
      mockQuery.mockResolvedValueOnce([mockNotifications]);

      await notificationController.getNotifications(req, res);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        [req.user.id]
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Success',
        data: mockNotifications
      });
    });

    it('should return 500 if database query fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB Error'));

      await notificationController.getNotifications(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Server error'
      });
      expect(console.error).toHaveBeenCalledWith('getNotifications error:', 'DB Error');
    });
  });

  describe('markAsRead', () => {
    beforeEach(() => {
      req.params = { notification_id: '1' };
    });

    it('should return 404 if notification not found or belongs to another user', async () => {
      mockQuery.mockResolvedValueOnce([[]]);

      await notificationController.markAsRead(req, res);

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM notifications WHERE notification_id = ? AND user_id = ?',
        ['1', 1]
      );
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Notification not found'
      });
    });

    it('should return 200 and update notification on success', async () => {
      mockQuery.mockResolvedValueOnce([[{ notification_id: 1, user_id: 1 }]]);
      mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await notificationController.markAsRead(req, res);

      expect(mockQuery).toHaveBeenNthCalledWith(1,
        'SELECT * FROM notifications WHERE notification_id = ? AND user_id = ?',
        ['1', 1]
      );
      expect(mockQuery).toHaveBeenNthCalledWith(2,
        'UPDATE notifications SET is_read = 1 WHERE notification_id = ?',
        ['1']
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Notification marked as read',
        data: { notification_id: 1, is_read: true }
      });
    });

    it('should return 500 if database query fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB Error'));

      await notificationController.markAsRead(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Server error'
      });
      expect(console.error).toHaveBeenCalledWith('markAsRead error:', 'DB Error');
    });
  });
});
