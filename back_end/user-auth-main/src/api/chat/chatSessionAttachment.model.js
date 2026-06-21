const { DataTypes, Model } = require('sequelize');
const sequelize = require('../../config/database');

class ChatSessionAttachment extends Model {}

ChatSessionAttachment.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    session_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    kind: {
      type: DataTypes.ENUM('file', 'connector_table'),
      allowNull: false,
    },
    file_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    project_id: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    table_name: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    alias: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    modelName: 'ChatSessionAttachment',
    tableName: 'chat_session_attachments',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['session_id'] },
      { fields: ['file_id'] },
      { fields: ['project_id', 'table_name'] },
    ],
    validate: {
      kindShape() {
        if (this.kind === 'file' && !this.file_id) {
          throw new Error('file attachment requires file_id');
        }
        if (this.kind === 'connector_table' && (!this.project_id || !this.table_name)) {
          throw new Error('connector_table attachment requires project_id and table_name');
        }
      },
    },
  }
);

module.exports = ChatSessionAttachment;
