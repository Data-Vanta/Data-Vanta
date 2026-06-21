const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

/**
 * In-app notification queue. Rows get created by events (upload done,
 * connector ingest complete, team invite, shared-dashboard comment)
 * and are streamed to the bell UI via GET /notifications/stream.
 */
const Notification = sequelize.define('Notification', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
    },
    // Drives icon + default route. E.g. 'upload.completed', 'upload.failed',
    // 'team.invite', 'chat.ready', 'dashboard.comment'.
    type: {
        type: DataTypes.STRING(80),
        allowNull: false,
    },
    title: {
        type: DataTypes.STRING(200),
        allowNull: false,
    },
    body: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // Arbitrary context: ids, URLs, whatever the renderer needs.
    data: {
        type: DataTypes.JSONB,
        allowNull: true,
    },
    readAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'read_at',
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
    },
}, {
    tableName: 'notifications',
    timestamps: false,
    indexes: [
        { fields: ['user_id', 'created_at'] },
        { fields: ['user_id', 'read_at'] },
    ],
});

module.exports = { Notification };
