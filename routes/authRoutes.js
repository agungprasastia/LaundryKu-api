const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

// Route untuk registrasi (public)
router.post('/register', authController.register);

// Route untuk login (public)
router.post('/login', authController.login);

// Route untuk logout (butuh token)
router.post('/logout', authenticate, authController.logout);

module.exports = router;
