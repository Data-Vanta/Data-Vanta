const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

/**
 * A user-configured external data source (Postgres, MySQL, MongoDB, ...).
 *
 * `config_encrypted` is an AES-256-GCM ciphertext blob sealed with
 * CRED_ENCRYPTION_KEY. The plaintext is JSON shaped like
 *   { host, port, database, user, password, ... }  (per-connector-type)
 * and is never returned from the API — only the non-secret metadata
 * (id, type, name, created_at) is surfaced.
 */
const ConnectorCredential = sequelize.define('ConnectorCredential', {
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
    type: {
        type: DataTypes.STRING(32),
        allowNull: false,
    },
    name: {
        type: DataTypes.STRING(120),
        allowNull: false,
    },
    configEncrypted: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'config_encrypted',
    },
    // Last test-connection timestamp + outcome. Surfaced to the UI so
    // users know whether a saved connector still works before ingesting.
    lastTestedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_tested_at',
    },
    lastTestOk: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        field: 'last_test_ok',
    },
    lastTestMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'last_test_message',
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
    tableName: 'connector_credentials',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [{ fields: ['user_id', 'type'] }],
});

/** Public projection used everywhere that returns connector JSON. */
function toPublic(row) {
    if (!row) return null;
    const r = row.toJSON ? row.toJSON() : row;
    return {
        id: r.id,
        type: r.type,
        name: r.name,
        lastTestedAt: r.lastTestedAt || r.last_tested_at,
        lastTestOk: r.lastTestOk ?? r.last_test_ok,
        lastTestMessage: r.lastTestMessage || r.last_test_message,
        createdAt: r.createdAt || r.created_at,
        updatedAt: r.updatedAt || r.updated_at,
    };
}

module.exports = { ConnectorCredential, toPublic };
