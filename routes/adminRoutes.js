const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/dashboard/metrics', authenticate, authorize('admin'), adminController.getDashboardMetrics);
router.patch('/users/:user_id/verify', authenticate, authorize('admin'), adminController.verifyUser);
router.get('/wallets/me', authenticate, authorize('admin'), adminController.getAdminWallet);
router.patch('/wallets/withdrawals/:withdraw_id/process', authenticate, authorize('admin'), adminController.processWithdraw);
router.get('/analytics', authenticate, authorize('admin'), adminController.getAnalytics);

module.exports = router;
