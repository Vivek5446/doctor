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
          rmName: user.rmName,
          gmName: user.gmName,
          bdmName: user.bdmName,
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
  const { name, email, email_id, password, designation, mobile, contact, role, employerId, rmName, gmName, bdmName } = req.body;
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
      rmName: rmName || req.body.rm_name || '',
      gmName: gmName || req.body.gm_name || '',
      bdmName: bdmName || req.body.bdm_name || '',
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
        rmName: user.rmName,
        gmName: user.gmName,
        bdmName: user.bdmName,
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   POST /emc/createuser/ (Superadmin/Admin creates user or doctor)
router.post(['/createuser', '/createuser/'], protect, async (req, res) => {
  const { name, email, email_id, password, designation, mobile, contact, role, city, rmName, gmName, bdmName } = req.body;
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
      rmName: rmName || req.body.rm_name || '',
      gmName: gmName || req.body.gm_name || '',
      bdmName: bdmName || req.body.bdm_name || '',
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
  const { userId, id, name, email, email_id, password, designation, mobile, contact, employerId, rmName, gmName, bdmName } = req.body;
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
    user.rmName = rmName || req.body.rm_name || user.rmName;
    user.gmName = gmName || req.body.gm_name || user.gmName;
    user.bdmName = bdmName || req.body.bdm_name || user.bdmName;

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
    const worksheet = workbook.getWorksheet(1);

    const users = [];
    const errors = [];

    // 1. Map columns based on first row headers
    const colMap = {};
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      const val = String(cell.value || '').toLowerCase().trim();
      console.log(`Column ${colNumber} header: "${val}"`);
      
      if (val === 'name') colMap.name = colNumber;
      else if (val.includes('email')) colMap.email = colNumber;
      else if (val.includes('code') || val.includes('employer')) colMap.employerId = colNumber;
      else if (val.includes('rm name')) colMap.rmName = colNumber;
      else if (val.includes('zm name') || val.includes('gm name')) colMap.gmName = colNumber;
      else if (val.includes('bdm name')) colMap.bdmName = colNumber;
      else if (val.includes('designation')) colMap.designation = colNumber;
      else if (val.includes('hq') || val.includes('city')) colMap.city = colNumber;
    });

    console.log('Final Detected Column Map:', colMap);

    const getVal = (row, colIndex) => {
      if (!colIndex) return '';
      const cell = row.getCell(colIndex);
      if (cell.value && typeof cell.value === 'object' && cell.value.text) return String(cell.value.text).trim();
      return String(cell.value || cell.text || '').trim();
    };

    // 2. Process data rows
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const employerId = getVal(row, colMap.employerId);
      const name = getVal(row, colMap.name);
      const email = getVal(row, colMap.email);
      const designation = getVal(row, colMap.designation);
      const city = getVal(row, colMap.city);
      const rmName = getVal(row, colMap.rmName);
      const gmName = getVal(row, colMap.gmName);
      const bdmName = getVal(row, colMap.bdmName);

      // Silently skip completely empty rows
      if (!name && !email && !employerId) return;

      if (!name || !email || !employerId) {
        errors.push(`Row ${rowNumber}: Name, Email, and Employee Code are required.`);
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        errors.push(`Row ${rowNumber}: Invalid email format ("${email}") for user "${name}".`);
        return;
      }

      users.push({
        name,
        email: email.toLowerCase(),
        employerId,
        designation,
        mobile: '',
        city,
        rmName,
        gmName,
        bdmName,
        role: 'admin',
        rowNumber,
        password: employerId || 'Admin@123'
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
