const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticate, authorize } = require('../middleware/auth');

// Hanya customer yang bisa membuat order
router.post('/', authenticate, authorize('customer'), orderController.createOrder);

// Siapa saja yang login bisa melihat order (di real app, mungkin butuh pengecekan agar customer hanya lihat ordernya sendiri)
router.get('/:id', authenticate, orderController.getOrderById);

module.exports = router;
