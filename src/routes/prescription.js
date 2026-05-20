const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const Prescription = require('../models/Prescription');
const PrescriptionDoctor = require('../models/PrescriptionDoctor');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// Helper to upload image to BunnyCDN Storage Zone
const uploadToBunnyStorage = async (fileBuffer, fileName, mimeType) => {
  const storageZone = process.env.BUNNY_STORAGE_ZONE_NAME;
  const accessKey = process.env.BUNNY_STORAGE_API_KEY;
  const pullZone = process.env.BUNNY_STORAGE_PULL_ZONE || `${storageZone}.b-cdn.net`;

  console.log(storageZone, "Storage Zone");
  console.log(accessKey, "Access Key");

  if (!storageZone || !accessKey) {
    return null;
  }

  try {
    // Standard Bunny CDN Storage API PUT request
    const url = `https://storage.bunnycdn.com/${storageZone}/prescriptions/${fileName}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'AccessKey': accessKey,
        'Content-Type': mimeType || 'application/octet-stream'
      },
      body: fileBuffer
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Bunny Storage response error: ${response.status} - ${errText}`);
      return null;
    }

    return `/api/prescriptions/image/${fileName}`;
  } catch (err) {
    console.error('Failed uploading prescription to BunnyCDN Storage:', err);
    return null;
  }
};

// Helper to delete image from BunnyCDN Storage Zone
const deleteFromBunnyStorage = async (fileUrl) => {
  const storageZone = process.env.BUNNY_STORAGE_ZONE_NAME;
  const accessKey = process.env.BUNNY_STORAGE_API_KEY;

  if (!storageZone || !accessKey || !fileUrl) {
    return;
  }

  try {
    // Extract filename from URL (e.g. "https://xxx.b-cdn.net/prescriptions/prescription-xxx.jpg")
    const parts = fileUrl.split('/');
    const fileName = parts[parts.length - 1];
    if (!fileName) return;

    const url = `https://storage.bunnycdn.com/${storageZone}/prescriptions/${fileName}`;

    console.log(`Attempting to delete prescription file from Bunny CDN: ${fileName}`);

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'AccessKey': accessKey
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Bunny Storage delete response error: ${response.status} - ${errText}`);
    } else {
      console.log(`Successfully deleted file from Bunny CDN storage: ${fileName}`);
    }
  } catch (err) {
    console.error('Failed to purge file from Bunny CDN storage:', err);
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: function (req, file, cb) {
    // Only accept image extensions
    const filetypes = /jpeg|jpg|png|webp|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images are allowed (jpeg, jpg, png, webp, gif)'));
    }
  }
});

/**
 * @route   GET /api/prescriptions/image/:filename
 * @desc    Proxy image read from BunnyCDN using read-only key
 * @access  Public (Read-only proxy)
 */
router.get('/image/:filename', async (req, res) => {
  const { filename } = req.params;
  const storageZone = process.env.BUNNY_STORAGE_ZONE_NAME;
  const readKey = process.env.BUNNY_STORAGE_READ_KEY;

  if (!storageZone || !readKey) {
    return res.status(500).json({ ok: false, message: 'Storage configuration missing' });
  }

  try {
    const url = `https://storage.bunnycdn.com/${storageZone}/prescriptions/${filename}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'AccessKey': readKey
      }
    });

    if (!response.ok) {
      return res.status(response.status).send('Image not found');
    }

    const contentType = response.headers.get('content-type');
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error) {
    console.error('Error fetching image:', error);
    res.status(500).send('Error fetching image');
  }
});

/**
 * @route   GET /api/prescriptions
 * @desc    Get paginated, searchable, role-restricted list of prescription records
 * @access  Private
 */
router.get('/', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    const query = {};
    const role = String(req.user.role || '').toLowerCase();
    const isSuperAdmin = role === 'superadmin' || role === 'super_admin';

    // Strict constraint: Standard user only views their own logs
    if (!isSuperAdmin) {
      query.userId = req.user.id;
    }

    // Build the include search filter
    const docInclude = {
      model: PrescriptionDoctor,
      attributes: ['id', 'doctorName', 'uidNumber', 'areaOfPractice', 'state', 'hq1']
    };

    if (search) {
      docInclude.where = {
        [Op.or]: [
          { doctorName: { [Op.iLike]: `%${search}%` } },
          { uidNumber: { [Op.iLike]: `%${search}%` } }
        ]
      };
    }

    const includeClause = [
      docInclude,
      {
        model: User,
        attributes: ['id', 'name', 'email', 'employerId']
      }
    ];

    const { count, rows } = await Prescription.findAndCountAll({
      where: query,
      include: includeClause,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    res.json({
      ok: true,
      success: true,
      data: rows,
      total: count,
      totalPages: Math.ceil(count / limit),
      currentPage: page
    });

  } catch (error) {
    console.error('Fetch Prescriptions Error:', error);
    res.status(500).json({ ok: false, success: false, message: error.message || 'Unable to retrieve prescription metrics.' });
  }
});

