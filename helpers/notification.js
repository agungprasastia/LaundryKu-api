// ============================================
// Notification Helper
// Centralized function for creating notifications
// ============================================

/**
 * Create an in-app notification
 * @param {object} connOrPool - MySQL connection (transaction) or pool
 * @param {number} userId - Target user ID
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 */
const createNotification = async (connOrPool, userId, title, body) => {
  await connOrPool.query(
    'INSERT INTO notifications (user_id, title, body) VALUES (?, ?, ?)',
    [userId, title, body]
  );
};

module.exports = { createNotification };
