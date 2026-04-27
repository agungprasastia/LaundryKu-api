const express = require('express');
const router = express.Router();
const ratingController = require('../controllers/ratingController');
const { authenticate, authorize } = require('../middleware/auth');

// Hanya customer yang bisa memberikan rating
router.post('/', authenticate, authorize('customer'), ratingController.createRating);

module.exports = router;
