const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @route   POST /emc/login/
router.post(['/login', '/login/'], async (req, res) => {
  const { email_id, password } = req.body;
  const email = email_id || req.body.email;

  try {
    const user = await User.findOne({ where: { email } });

    if (user && (await user.comparePassword(password))) {
      res.json({
        ok: true,
        success: true,
        access_token: generateToken(user.id),
        token: generateToken(user.id),
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          designation: user.designation,
          mobile: user.mobile,
          role: user.role,
        },
      });
    } else {
      res.status(401).json({ ok: false, success: false, message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   POST /emc/creatadmin/ (Register)
router.post(['/creatadmin', '/register'], async (req, res) => {
  const { name, email, email_id, password, designation, mobile, contact, role } = req.body;
  const targetEmail = email || email_id;

  try {
    const userExists = await User.findOne({ where: { email: targetEmail } });

    if (userExists) {
      return res.status(400).json({ ok: false, success: false, message: 'User already exists' });
    }

    const userCount = await User.count();
    const assignedRole = userCount === 0 ? 'superadmin' : (role || 'user');

    const user = await User.create({
      name: name || req.body.userName,
      email: targetEmail,
      password,
      designation,
      mobile: mobile || contact,
      city: req.body.city || '',
      role: assignedRole,
    });

    res.status(201).json({
      ok: true,
      success: true,
      message: 'User registered successfully.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        designation: user.designation,
        mobile: user.mobile,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   POST /emc/createuser/ (Superadmin/Admin creates user or doctor)
router.post(['/createuser', '/createuser/'], protect, async (req, res) => {
  const { name, email, email_id, password, designation, mobile, contact, role, city } = req.body;
  const targetEmail = email || email_id;

  try {
    // If it's a doctor, save to Doctor table
    if (role === 'doctor') {
      const Doctor = require('../models/Doctor');
      const targetId = req.body.id || req.body.userId;
      
      let doctor;
      if (targetId) {
        // Only the creator or superadmin can update the doctor
        const query = { id: targetId };
        if (req.user.role !== 'superadmin') {
          query.userId = req.user.id;
        }
        
        doctor = await Doctor.findOne({ where: query });
        if (doctor) {
          doctor.name = name || req.body.userName || doctor.name;
          doctor.email = targetEmail || doctor.email;
          doctor.designation = designation || doctor.designation;
          doctor.city = city || req.body.city || doctor.city;
          await doctor.save();
        }
      }

      if (!doctor) {
        doctor = await Doctor.create({
          name: name || req.body.userName || '',
          email: targetEmail,
          designation: designation || '',
          city: city || req.body.city || '',
          userId: req.user.id, // Linked to current logged in user
        });
      }

      return res.status(201).json({
        ok: true,
        success: true,
        message: targetId ? 'Doctor updated successfully.' : 'Doctor created successfully.',
        doctor,
        id: doctor.id,
        userId: doctor.id
      });
    }

    // Otherwise, create a system User (Superadmin auth required for this)
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ ok: false, success: false, message: 'Only superadmin can create users' });
    }

    const userExists = await User.findOne({ where: { email: targetEmail } });
    if (userExists) {
      return res.status(400).json({ ok: false, success: false, message: 'User already exists' });
    }

    const user = await User.create({
      name: name || req.body.userName,
      email: targetEmail,
      password: password || '123456', // Default password for new users
      designation,
      mobile: mobile || contact,
      city: city || '',
      role: role || 'user',
    });

    res.status(201).json({
      ok: true,
      success: true,
      message: 'User created successfully.',
      user,
      id: user.id,
      userId: user.id
    });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   POST /emc/deleteuser/
router.post(['/deleteuser', '/deleteuser/'], protect, authorize('superadmin'), async (req, res) => {
  const { userId, id } = req.body;
  const targetId = userId || id;

  try {
    const user = await User.findByPk(targetId);
    if (!user) {
      return res.status(404).json({ ok: false, success: false, message: 'User not found' });
    }

    await user.destroy();
    res.json({ ok: true, success: true, message: 'User deleted successfully.' });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   POST /emc/updatepass/ (Update user info)
router.post(['/updatepass', '/updatepass/'], protect, async (req, res) => {
  const { userId, id, name, email, email_id, password, designation, mobile, contact } = req.body;
  const targetId = userId || id || req.user.id;
  const targetEmail = email || email_id;

  try {
    const user = await User.findByPk(targetId);
    if (!user) {
      return res.status(404).json({ ok: false, success: false, message: 'User not found' });
    }

    // Authorization check: Only self or superadmin
    if (req.user.role !== 'superadmin' && req.user.id !== targetId) {
      return res.status(403).json({ ok: false, success: false, message: 'Not authorized' });
    }

    user.name = name || user.name;
    user.email = targetEmail || user.email;
    user.designation = designation || user.designation;
    user.mobile = mobile || contact || user.mobile;
    user.city = req.body.city || user.city;
    
    if (password) {
      const salt = await require('bcryptjs').genSalt(10);
      user.password = await require('bcryptjs').hash(password, salt);
    }

    await user.save();
    res.json({ ok: true, success: true, message: 'User updated successfully.', user });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   POST /emc/me/
router.all('/me', protect, async (req, res) => {
  res.json({
    ok: true,
    success: true,
    user: req.user,
  });
});

// @route   POST /emc/getusers/
router.post(['/getusers', '/getusers/'], protect, async (req, res) => {
  try {
    const role = String(req.user.role || '').toLowerCase();
    const isPowerUser = role === 'superadmin' || role === 'super_admin' || role === 'admin';

    if (isPowerUser) {
      const users = await User.findAll({
        attributes: { exclude: ['password'] }
      });
      res.json({ ok: true, success: true, data: users });
    } else {
      res.json({ ok: true, success: true, data: [req.user] });
    }
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

module.exports = router;
