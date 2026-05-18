const pool = require('../config/db');

// ============================================
// 6.1. Ambil Semua Notifikasi
// GET /notifications
// Auth: Bearer Token (semua role)
// ============================================
exports.getNotifications = async (req, res) => {
  const user_id = req.user.id;

  try {
    const [notifications] = await pool.query(
      `SELECT notification_id, title, body, is_read, created_at 
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC`,
      [user_id]
    );

    res.json({ data: notifications });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================
// 6.2. Tandai Notifikasi Dibaca
// PATCH /notifications/:notification_id/read
// Auth: Bearer Token (semua role)
// ============================================
exports.markAsRead = async (req, res) => {
  const { notification_id } = req.params;
  const user_id = req.user.id;

  try {
    const [notifs] = await pool.query(
      'SELECT * FROM notifications WHERE notification_id = ? AND user_id = ?',
      [notification_id, user_id]
    );

    if (notifs.length === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    await pool.query('UPDATE notifications SET is_read = 1 WHERE notification_id = ?', [notification_id]);

    res.json({
      message: 'Notification marked as read',
      data: { notification_id: parseInt(notification_id), is_read: true }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
