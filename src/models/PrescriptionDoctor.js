const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');

const PrescriptionDoctor = sequelize.define('PrescriptionDoctor', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  empId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  tmName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  hq1: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  hq2: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  rmName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  zmName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  bdmName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  state: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  uidNumber: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  doctorName: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  areaOfPractice: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  timestamps: true,
  tableName: 'prescription_doctors',
  freezeTableName: true,
});

// Relationships: Map PrescriptionDoctor's empId to User's employerId without strict DB constraints
User.hasMany(PrescriptionDoctor, { foreignKey: 'empId', sourceKey: 'employerId', constraints: false });
PrescriptionDoctor.belongsTo(User, { foreignKey: 'empId', targetKey: 'employerId', constraints: false });

module.exports = PrescriptionDoctor;
