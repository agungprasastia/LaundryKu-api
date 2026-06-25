const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/dashboard/metrics', authenticate, authorize('admin'), adminController.getDashboardMetrics);
router.get('/users/pending', authenticate, authorize('admin'), adminController.getPendingUsers);
router.patch('/users/:user_id/verify', authenticate, authorize('admin'), adminController.verifyUser);
router.get('/wallets/me', authenticate, authorize('admin'), adminController.getAdminWallet);
router.get('/wallets/me/transactions', authenticate, authorize('admin'), adminController.getAdminTransactions);
router.post('/wallets/me/withdraw', authenticate, authorize('admin'), adminController.adminWithdraw);
router.get('/wallets/withdrawals/pending', authenticate, authorize('admin'), adminController.getPendingWithdrawals);
router.get('/wallets/withdrawals', authenticate, authorize('admin'), adminController.getAllWithdrawals);
router.patch('/wallets/withdrawals/:withdraw_id/process', authenticate, authorize('admin'), adminController.processWithdraw);
router.get('/orders', authenticate, authorize('admin'), adminController.getAllOrders);
router.get('/analytics', authenticate, authorize('admin'), adminController.getAnalytics);

module.exports = router;
