const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const multer = require('multer');
const ExcelJS = require('exceljs');
const upload = multer({ storage: multer.memoryStorage() });

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @route   POST /emc/login/
router.post(['/login', '/login/'], async (req, res) => {
  const { employerId, password } = req.body;
  const targetId = employerId || req.body.employer_id || req.body.email || req.body.email_id;

  try {
    const user = await User.findOne({
      where: {
        [require('sequelize').Op.or]: [
          { employerId: targetId },
          { email: targetId }
        ]
      }
    });

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
          employerId: user.employerId,
          designation: user.designation,
          mobile: user.mobile,
          role: user.role,
        },
      });
    } else {
      res.status(401).json({ ok: false, success: false, message: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   POST /emc/creatadmin/ (Register)
router.post(['/creatadmin', '/register'], async (req, res) => {
  const { name, email, email_id, password, designation, mobile, contact, role, employerId } = req.body;
  const targetEmail = email || email_id;
  const targetEmployerId = employerId || req.body.employer_id;

  try {
    const userExists = await User.findOne({
      where: {
        [require('sequelize').Op.or]: [
          { email: targetEmail },
          { employerId: targetEmployerId }
        ]
      }
    });

    if (userExists) {
      return res.status(400).json({ ok: false, success: false, message: 'User or Employer ID already exists' });
    }

    const userCount = await User.count();
    const assignedRole = userCount === 0 ? 'superadmin' : (role || 'user');

    const user = await User.create({
      name: name || req.body.userName,
      email: targetEmail,
      employerId: targetEmployerId,
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
          doctor.mobile = mobile || contact || doctor.mobile;
          await doctor.save();
        }
      }

      if (!doctor) {
        doctor = await Doctor.create({
          name: name || req.body.userName || '',
          email: targetEmail,
          designation: designation || '',
          city: city || req.body.city || '',
          mobile: mobile || contact || '',
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

    const userExists = await User.findOne({
      where: {
        [require('sequelize').Op.or]: [
          { email: targetEmail },
          { employerId: req.body.employerId || req.body.employer_id }
        ]
      }
    });
    if (userExists) {
      return res.status(400).json({ ok: false, success: false, message: 'User or Employer ID already exists' });
    }

    const user = await User.create({
      name: name || req.body.userName,
      email: targetEmail,
      employerId: req.body.employerId || req.body.employer_id,
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
  const { userId, id, name, email, email_id, password, designation, mobile, contact, employerId } = req.body;
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
    user.employerId = employerId || req.body.employer_id || user.employerId;
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

    const page = parseInt(req.query.page) || parseInt(req.body.page) || 1;
    const limit = parseInt(req.query.limit) || parseInt(req.body.limit) || 10
    const offset = (page - 1) * limit;

    if (isPowerUser) {
      const { count, rows: users } = await User.findAndCountAll({
        attributes: { exclude: ['password'] },
        limit,
        offset,
        order: [['createdAt', 'DESC']]
      });
      res.json({
        ok: true,
        success: true,
        data: users,
        totalUsers: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        limit
      });
    } else {
      res.json({
        ok: true,
        success: true,
        data: [req.user],
        totalUsers: 1,
        totalPages: 1,
        currentPage: 1
      });
    }
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   POST /emc/bulk-admin-upload/
router.post(['/bulk-admin-upload', '/bulk-admin-upload/'], protect, authorize('superadmin'), upload.single('file'), async (req, res) => {
  let buffer;

  if (req.file) {
    buffer = req.file.buffer;
  } else if (req.body.base64) {
    // Handle Base64 from Postman JSON body (including data URI prefixes)
    let base64Data = req.body.base64;
    if (base64Data.includes('base64,')) {
      base64Data = base64Data.split('base64,')[1];
    }
    buffer = Buffer.from(base64Data, 'base64');
  }

  if (!buffer) {
    return res.status(400).json({ ok: false, success: false, message: 'Please upload an excel file or provide base64 data' });
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet(1); // Get first sheet

    const users = [];
    const errors = [];

    // Skip header row
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      // Extract and trim values safely
      const name = String(row.getCell(1).value || row.getCell(1).text || '').trim();
      const email = String(row.getCell(2).value || row.getCell(2).text || '').trim();
      const employerId = String(row.getCell(3).value || row.getCell(3).text || '').trim();
      const designation = String(row.getCell(4).value || row.getCell(4).text || 'Admin').trim();
      const mobile = String(row.getCell(5).value || row.getCell(5).text || '').trim();

      // Silently skip completely empty rows (common in Excel)
      if (!name && !email && !employerId) return;

      if (!name || !email || !employerId) {
        errors.push(`Row ${rowNumber}: Name, Email, and Employer ID are required.`);
        return;
      }

      users.push({
        name,
        email,
        employerId,
        password: employerId, // Password is same as employerId
        designation,
        mobile,
        role: 'admin',
        rowNumber // Track for logs
      });
    });

    const results = {
      created: 0,
      skipped: 0,
      details: []
    };

    for (const userData of users) {
      const existing = await User.findOne({
        where: {
          [require('sequelize').Op.or]: [
            { email: userData.email },
            { employerId: userData.employerId }
          ]
        }
      });

      if (existing) {
        results.skipped++;
        results.details.push(`Excel Row ${userData.rowNumber} (${userData.name}): Skip (Email/ID already in system)`);
        continue;
      }

      await User.create(userData);
      results.created++;
      results.details.push(`Excel Row ${userData.rowNumber} (${userData.name}): Successfully Created`);
    }

    res.json({
      ok: true,
      success: true,
      message: `Processed ${users.length} records.`,
      results,
      errors
    });

  } catch (error) {
    console.error('Bulk Upload Error:', error);
    res.status(500).json({ ok: false, success: false, message: 'Error processing excel file: ' + error.message });
  }
});

module.exports = router;
