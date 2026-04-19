const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');
const Doctor = require('./Doctor');

const Video = sequelize.define('Video', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  fileUrl: {
    type: DataTypes.TEXT, // Using TEXT for long URLs
    allowNull: false,
  },
  fileSize: {
    type: DataTypes.BIGINT, // Bytes
    allowNull: true,
  },
  key: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  doctorId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'doctors',
      key: 'id',
    },
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id',
    },
  },
}, {
  timestamps: true,
  tableName: 'videos',
  freezeTableName: true,
});

// Relationships
Doctor.hasMany(Video, { foreignKey: 'doctorId', onDelete: 'CASCADE' });
Video.belongsTo(Doctor, { foreignKey: 'doctorId' });

User.hasMany(Video, { foreignKey: 'userId', onDelete: 'CASCADE' });
Video.belongsTo(User, { foreignKey: 'userId' });

module.exports = Video;
