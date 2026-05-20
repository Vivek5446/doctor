const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');
const PrescriptionDoctor = require('./PrescriptionDoctor');

const Prescription = sequelize.define('Prescription', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  prescriptionDoctorId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'prescription_doctors',
      key: 'id'
    }
  },
  imageUrl: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  brand1: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  brand2: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  brand3: {
    type: DataTypes.STRING,
    allowNull: true,
  }
}, {
  timestamps: true,
  tableName: 'prescriptions',
  freezeTableName: true,
});

// Relationships
User.hasMany(Prescription, { foreignKey: 'userId' });
Prescription.belongsTo(User, { foreignKey: 'userId' });

PrescriptionDoctor.hasMany(Prescription, { foreignKey: 'prescriptionDoctorId' });
Prescription.belongsTo(PrescriptionDoctor, { foreignKey: 'prescriptionDoctorId' });

module.exports = Prescription;
