const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const Video = require('../models/Video');
const { protect, authorize } = require('../middleware/auth');
const { Sequelize } = require('sequelize');

/**
 * @route   GET /api/dashboard/stats
 * @desc    Sovereign Dashboard API for Executive Summaries
 * @access  Private (Admins/Superadmins)
 */
router.get('/stats', protect, async (req, res) => {
  try {
    const role = String(req.user.role || '').toLowerCase();
    const isSuperAdmin = role === 'superadmin' || role === 'super_admin';
    const userId = req.user.id;

    // Define the ownership constraint: Superadmin sees all, Admin sees only their own
    const whereClause = isSuperAdmin ? {} : { userId };

    // 1. Recent Doctors (Top 5) - Locally Filtered with counts
    const recentDoctors = await Doctor.findAll({
      where: whereClause,
      limit: 5,
      order: [['createdAt', 'DESC']],
      attributes: [
        'id', 'name', 'city', 'designation', 'createdAt',
        [
          Sequelize.literal('(SELECT COUNT(*) FROM "videos" WHERE "videos"."doctorId" = "Doctor"."id")'),
          'videoCount'
        ]
      ]
    });

    // 2. Recent Videos (Top 5) - Locally Filtered
    const recentVideos = await Video.findAll({
      where: whereClause,
      limit: 5,
      order: [['createdAt', 'DESC']],
      include: [
        { 
          model: Doctor, 
          attributes: ['name', 'city'] 
        }
      ]
    });

    // 3. Active Doctors Count (Practitioners with at least 1 video) - Locally Filtered
    const activeDoctorsCount = await Doctor.count({
      distinct: true,
      include: [{
        model: Video,
        required: true,
        where: whereClause // Filter videos by owner
      }],
      where: whereClause // Filter doctors by owner
    });

    // 4. Portfolio Summary - Locally Filtered
    const totalDoctors = await Doctor.count({ where: whereClause });
    const totalVideos = await Video.count({ where: whereClause });

    // 5. Specialization & City Analytics (Server-side Aggregation)
    const specializations = await Doctor.findAll({
      where: whereClause,
      attributes: [
        'designation',
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
      ],
      group: ['designation'],
      order: [[Sequelize.literal('count'), 'DESC']],
      limit: 5
    });

    const cities = await Doctor.findAll({
      where: whereClause,
      attributes: [
        'city',
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
      ],
      group: ['city'],
      order: [[Sequelize.literal('count'), 'DESC']],
      limit: 5
    });

    // 6. Build Comprehensive Data Object
    const dashboardStats = {
      recentDoctors,
      recentVideos: recentVideos.map(v => {
        // Ensure the URL is absolute for the frontend to stream correctly
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const absoluteUrl = v.fileUrl.startsWith('http') ? v.fileUrl : `${baseUrl}${v.fileUrl}`;
        
        return {
          id: v.id,
          name: v.fileName,
          fileUrl: absoluteUrl,
          doctorName: v.Doctor?.name || 'Unknown',
          city: v.Doctor?.city || 'Unknown',
          uploadedAt: v.createdAt
        };
      }),
      specializationSeries: specializations.map(s => ({ label: s.designation || 'General', value: parseInt(s.get('count')) })),
      citySeries: cities.map(c => ({ label: c.city || 'Unknown', value: parseInt(c.get('count')) })),
      activeDoctorsCount,
      totalDoctors,
      totalVideos,
      portfolioStatus: totalVideos > 0 ? 'Growing' : 'Awaiting Data',
      lastUpdate: new Date(),
      viewScope: isSuperAdmin ? 'Global' : 'Personal'
    };

    res.json({
      ok: true,
      success: true,
      data: dashboardStats
    });

  } catch (error) {
    console.error('Dashboard API Error:', error);
    res.status(500).json({
      ok: false,
      success: false,
      message: 'Failed to retrieve sovereign dashboard metrics',
      error: error.message
    });
  }
});



