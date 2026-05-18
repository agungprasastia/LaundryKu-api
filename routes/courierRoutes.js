const express = require('express');
const router = express.Router();
const courierController = require('../controllers/courierController');
const { authenticate, authorize } = require('../middleware/auth');

// Update lokasi kurir
router.patch('/me/location', authenticate, authorize('courier'), courierController.updateLocation);

// Tugas aktif & riwayat (history harus sebelum /me/tasks agar tidak conflict)
router.get('/me/tasks/history', authenticate, authorize('courier'), courierController.getTaskHistory);
router.get('/me/tasks', authenticate, authorize('courier'), courierController.getTasks);

// Update status tugas kurir
router.patch('/tasks/:assignment_id/status', authenticate, authorize('courier'), courierController.updateTaskStatus);

// Laporan earnings kurir
router.get('/me/earnings', authenticate, authorize('courier'), courierController.getEarnings);

module.exports = router;
