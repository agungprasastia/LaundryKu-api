const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Route untuk registrasi
router.post('/register', authController.register);

// Route untuk login
router.post('/login', authController.login);

module.exports = router;
