const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { authenticate, authorize, requireVerifiedAccount } = require('../middleware/auth');

router.get('/me', authenticate, authorize(['owner', 'courier']), requireVerifiedAccount, walletController.getBalance);
router.get('/me/transactions', authenticate, authorize(['owner', 'courier']), requireVerifiedAccount, walletController.getTransactions);
router.post('/me/withdraw', authenticate, authorize(['owner', 'courier']), requireVerifiedAccount, walletController.withdraw);
router.get('/me/withdrawals', authenticate, authorize(['owner', 'courier']), requireVerifiedAccount, walletController.getWithdrawals);

module.exports = router;
