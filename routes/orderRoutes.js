const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticate, authorize, requireVerifiedAccount } = require('../middleware/auth');

// Customer routes
router.post('/', authenticate, authorize('customer'), orderController.createOrder);
router.get('/my-orders/history', authenticate, authorize('customer'), orderController.getOrderHistory);
router.get('/my-orders', authenticate, authorize('customer'), orderController.getMyOrders);

// Detail order (customer/owner/courier/admin — authorization checked in controller)
router.get('/:order_id', authenticate, orderController.getOrderDetail);

// Tracking (customer/owner/courier/admin — authorization checked in controller)
router.get('/:order_id/tracking', authenticate, orderController.trackOrder);

// Owner routes — harus verified
router.patch('/:order_id/status', authenticate, authorize('owner'), requireVerifiedAccount, orderController.updateOrderStatus);
router.post('/:order_id/assign-courier', authenticate, authorize('owner'), requireVerifiedAccount, orderController.assignCourier);
router.patch('/:order_id/weight', authenticate, authorize('owner'), requireVerifiedAccount, orderController.inputWeight);
router.patch('/:order_id/activate-delivery', authenticate, authorize('owner'), requireVerifiedAccount, orderController.activateDelivery);

// Customer confirm complete
router.patch('/:order_id/complete', authenticate, authorize('customer'), orderController.completeOrder);

module.exports = router;
