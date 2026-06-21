const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const AnalysisResult = sequelize.define('AnalysisResult', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  fileId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  summaryStatistics: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  missingValues: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  uniqueValues: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'PENDING' // PENDING, COMPLETED, FAILED
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  timestamps: true,
  tableName: 'AnalysisResults' // Explicitly name the table
});

// Define associations
AnalysisResult.associate = function(models) {
  AnalysisResult.belongsTo(models.File, { foreignKey: 'fileId' });
};


module.exports = AnalysisResult;