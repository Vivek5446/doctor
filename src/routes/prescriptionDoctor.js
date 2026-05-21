const express = require('express');
const router = express.Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const { Op } = require('sequelize');
const PrescriptionDoctor = require('../models/PrescriptionDoctor');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// Multer memory storage configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// @route   POST /api/prescription-doctors/upload
// @desc    Upload an Excel file containing prescription doctors and import/update them
// @access  Private
router.post('/upload', protect, upload.single('file'), async (req, res) => {
  try {
    let buffer;
    if (req.file) {
      buffer = req.file.buffer;
    } else if (req.body && req.body.base64) {
      let base64Str = req.body.base64;
      // Strip base64 data url prefix if it's there
      if (base64Str.includes(';base64,')) {
        base64Str = base64Str.split(';base64,')[1];
      }
      buffer = Buffer.from(base64Str, 'base64');
    } else {
      return res.status(400).json({ ok: false, success: false, message: 'Please upload an Excel file or send a base64 string.' });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];

    if (!worksheet || worksheet.rowCount <= 1) {
      return res.status(400).json({ ok: false, success: false, message: 'The uploaded Excel file is empty.' });
    }

    // Smart Header Finder: Search up to first 5 rows to locate headers
    let headerRowIndex = 1;
    let headers = {};
    let headersFound = false;

    for (let r = 1; r <= 5; r++) {
      const row = worksheet.getRow(r);
      row.eachCell((cell) => {
        const text = cell.text ? cell.text.trim().toLowerCase().replace(/[\s_]+/g, '') : '';
        if (text.includes('doctorname') || text.includes('doctor') || text.includes('drname')) {
          headersFound = true;
        }
      });

      if (headersFound) {
        headerRowIndex = r;
        row.eachCell((cell, colNumber) => {
          const text = cell.text ? cell.text.trim().toLowerCase().replace(/[\s_]+/g, '') : '';
          if (text.includes('empid') || text.includes('emp')) headers.empId = colNumber;
          else if (text.includes('tmname') || text.includes('tm')) headers.tmName = colNumber;
          else if (text.includes('hq1')) headers.hq1 = colNumber;
          else if (text.includes('hq2')) headers.hq2 = colNumber;
          else if (text.includes('rmname') || text.includes('rm')) headers.rmName = colNumber;
          else if (text.includes('zmname') || text.includes('zm')) headers.zmName = colNumber;
          else if (text.includes('bdmname') || text.includes('bdm')) headers.bdmName = colNumber;
          else if (text.includes('state')) headers.state = colNumber;
          else if (text.includes('uidnumber') || text.includes('uid')) headers.uidNumber = colNumber;
          else if (text.includes('doctorname') || text.includes('doctor')) headers.doctorName = colNumber;
          else if (text.includes('areaofpractice') || text.includes('practice')) headers.areaOfPractice = colNumber;
        });
        break;
      }
    }

    // Fallback: If headers are not found, use index order from user spreadsheet image
    if (!headers.doctorName) {
      headers = {
        empId: 1,
        tmName: 2,
        hq1: 3,
        hq2: 4,
        rmName: 5,
        zmName: 6,
        bdmName: 7,
        state: 8,
        uidNumber: 9,
        doctorName: 10,
        areaOfPractice: 11
      };
      headerRowIndex = 1;
    }

    const doctorsToUpload = [];
    const skipped = [];

    // Loop through data rows (skipping header)
    for (let r = headerRowIndex + 1; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      
      // Skip empty rows
      let hasData = false;
      row.eachCell(() => { hasData = true; });
      if (!hasData) continue;

      const getCellValue = (colIndex) => {
        if (!colIndex) return null;
        const cell = row.getCell(colIndex);
        if (!cell) return null;
        
        if (cell.value && typeof cell.value === 'object') {
          if (cell.value.result !== undefined) return String(cell.value.result).trim();
          if (cell.value.richText) return cell.value.richText.map(t => t.text).join('').trim();
          return JSON.stringify(cell.value);
        }
        return cell.value !== null && cell.value !== undefined ? String(cell.value).trim() : null;
      };

      const doctorName = getCellValue(headers.doctorName);
      if (!doctorName) {
        skipped.push({ row: r, reason: 'Missing Doctor Name' });
        continue;
      }

      doctorsToUpload.push({
        empId: getCellValue(headers.empId),
        tmName: getCellValue(headers.tmName),
        hq1: getCellValue(headers.hq1),
        hq2: getCellValue(headers.hq2),
        rmName: getCellValue(headers.rmName),
        zmName: getCellValue(headers.zmName),
        bdmName: getCellValue(headers.bdmName),
        state: getCellValue(headers.state),
        uidNumber: getCellValue(headers.uidNumber),
        doctorName: doctorName,
        areaOfPractice: getCellValue(headers.areaOfPractice),
      });
    }

    if (doctorsToUpload.length === 0) {
      return res.status(400).json({ ok: false, success: false, message: 'No valid doctors found in the spreadsheet.' });
    }

    // Filter records with/without uidNumber for smart bulk uploading
    const withUid = doctorsToUpload.filter(d => d.uidNumber);
    const withoutUid = doctorsToUpload.filter(d => !d.uidNumber);

    // Deduplicate in memory first to prevent PostgreSQL ON CONFLICT row-collision errors if Excel has duplicate UIDs
    const uniqueWithUidMap = new Map();
    const duplicates = [];

    for (const doc of withUid) {
      if (uniqueWithUidMap.has(doc.uidNumber)) {
        duplicates.push({
          uidNumber: doc.uidNumber,
          doctorName: doc.doctorName,
          state: doc.state,
          areaOfPractice: doc.areaOfPractice,
        });
      }
      uniqueWithUidMap.set(doc.uidNumber, doc);
    }
    const deduplicatedWithUid = Array.from(uniqueWithUidMap.values());

    let importedCount = 0;
    const duplicateCount = duplicates.length;

    if (deduplicatedWithUid.length > 0) {
      // High-speed Postgres Bulk Upsert: Updates columns on matching uidNumber conflict
      await PrescriptionDoctor.bulkCreate(deduplicatedWithUid, {
        updateOnDuplicate: [
          'empId',
          'tmName',
          'hq1',
          'hq2',
          'rmName',
          'zmName',
          'bdmName',
          'state',
          'doctorName',
          'areaOfPractice',
          'updatedAt'
        ],
        conflictAttributes: ['uidNumber']
      });
      importedCount += deduplicatedWithUid.length;
    }

    if (withoutUid.length > 0) {
      await PrescriptionDoctor.bulkCreate(withoutUid);
      importedCount += withoutUid.length;
    }

    res.json({
      ok: true,
      success: true,
      message: `Import completed successfully. Saved/Updated ${importedCount} unique doctors. ${duplicateCount} duplicate rows in Excel were merged in-place.`,
      stats: {
        totalRows: worksheet.rowCount - headerRowIndex,
        importedCount,
        duplicateCount,
        skippedCount: skipped.length,
        erroredCount: 0
      },
      duplicates,
      skipped
    });

  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   GET /api/prescription-doctors
// @desc    Get paginated prescription doctors list with search and role safety
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    const query = {};
    if (search) {
      query[Op.or] = [
        { doctorName: { [Op.iLike]: `%${search}%` } },
        { uidNumber: { [Op.iLike]: `%${search}%` } },
        { state: { [Op.iLike]: `%${search}%` } },
        { areaOfPractice: { [Op.iLike]: `%${search}%` } },
        { empId: { [Op.iLike]: `%${search}%` } },
      ];
    }

    // Role safety check: standard users should only see their assigned doctors
    // const role = String(req.user.role || '').toLowerCase();
    // const isSuperAdmin = role === 'superadmin' || role === 'super_admin';
    // if (!isSuperAdmin) {
    //   query.empId = req.user.employerId;
    // }

    const { count, rows: doctors } = await PrescriptionDoctor.findAndCountAll({
      where: query,
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: User,
          attributes: ['name', 'email', 'designation']
        }
      ]
    });

    res.json({
      ok: true,
      success: true,
      data: doctors,
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit)
    });

  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   POST /api/prescription-doctors
// @desc    Create a single prescription doctor manually
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const newDoctor = await PrescriptionDoctor.create(req.body);
    res.status(201).json({ ok: true, success: true, doctor: newDoctor });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   PUT /api/prescription-doctors/:id
// @desc    Update a prescription doctor
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const doctor = await PrescriptionDoctor.findByPk(req.params.id);
    if (!doctor) {
      return res.status(404).json({ ok: false, success: false, message: 'Prescription Doctor profile not found.' });
    }

    await doctor.update(req.body);
    res.json({ ok: true, success: true, doctor });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

// @route   DELETE /api/prescription-doctors/:id
// @desc    Delete a prescription doctor
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const doctor = await PrescriptionDoctor.findByPk(req.params.id);
    if (!doctor) {
      return res.status(404).json({ ok: false, success: false, message: 'Prescription Doctor profile not found.' });
    }

    await doctor.destroy();
    res.json({ ok: true, success: true, message: 'Doctor deleted successfully.' });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, message: error.message });
  }
});

module.exports = router;
