const express = require('express');
const router = express.Router();
const ownerController = require('../controllers/ownerController');
const { authenticate, authorize, requireVerifiedAccount } = require('../middleware/auth');

router.get('/orders', authenticate, authorize('owner'), requireVerifiedAccount, ownerController.getOwnerOrders);
router.get('/reports/summary', authenticate, authorize('owner'), requireVerifiedAccount, ownerController.getReportSummary);

module.exports = router;
