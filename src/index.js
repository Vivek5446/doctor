const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const sequelize = require('./config/database');

// Load models
require('./models/User');
require('./models/Doctor');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/emc', require('./routes/auth'));
app.use('/emc', require('./routes/doctor'));
app.use('/api/doctors', require('./routes/doctor'));
app.use('/api/dashboard', require('./routes/dashboard')); // Dedicated Executive Activity Stream

// Basic route
app.get('/', (req, res) => {
  res.send('Doctor API is running...');
});

// Sync Database & Start Server
const PORT = process.env.PORT || 3000;

const seedAdmin = async () => {
  const User = require('./models/User');
  const userCount = await User.count();
  if (userCount === 0) {
    await User.create({
      name: 'Super Admin',
      email: 'admin@example.com',
      password: 'admin123',
      role: 'superadmin',
      designation: 'System Administrator'
    });
    console.log('Default superadmin created (admin@example.com / admin123)');
  }
};

// Load All Models for Sync
require('./models/User');
require('./models/Doctor');
require('./models/Video');

sequelize.sync({ alter: true })
  .then(async () => {
    console.log('Database synced successfully.');
    await seedAdmin();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to sync database:', err);
  });
