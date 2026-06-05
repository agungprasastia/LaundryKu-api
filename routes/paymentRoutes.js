const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate, authorize } = require('../middleware/auth');

// Lihat invoice (customer, owner, admin — authorization di controller)
router.get('/invoice/:invoice_id', authenticate, paymentController.getInvoice);

// Bayar invoice (customer)
router.post('/', authenticate, authorize('customer'), paymentController.createPayment);

// Payment callback (dari gateway, tanpa JWT auth — validasi via signature di controller)
router.post('/callback', paymentController.paymentCallback);

module.exports = router;
