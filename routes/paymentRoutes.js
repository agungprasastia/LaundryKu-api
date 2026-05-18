const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate, authorize } = require('../middleware/auth');

// Lihat invoice (customer)
router.get('/invoice/:invoice_id', authenticate, authorize('customer'), paymentController.getInvoice);

// Bayar invoice (customer)
router.post('/', authenticate, authorize('customer'), paymentController.createPayment);

// Payment callback (dari gateway, tanpa auth)
router.post('/callback', paymentController.paymentCallback);

module.exports = router;
