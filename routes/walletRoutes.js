const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/me', authenticate, authorize(['owner', 'courier']), walletController.getBalance);
router.get('/me/transactions', authenticate, authorize(['owner', 'courier']), walletController.getTransactions);
router.post('/me/withdraw', authenticate, authorize(['owner', 'courier']), walletController.withdraw);
router.get('/me/withdrawals', authenticate, authorize(['owner', 'courier']), walletController.getWithdrawals);

module.exports = router;
