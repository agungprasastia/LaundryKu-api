const express = require('express');
const router = express.Router();
const courierController = require('../controllers/courierController');
const { authenticate } = require('../middleware/auth');

// Melihat tracking order (Customer bisa melihat ini)
router.get('/:order_id', authenticate, courierController.getTracking);

module.exports = router;
