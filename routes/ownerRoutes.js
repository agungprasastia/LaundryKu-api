const express = require('express');
const router = express.Router();
const ownerController = require('../controllers/ownerController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/reports/summary', authenticate, authorize('owner'), ownerController.getReportSummary);

module.exports = router;
