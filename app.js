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
const trackingRoutes = require('./routes/trackingRoutes');
const ratingRoutes = require('./routes/ratingRoutes');

// Gunakan Routes
app.use('/auth', authRoutes);
app.use('/services', serviceRoutes);
app.use('/orders', orderRoutes);
app.use('/payments', paymentRoutes);
app.use('/couriers', courierRoutes);
app.use('/tracking', trackingRoutes);
app.use('/ratings', ratingRoutes);

app.get('/', (req, res) => {
  res.send('API LaundryKu jalan');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server jalan di port ${PORT}`);
});