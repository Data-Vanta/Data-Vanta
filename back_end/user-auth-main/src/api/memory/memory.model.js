const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

/**
 * Long-term user memory — when enabled, prepended to every chat session's
 * system prompt so the assistant remembers business context, preferred
 * terminology, etc. between chats.
 *
 * Rows are opt-in (the user explicitly adds them from Settings); nothing
 * is captured automatically.
 */
const UserMemory = sequelize.define('UserMemory', {
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
    content: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
    },
    updatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
    },
}, {
    tableName: 'user_memories',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [{ fields: ['user_id'] }],
});

module.exports = { UserMemory };
