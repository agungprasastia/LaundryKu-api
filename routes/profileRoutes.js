const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { authenticate } = require('../middleware/auth');

// Semua role yang login bisa melihat profil
router.get('/', authenticate, profileController.getProfile);

module.exports = router;
