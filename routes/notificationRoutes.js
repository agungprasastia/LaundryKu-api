const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, notificationController.getNotifications);
router.patch('/:notification_id/read', authenticate, notificationController.markAsRead);

module.exports = router;