/**
 * @route   POST /api/prescriptions
 * @desc    Record a new prescription with file upload, doctor alignment, and brand tracking
 * @access  Private
 */
router.post('/', protect, upload.single('image'), async (req, res) => {
  try {
    const { prescriptionDoctorId, notes, brand1, brand2, brand3 } = req.body;

    if (!prescriptionDoctorId) {
      return res.status(400).json({ ok: false, success: false, message: 'A Prescription Doctor selection is required.' });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, success: false, message: 'A physical prescription image file is required.' });
    }

    const storageZone = process.env.BUNNY_STORAGE_ZONE_NAME;
    const accessKey = process.env.BUNNY_STORAGE_API_KEY;

    if (!storageZone || !accessKey) {
      return res.status(500).json({ ok: false, success: false, message: 'Bunny CDN storage is not configured on the server.' });
    }

    // Generate a unique remote filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const fileName = 'prescription-' + uniqueSuffix + path.extname(req.file.originalname || '.jpg');

    // Upload strictly to Bunny Storage Zone
    const fileUrl = await uploadToBunnyStorage(req.file.buffer, fileName, req.file.mimetype);
    if (!fileUrl) {
      return res.status(500).json({ ok: false, success: false, message: 'Failed to upload prescription image to Bunny CDN.' });
    }

    const prescription = await Prescription.create({
      userId: req.user.id,
      prescriptionDoctorId,
      imageUrl: fileUrl,
      notes: notes || null,
      brand1: brand1 ? String(brand1).toLowerCase() : null,
      brand2: brand2 ? String(brand2).toLowerCase() : null,
      brand3: brand3 ? String(brand3).toLowerCase() : null
    });

    // Return the newly created record fully populated
    const fullRecord = await Prescription.findByPk(prescription.id, {
      include: [
        {
          model: PrescriptionDoctor,
          attributes: ['id', 'doctorName', 'uidNumber', 'areaOfPractice', 'state']
        },
        {
          model: User,
          attributes: ['id', 'name', 'email', 'employerId']
        }
      ]
    });

    res.status(201).json({
      ok: true,
      success: true,
      message: 'Prescription recorded successfully.',
      data: fullRecord
    });

  } catch (error) {
    console.error('Create Prescription Error:', error);
    res.status(500).json({ ok: false, success: false, message: error.message || 'Unable to record prescription.' });
  }
});

/**
 * @route   DELETE /api/prescriptions/:id
 * @desc    Purge a prescription record and delete its static image file
 * @access  Private
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    const role = String(req.user.role || '').toLowerCase();
    const isSuperAdmin = role === 'superadmin' || role === 'super_admin';

    const prescription = await Prescription.findByPk(id);
    if (!prescription) {
      return res.status(404).json({ ok: false, success: false, message: 'Prescription record not found.' });
    }

    // Role Security: Only creator or superadmin can purge
    if (!isSuperAdmin && prescription.userId !== req.user.id) {
      return res.status(403).json({ ok: false, success: false, message: 'Access denied. You can only delete your own uploads.' });
    }

    // Purge image from Bunny CDN storage
    await deleteFromBunnyStorage(prescription.imageUrl);

    await prescription.destroy();

    res.json({
      ok: true,
      success: true,
      message: 'Prescription record permanently removed.'
    });

  } catch (error) {
    console.error('Delete Prescription Error:', error);
    res.status(500).json({ ok: false, success: false, message: error.message || 'Unable to purge prescription.' });
  }
});

/**
 * @route   GET /api/prescriptions/report
 * @desc    Generate an Excel report of prescriptions (Date-Filtered Base64)
 * @access  Private
 */
