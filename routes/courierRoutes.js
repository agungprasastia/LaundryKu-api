const express = require('express');
const router = express.Router();
const courierController = require('../controllers/courierController');
const { authenticate, authorize, requireVerifiedAccount } = require('../middleware/auth');

// Courier tersedia (untuk owner/admin saat assign)
router.get('/available', authenticate, authorize(['owner', 'admin']), courierController.getAvailableCouriers);

// Update lokasi kurir — harus verified
router.patch('/me/location', authenticate, authorize('courier'), requireVerifiedAccount, courierController.updateLocation);

// Tugas aktif & riwayat — harus verified (history harus sebelum /me/tasks agar tidak conflict)
router.get('/me/tasks/history', authenticate, authorize('courier'), requireVerifiedAccount, courierController.getTaskHistory);
router.get('/me/tasks', authenticate, authorize('courier'), requireVerifiedAccount, courierController.getTasks);

// Update status tugas kurir — harus verified
router.patch('/tasks/:assignment_id/status', authenticate, authorize('courier'), requireVerifiedAccount, courierController.updateTaskStatus);

// Laporan earnings kurir — harus verified
router.get('/me/earnings', authenticate, authorize('courier'), requireVerifiedAccount, courierController.getEarnings);

module.exports = router;
