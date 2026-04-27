const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

// Customer membuat inisiasi pembayaran
router.post('/', authenticate, paymentController.createPayment);

// Endpoint callback (umumnya tidak pakai auth login biasa, tapi pakai signature verifikasi dari Payment Gateway)
// Untuk simulasi ini kita biarkan tanpa auth khusus
router.post('/callback', paymentController.paymentCallback);

module.exports = router;
