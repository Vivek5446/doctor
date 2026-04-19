const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');

const Doctor = sequelize.define('Doctor', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      isEmail: true,
    },
  },
  designation: {
    type: DataTypes.STRING,
  },
  city: {
    type: DataTypes.STRING,
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
  tableName: 'doctors',
  freezeTableName: true,
});

User.hasMany(Doctor, { foreignKey: 'userId', onDelete: 'CASCADE' });
Doctor.belongsTo(User, { foreignKey: 'userId' });

module.exports = Doctor;
