const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');
const { authenticate, authorize } = require('../middleware/auth');

// Semua endpoint butuh Bearer Token per spec v2
router.get('/', authenticate, serviceController.getAllServices);
router.get('/:service_id', authenticate, serviceController.getServiceById);
router.post('/', authenticate, authorize('owner'), serviceController.createService);
router.patch('/:service_id', authenticate, authorize('owner'), serviceController.updateService);
router.delete('/:service_id', authenticate, authorize('owner'), serviceController.deleteService);

module.exports = router;
