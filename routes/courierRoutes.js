const express = require('express');
const router = express.Router();
const courierController = require('../controllers/courierController');
const { authenticate, authorize } = require('../middleware/auth');

// Kurir update lokasi (PATCH sesuai spec)
router.patch('/me/location', authenticate, authorize('courier'), courierController.updateLocation);

// Kurir lihat daftar tugas aktif
router.get('/me/tasks/history', authenticate, authorize('courier'), courierController.getTaskHistory);
router.get('/me/tasks', authenticate, authorize('courier'), courierController.getTasks);

module.exports = router;
