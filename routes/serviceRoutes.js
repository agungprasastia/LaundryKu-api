const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');
const { authenticate, authorize } = require('../middleware/auth');

// Endpoint publik: bisa dilihat siapa saja
router.get('/', serviceController.getAllServices);
router.get('/:id', serviceController.getServiceById);

// Endpoint private: hanya owner yang bisa membuat layanan (Opsional)
router.post('/', authenticate, authorize('owner'), serviceController.createService);

module.exports = router;
