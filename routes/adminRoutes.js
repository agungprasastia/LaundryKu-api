const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/auth');

// Admin dashboard metrics
router.get('/dashboard/metrics', authenticate, authorize('admin'), adminController.getDashboardMetrics);

module.exports = router;
