const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const File = sequelize.define('File', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  // NEW: Add a path for the last backup version.
  backupStoragePath: {
    type: DataTypes.STRING,
    allowNull: true // This will be null if there's no backup.
  },
  originalFilename: {
    type: DataTypes.STRING,
    allowNull: false
  },
  storagePath: {
    type: DataTypes.STRING,
    allowNull: false
  },
  mimetype: {
    type: DataTypes.STRING,
    allowNull: false
  },
  sizeInBytes: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'UPLOADED'
  }
}, {
  timestamps: true
});

File.associate = function(models) {
  // A File belongs to one User
  File.belongsTo(models.User, { foreignKey: 'userId' });

  // A File has one AnalysisResult
  File.hasOne(models.AnalysisResult, { foreignKey: 'fileId' });
};

module.exports = File;

