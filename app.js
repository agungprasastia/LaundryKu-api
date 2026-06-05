const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Import Routes
const authRoutes = require('./routes/authRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const courierRoutes = require('./routes/courierRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const walletRoutes = require('./routes/walletRoutes');
const adminRoutes = require('./routes/adminRoutes');
const ownerRoutes = require('./routes/ownerRoutes');

// Gunakan Routes
app.use('/auth', authRoutes);
app.use('/services', serviceRoutes);
app.use('/orders', orderRoutes);
app.use('/payments', paymentRoutes);
app.use('/couriers', courierRoutes);
app.use('/notifications', notificationRoutes);
app.use('/wallets', walletRoutes);
app.use('/admin', adminRoutes);
app.use('/owner', ownerRoutes);

app.get('/', (req, res) => {
  res.json({ success: true, message: 'API LaundryKu berjalan' });
});

// ============================================
// Global Error Handler
// Menangkap error yang tidak tertangani di controller
// Jangan bocorkan detail error SQL ke client
// ============================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server jalan di port ${PORT}`);
});