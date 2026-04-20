const express = require('express');
const router = express.Router();
const Doctor = require('../models/Doctor');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const { Op, Sequelize } = require('sequelize');

// --- Sovereign Registry API (Strict: Metadata + Count ONLY) ---
router.get(['/registry', '/registry/'], protect, async (req, res) => {
  try {
    const Video = require('../models/Video');
    const role = String(req.user.role || '').toLowerCase();
    const isSuperAdmin = role === 'superadmin' || role === 'super_admin';
    const query = {};
    if (!isSuperAdmin) {
      query.userId = req.user.id;
    }

    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const { count: totalDoctorsCount, rows: doctors } = await Doctor.findAndCountAll({
      where: query,
      attributes: ['id', 'name', 'email', 'city', 'designation', 'mobile'],
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    const data = await Promise.all(doctors.map(async (doc) => {
      const rawCount = await Video.count({ where: { doctorId: doc.id } });
      const videoCount = rawCount > 0 ? 1 : 0;
      return {
        id: doc.id,
        name: doc.name,
        city: doc.city,
        email: doc.email,
        designation: doc.designation,
        mobile: doc.mobile,
        videoCount
      };
    }));

    // For totalVideos across all doctors for this user/admin, we might still want the total count
    // but maybe just pagination for the list is enough.
    // However, the original code calculated totalDoctors and totalVideos for the current list.
    // If we paginated, this might need refinement.

    // Calculate total videos for all doctors (not just current page) if needed,
    // but usually pagination is for the list view.

    res.json({
      ok: true,
      success: true,
      doctors: data,
      data,
      totalDoctors: totalDoctorsCount,
      totalPages: Math.ceil(totalDoctorsCount / limit),
      currentPage: page
    });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// --- Standard CRUD (for /api/doctors) ---

router.get('/', protect, async (req, res) => {
  try {
    const Video = require('../models/Video');
    const query = {};
    if (req.user.role !== 'superadmin' && req.user.role !== 'super_admin') {
      query.userId = req.user.id;
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const { count, rows: doctors } = await Doctor.findAndCountAll({
      where: query,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    // Simple, direct enrichment for maximum reliability
    const enriched = await Promise.all(doctors.map(async (doc) => {
      const rawCount = await Video.count({ where: { doctorId: doc.id } });
      const videoCount = rawCount > 0 ? 1 : 0;
      const d = doc.get({ plain: true });

      // Explicitly remove legacy data to keep registry clean
      delete d.videoUrl;
      delete d.videoKey;

      return { ...d, videoCount };
    }));

    res.json({
      ok: true,
      success: true,
      doctors: enriched,
      data: enriched,
      totalDoctors: count,
      totalPages: Math.ceil(count / limit),
      currentPage: page
    });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

router.post('/', protect, async (req, res) => {
  const { name, email, designation, city, mobile } = req.body;

  try {
    const doctor = await Doctor.create({
      name,
      email,
      designation,
      city,
      mobile,
      userId: req.user.id,
    });

    res.status(201).json({ ok: true, success: true, doctor });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

router.put('/:id', protect, async (req, res) => {
  const { name, email, designation, city, mobile } = req.body;

  try {
    const doctor = await Doctor.findByPk(req.params.id);
    if (!doctor) {
      return res.status(404).json({ ok: false, success: false, message: 'Doctor profile not found' });
    }

    // Role-based Ownership Check
    if (req.user.role !== 'superadmin' && req.user.role !== 'super_admin' && doctor.userId !== req.user.id) {
      return res.status(403).json({ ok: false, success: false, message: 'Unauthorized to modify this profile' });
    }

    await doctor.update({
      name: name || doctor.name,
      email: email || doctor.email,
      designation: designation || doctor.designation,
      city: city || doctor.city,
      mobile: mobile || doctor.mobile,
    });

    res.json({ ok: true, success: true, doctor });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   DELETE /api/doctors/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const query = { id: req.params.id };
    if (req.user.role !== 'superadmin' && req.user.role !== 'super_admin') {
      query.userId = req.user.id;
    }

    const doctor = await Doctor.findOne({ where: query });

    if (!doctor) {
      return res.status(404).json({ ok: false, success: false, message: 'Doctor profile not found or unauthorized' });
    }

    await doctor.destroy();
    res.json({ ok: true, success: true, message: 'Doctor profile deleted successfully' });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// --- Specialized /emc endpoints ---

// @route   POST /emc/saveuploadeddata/
router.post(['/saveuploadeddata', '/saveuploadeddata/'], protect, async (req, res) => {
  const { doctorId, id, userId, file_name, file_url, file_size, file_key } = req.body;
  // If doctorId is missing, try to find a doctor for who uploaded it (fallback)
  let targetDoctorId = doctorId || id;

  try {
    if (!targetDoctorId) {
      const doc = await Doctor.findOne({ where: { userId: userId || req.user.id } });
      targetDoctorId = doc?.id;
    }

    if (!targetDoctorId) {
      return res.status(404).json({ ok: false, success: false, message: 'Doctor profile not found' });
    }

    const Video = require('../models/Video');
    const doctor = await Doctor.findByPk(targetDoctorId);

    // Append 6-digit unique suffix for distinct file naming
    const uniqueSuffix = Math.floor(100000 + Math.random() * 900000);

    // Construct the Master Naming Pattern: doctorname_city_designation_filename_uniqueNumber.extension
    const drName = (doctor?.name || 'Unknown').trim().replace(/\s+/g, '_');
    const drCity = (doctor?.city || 'Unknown').trim().replace(/\s+/g, '_');
    const drDesig = (doctor?.designation || 'Unknown').trim().replace(/\s+/g, '_');

    // Parse the original extension and basename to inject uniqueSuffix correctly
    const path = require('path');
    const extension = path.extname(file_name || 'Video.mp4');
    const baseName = path.basename(file_name || 'Video.mp4', extension)
      .trim()
      .replace(/\s+/g, '_');

    const finalName = `${drName}_${drCity}_${drDesig}_${baseName}_${uniqueSuffix}${extension}`;

    const video = await Video.create({
      fileName: finalName,
      fileUrl: file_url,
      fileSize: file_size || 0,
      key: file_key,
      doctorId: targetDoctorId,
      userId: req.user.id,
    });

    res.json({ ok: true, success: true, message: 'Video data saved successfully', video });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   POST /emc/getuploadeddata/
router.post(['/getuploadeddata', '/getuploadeddata/'], protect, async (req, res) => {
  const { doctorId, id, userId } = req.body;
  let targetDoctorId = doctorId || id;

  try {
    if (!targetDoctorId) {
      const doc = await Doctor.findOne({ where: { userId: userId || req.user.id } });
      targetDoctorId = doc?.id;
    }

    if (!targetDoctorId) {
      return res.json({ ok: true, success: true, data: [] });
    }

    const Video = require('../models/Video');
    const videos = await Video.findAll({
      where: { doctorId: targetDoctorId },
      order: [['createdAt', 'DESC']],
      limit: 1
    });

    // Map to format frontend expects (Standardized CamelCase)
    const data = videos.map(v => ({
      id: v.id,
      name: v.fileName,
      url: v.fileUrl,
      key: v.key,
      uploadedAt: v.createdAt,
      fileSize: v.fileSize,
    }));

    res.json({ ok: true, success: true, data });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   POST /emc/report/
router.post(['/report', '/report/'], protect, async (req, res) => {
  const { startDate, endDate, doctorId, userId } = req.body;

  try {
    const Video = require('../models/Video');
    const User = require('../models/User');
    const where = {};
    if (doctorId) where.doctorId = doctorId;
    if (userId) where.userId = userId;
    if (startDate && endDate) {
      where.createdAt = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }

    const videos = await Video.findAll({
      where,
      include: [
        { model: Doctor, attributes: ['name', 'city', 'designation'] },
        { model: User, attributes: ['name'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    const data = videos.map(v => ({
      userName: v.User?.name || 'Unknown',
      drName: v.Doctor?.name || 'Unknown',
      city: v.Doctor?.city || '',
      designation: v.Doctor?.designation || '',
      file_name: v.fileName,
      file_url: v.fileUrl,
      file_size: v.fileSize,
      uploaded_at: v.createdAt,
    }));

    res.json({ ok: true, success: true, data });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   GET /emc/report/:doctorId
// @desc    Generate Doctor video report (Base64)
router.get('/report/:doctorId', protect, async (req, res) => {
  try {
    const Video = require('../models/Video');
    const ExcelJS = require('exceljs');
    const { doctorId } = req.params;

    const doctor = await Doctor.findByPk(doctorId, {
      include: [{ model: User, attributes: ['name', 'email', 'employerId'] }]
    });
    if (!doctor) {
      return res.status(404).json({ ok: false, success: false, message: 'Doctor not found' });
    }

    const videos = await Video.findAll({
      where: { doctorId },
      order: [['createdAt', 'DESC']]
    });

    // Create Sovereign Workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Doctor Video Report');

    // Define Columns
    worksheet.columns = [
      { header: 'Admin Name', key: 'adminName', width: 25 },
      { header: 'Admin Email', key: 'adminEmail', width: 25 },
      { header: 'Admin Employer ID', key: 'adminEmpId', width: 20 },
      { header: 'Doctor Name', key: 'drName', width: 25 },
      { header: 'City', key: 'city', width: 15 },
      { header: 'Specialization', key: 'designation', width: 20 },
      { header: 'Case Filename', key: 'fileName', width: 40 },
      { header: 'Volume (MB)', key: 'sizeMb', width: 15 },
      { header: 'Sync Date', key: 'uploadDate', width: 25 },
    ];

    // Styling Headers
    worksheet.getRow(1).font = { bold: true };

    // Inject Diagnostic Data
    const admin = doctor.User;
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    videos.forEach(v => {
      const absoluteUrl = v.fileUrl.startsWith('http') ? v.fileUrl : `${baseUrl}${v.fileUrl}`;
      const row = worksheet.addRow({
        adminName: admin?.name || 'System',
        adminEmail: admin?.email || 'N/A',
        adminEmpId: admin?.employerId || 'N/A',
        drName: doctor.name,
        city: doctor.city,
        designation: doctor.designation,
        fileName: v.fileName,
        sizeMb: (v.fileSize / (1024 * 1024)).toFixed(2),
        uploadDate: new Date(v.createdAt).toLocaleString()
      });

      // Transform filename into a clickable blue link
      const cell = row.getCell('fileName');
      cell.value = { text: v.fileName, hyperlink: absoluteUrl };
      cell.font = { color: { argb: 'FF0000FF' }, underline: true };
    });

    // Synthesize Base64 Buffer
    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = buffer.toString('base64');

    res.json({
      ok: true,
      success: true,
      message: 'Diagnostic report generated successfully',
      base64,
      fileName: `Report_${doctor.name || 'doctor'}_${Date.now()}.xlsx`
    });
  } catch (error) {
    console.error('Report Generation Error:', error);
    res.status(500).json({ ok: false, success: false, message: 'Report synthesis failed.' });
  }
});

module.exports = router;
