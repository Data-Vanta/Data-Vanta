const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

/**
 * Per-user alias + description for a lakehouse table.
 *
 * Phase 3 — these are prepended to the Chart-API schema profile so the
 * LLM uses the user's business terminology (e.g. "Q3 sales" instead of
 * the raw table name). Each user has at most one metadata row per
 * (projectId, tableName) pair.
 */
const TableMetadata = sequelize.define('TableMetadata', {
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
    projectId: {
        type: DataTypes.STRING(120),
        allowNull: false,
        field: 'project_id',
    },
    tableName: {
        type: DataTypes.STRING(120),
        allowNull: false,
        field: 'table_name',
    },
    // User-friendly alias, e.g. "Q3 Sales".
    alias: {
        type: DataTypes.STRING(200),
        allowNull: true,
    },
    // Longer prose — what the table represents, caveats, definitions.
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // { "<column>": "<description>" } — rendered into the schema profile.
    columnDescriptions: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'column_descriptions',
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
    tableName: 'table_metadata',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { fields: ['user_id', 'project_id', 'table_name'], unique: true },
    ],
});

module.exports = { TableMetadata };
