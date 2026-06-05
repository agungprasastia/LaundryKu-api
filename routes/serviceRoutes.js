const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');
const { authenticate, authorize, requireVerifiedAccount } = require('../middleware/auth');

// Semua endpoint butuh Bearer Token
// Customer: hanya active services
// Owner: semua service miliknya (termasuk inactive)
// Admin: semua service
router.get('/', authenticate, serviceController.getAllServices);
router.get('/:service_id', authenticate, serviceController.getServiceById);

// Owner endpoints — harus verified
router.post('/', authenticate, authorize('owner'), requireVerifiedAccount, serviceController.createService);
router.patch('/:service_id', authenticate, authorize('owner'), requireVerifiedAccount, serviceController.updateService);
router.delete('/:service_id', authenticate, authorize('owner'), requireVerifiedAccount, serviceController.deleteService);

module.exports = router;
