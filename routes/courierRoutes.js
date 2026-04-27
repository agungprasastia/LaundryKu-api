const express = require('express');
const router = express.Router();
const courierController = require('../controllers/courierController');
const { authenticate, authorize } = require('../middleware/auth');

// Assign kurir ke order (misal oleh admin)
router.post('/assign', authenticate, authorize(['admin', 'owner']), courierController.assignCourier);

// Kurir update lokasi
router.post('/location', authenticate, authorize('courier'), courierController.updateLocation);

module.exports = router;