router.get('/report', protect, async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const { startDate, endDate } = req.query;
    
    const role = String(req.user.role || '').toLowerCase();
    const isSuperAdmin = role === 'superadmin' || role === 'super_admin';
    const userId = req.user.id;

    const whereClause = {};
    if (!isSuperAdmin) {
      whereClause.userId = userId;
    }

    if (startDate && endDate) {
      const { Op } = require('sequelize');
      whereClause.createdAt = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }

    const prescriptions = await Prescription.findAll({
      where: whereClause,
      include: [
        { 
          model: PrescriptionDoctor
        },
        {
          model: User,
          attributes: ['name', 'employerId']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Prescriptions Audit');

    worksheet.columns = [
      { header: 'Created By (Name)', key: 'adminName', width: 25 },
      { header: 'Created By (Employer ID)', key: 'adminEmpId', width: 20 },
      { header: 'Doctor Name', key: 'doctorName', width: 25 },
      { header: 'Doctor UID', key: 'uidNumber', width: 15 },
      { header: 'Employer ID', key: 'docEmpId', width: 15 },
      { header: 'TM Name', key: 'tmName', width: 20 },
      { header: 'HQ 1', key: 'hq1', width: 15 },
      { header: 'HQ 2', key: 'hq2', width: 15 },
      { header: 'RM Name', key: 'docRmName', width: 20 },
      { header: 'ZM Name', key: 'zmName', width: 20 },
      { header: 'BDM Name', key: 'docBdmName', width: 20 },
      { header: 'State', key: 'state', width: 15 },
      { header: 'Area of Practice', key: 'areaOfPractice', width: 20 },
      { header: 'Brand 1', key: 'brand1', width: 15 },
      { header: 'Brand 2', key: 'brand2', width: 15 },
      { header: 'Brand 3', key: 'brand3', width: 15 },
      { header: 'Clinical Notes', key: 'notes', width: 30 },
      { header: 'Image URL', key: 'imageUrl', width: 40 },
      { header: 'Date Recorded', key: 'uploadDate', width: 25 },
    ];

    worksheet.getRow(1).font = { bold: true };

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    prescriptions.forEach(p => {
      // Reconstruct full URL if using local storage or proxy
      let absoluteUrl = p.imageUrl;
      if (!p.imageUrl.startsWith('http')) {
         const filename = p.imageUrl.split('/').pop();
         absoluteUrl = `${baseUrl}/api/prescriptions/image/${filename}`;
      } else if (p.imageUrl.includes('bunnycdn')) {
         // Proxy via backend if it's the old CDN link style
         const filename = p.imageUrl.split('/').pop();
         absoluteUrl = `${baseUrl}/api/prescriptions/image/${filename}`;
      }

      const row = worksheet.addRow({
        adminName: p.User?.name || 'System',
        adminEmpId: p.User?.employerId || 'N/A',
        doctorName: p.PrescriptionDoctor?.doctorName || 'Unknown',
        uidNumber: p.PrescriptionDoctor?.uidNumber || 'N/A',
        docEmpId: p.PrescriptionDoctor?.empId || 'N/A',
        tmName: p.PrescriptionDoctor?.tmName || 'N/A',
        hq1: p.PrescriptionDoctor?.hq1 || 'N/A',
        hq2: p.PrescriptionDoctor?.hq2 || 'N/A',
        docRmName: p.PrescriptionDoctor?.rmName || 'N/A',
        zmName: p.PrescriptionDoctor?.zmName || 'N/A',
        docBdmName: p.PrescriptionDoctor?.bdmName || 'N/A',
        state: p.PrescriptionDoctor?.state || 'N/A',
        areaOfPractice: p.PrescriptionDoctor?.areaOfPractice || 'N/A',
        brand1: p.brand1 ? (p.brand1.charAt(0).toUpperCase() + p.brand1.slice(1)) : 'N/A',
        brand2: p.brand2 ? (p.brand2.charAt(0).toUpperCase() + p.brand2.slice(1)) : 'N/A',
        brand3: p.brand3 ? (p.brand3.charAt(0).toUpperCase() + p.brand3.slice(1)) : 'N/A',
        notes: p.notes || 'N/A',
        imageUrl: absoluteUrl,
        uploadDate: new Date(p.createdAt).toLocaleString()
      });

      // Transform URL into a clickable blue link
      const cell = row.getCell('imageUrl');
      cell.value = { text: 'View Image', hyperlink: absoluteUrl };
      cell.font = { color: { argb: 'FF0000FF' }, underline: true };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = buffer.toString('base64');

    res.json({
      ok: true,
      success: true,
      message: 'Prescriptions audit synthesized successfully',
      base64,
      fileName: `Prescriptions_Audit_${startDate || 'start'}_to_${endDate || 'end'}.xlsx`
    });
  } catch (error) {
    console.error('Prescriptions Report API Error:', error);
    res.status(500).json({ ok: false, success: false, message: 'Prescriptions audit failed.' });
  }
});

module.exports = router;
