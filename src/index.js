const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const sequelize = require('./config/database');

// Load models
require('./models/User');
require('./models/Doctor');
require('./models/PrescriptionDoctor');
require('./models/Prescription');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));



// Routes
app.use('/emc', require('./routes/auth'));
app.use('/emc', require('./routes/doctor'));
app.use('/api/doctors', require('./routes/doctor'));
app.use('/api/dashboard', require('./routes/dashboard')); // Dedicated Executive Activity Stream
app.use('/api/prescription-doctors', require('./routes/prescriptionDoctor'));
app.use('/api/prescriptions', require('./routes/prescription'));

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
      employerId: '111222',
      password: 'admin123',
      role: 'superadmin',
      designation: 'System Administrator'
    });
    console.log('Default superadmin created (ID: 111222 / admin123)');
  } else {
    // Backfill existing users who don't have an employerId
    const usersToUpdate = await User.findAll({ where: { employerId: null } });
    if (usersToUpdate.length > 0) {
      console.log(`Backfilling employerId for ${usersToUpdate.length} users...`);
      for (const user of usersToUpdate) {
        // Use email prefix as a temporary ID
        const tempId = user.email ? user.email.split('@')[0] : `user_${user.id.slice(0, 4)}`;
        await user.update({ employerId: tempId });
      }
      console.log('Backfill complete.');
    }
  }

  // Backfill existing videos who don't have a fromVideoService
  const Video = require('./models/Video');
  const videosToUpdate = await Video.findAll({ where: { fromVideoService: null } });
  if (videosToUpdate.length > 0) {
    console.log(`Backfilling fromVideoService for ${videosToUpdate.length} videos...`);
    for (const v of videosToUpdate) {
      await v.update({ fromVideoService: 'bunny' });
    }
    console.log('Video backfill complete.');
  }
};

// Load All Models for Sync
require('./models/User');
require('./models/Doctor');
require('./models/Video');
require('./models/PrescriptionDoctor');
require('./models/Prescription');

sequelize.sync({ alter: true })
  .then(async () => {
    console.log('Database synced successfully.');
    // Drop the strict foreign key constraint if it exists to allow unhindered bulk imports
    await sequelize.query('ALTER TABLE prescription_doctors DROP CONSTRAINT IF EXISTS "prescription_doctors_empId_fkey" CASCADE;').catch(() => {});
    await seedAdmin();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to sync database:', err);
  });
