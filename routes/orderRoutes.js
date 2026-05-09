const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticate, authorize } = require('../middleware/auth');

// Customer membuat order baru
router.post('/', authenticate, authorize('customer'), orderController.createOrder);

// Customer melihat pesanan miliknya
router.get('/my-orders', authenticate, orderController.getMyOrders);

// Melihat detail order (semua role yang login)
router.get('/:id', authenticate, orderController.getOrderById);

// Owner mengubah status order
router.patch('/:order_id/status', authenticate, authorize('owner'), orderController.updateOrderStatus);

// Owner assign kurir ke order
router.post('/:order_id/assign-courier', authenticate, authorize('owner'), orderController.assignCourier);

module.exports = router;