// @route   GET /api/dashboard/super-stats
// @desc    Platform-wide executive statistics for Superadmins
router.get('/super-stats', protect, authorize('superadmin'), async (req, res) => {
  try {
    const Video = require('../models/Video');
    // Platform-wide aggregation (No userId constraint)
    const [
      totalUsers,
      totalAdmins,
      totalDoctors,
      totalVideos,
      specializations,
      cities,
      recentDoctors,
      recentVideos
    ] = await Promise.all([
      User.count(),
      User.count({ where: { role: 'admin' } }),
      Doctor.count(),
      Video.count(),
      Doctor.findAll({
        attributes: ['designation', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
        group: ['designation'],
        order: [[Sequelize.literal('count'), 'DESC']],
        limit: 5
      }),
      Doctor.findAll({
        attributes: ['city', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
        group: ['city'],
        order: [[Sequelize.literal('count'), 'DESC']],
        limit: 5
      }),
      Doctor.findAll({
        limit: 5,
        order: [['createdAt', 'DESC']],
        attributes: [
          'id', 'name', 'city', 'designation', 'createdAt',
          [Sequelize.literal('(SELECT COUNT(*) FROM "videos" WHERE "videos"."doctorId" = "Doctor"."id")'), 'videoCount']
        ]
      }),
      Video.findAll({
        limit: 5,
        order: [['createdAt', 'DESC']],
        include: [{ model: Doctor, attributes: ['name', 'city'] }]
      })
    ]);

    res.json({
      ok: true,
      success: true,
      data: {
        totalUsers,
        totalAdmins,
        totalDoctors,
        totalVideos,
        specializationSeries: specializations.map(s => ({ label: s.designation || 'General', value: parseInt(s.get('count')) })),
        citySeries: cities.map(c => ({ label: c.city || 'Unknown', value: parseInt(c.get('count')) })),
        recentDoctors,
        recentVideos: recentVideos.map(v => ({
          id: v.id,
          name: v.fileName,
          fileUrl: v.fileUrl.startsWith('http') ? v.fileUrl : `${process.env.BASE_URL || 'http://localhost:3000'}${v.fileUrl}`,
          doctorName: v.Doctor?.name || 'Unknown',
          city: v.Doctor?.city || 'Unknown',
          uploadedAt: v.createdAt
        }))
      }
    });
  } catch (error) {
    console.error('Super Stats API Error:', error);
    res.status(500).json({ ok: false, success: false, message: 'Platform intelligence stream failed.' });
  }
});

/**
 * @route   GET /api/dashboard/admin-report
 * @desc    Admin-scoped Excel Audit for all their doctors (Date-Filtered Base64)
 * @access  Private (Admins)
 */
router.get('/admin-report', protect, async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    // Filter videos by the specific Admin's ownership
    const whereClause = { userId };
    if (startDate && endDate) {
      whereClause.createdAt = {
        [Sequelize.Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }

    const videos = await Video.findAll({
      where: whereClause,
      include: [
        { 
          model: Doctor, 
          attributes: ['name', 'city', 'designation'],
        },
        {
          model: User,
          attributes: ['name', 'email', 'employerId']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Admin Personnel Audit');

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

    worksheet.getRow(1).font = { bold: true };

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    videos.forEach(v => {
      const absoluteUrl = v.fileUrl.startsWith('http') ? v.fileUrl : `${baseUrl}${v.fileUrl}`;
      const row = worksheet.addRow({
        adminName: v.User?.name || 'System',
        adminEmail: v.User?.email || 'N/A',
        adminEmpId: v.User?.employerId || 'N/A',
        drName: v.Doctor?.name || 'Unknown',
        city: v.Doctor?.city || 'Unknown',
        designation: v.Doctor?.designation || 'Unknown',
        fileName: v.fileName,
        sizeMb: (v.fileSize / (1024 * 1024)).toFixed(2),
        uploadDate: new Date(v.createdAt).toLocaleString()
      });

      // Transform filename into a clickable blue link
      const cell = row.getCell('fileName');
      cell.value = { text: v.fileName, hyperlink: absoluteUrl };
      cell.font = { color: { argb: 'FF0000FF' }, underline: true };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = buffer.toString('base64');

    res.json({
      ok: true,
      success: true,
      message: 'Admin audit synthesized successfully',
      base64,
      fileName: `Admin_Audit_${startDate || 'start'}_to_${endDate || 'end'}.xlsx`
    });
  } catch (error) {
    console.error('Admin Report API Error:', error);
    res.status(500).json({ ok: false, success: false, message: 'Admin audit failed.' });
  }
});

/**
 * @route   GET /api/dashboard/super-report
 * @desc    High-Performance Platform-Wide Excel Audit (Date-Filtered Base64)
 * @access  Private (Superadmin Only)
 */
router.get('/super-report', protect, authorize('superadmin'), async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const { startDate, endDate } = req.query;

    const whereClause = {};
    if (startDate && endDate) {
      whereClause.createdAt = {
        [Sequelize.Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }

    const videos = await Video.findAll({
      where: whereClause,
      include: [
        { 
          model: Doctor, 
          attributes: ['name', 'city', 'designation', 'userId'],
          include: [{ model: User, attributes: ['name', 'email', 'employerId'] }]
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Global Platform Audit');

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

    worksheet.getRow(1).font = { bold: true };

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    videos.forEach(v => {
      const absoluteUrl = v.fileUrl.startsWith('http') ? v.fileUrl : `${baseUrl}${v.fileUrl}`;
      const row = worksheet.addRow({
        adminName: v.Doctor?.User?.name || 'System',
        adminEmail: v.Doctor?.User?.email || 'N/A',
        adminEmpId: v.Doctor?.User?.employerId || 'N/A',
        drName: v.Doctor?.name || 'Unknown',
        city: v.Doctor?.city || 'Unknown',
        designation: v.Doctor?.designation || 'Unknown',
        fileName: v.fileName,
        sizeMb: (v.fileSize / (1024 * 1024)).toFixed(2),
        uploadDate: new Date(v.createdAt).toLocaleString()
      });

      // Transform filename into a clickable blue link
      const cell = row.getCell('fileName');
      cell.value = { text: v.fileName, hyperlink: absoluteUrl };
      cell.font = { color: { argb: 'FF0000FF' }, underline: true };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = buffer.toString('base64');

    res.json({
      ok: true,
      success: true,
      message: 'Platform audit synthesized successfully',
      base64,
      fileName: `Global_Audit_${startDate || 'start'}_to_${endDate || 'end'}.xlsx`
    });
  } catch (error) {
    console.error('Super Report API Error:', error);
    res.status(500).json({ ok: false, success: false, message: 'Platform audit failed.' });
  }
});

module.exports = router;
