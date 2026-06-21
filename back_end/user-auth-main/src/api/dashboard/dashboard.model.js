const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

/**
 * A dashboard is a saved layout of widgets (charts, big numbers,
 * markdown notes). Pin any chat-generated chart into a dashboard to
 * keep a living snapshot that refreshes on demand.
 */
const Dashboard = sequelize.define('Dashboard', {
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
    teamId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'team_id',
    },
    name: {
        type: DataTypes.STRING(200),
        allowNull: false,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // 'private' (owner only), 'team' (owner's team), 'public-link' (anyone with signed token).
    visibility: {
        type: DataTypes.ENUM('private', 'team', 'public-link'),
        allowNull: false,
        defaultValue: 'private',
    },
    // Short random token used to generate shareable read-only links when
    // visibility === 'public-link'. Null otherwise.
    shareToken: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'share_token',
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
    tableName: 'dashboards',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { fields: ['user_id'] },
        { fields: ['team_id'] },
        { fields: ['share_token'], unique: true, where: { share_token: { [require('sequelize').Op.ne]: null } } },
    ],
});

const DashboardWidget = sequelize.define('DashboardWidget', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    dashboardId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'dashboard_id',
    },
    // chart | big-number | table | markdown | filter
    type: {
        type: DataTypes.STRING(32),
        allowNull: false,
    },
    // Shape depends on type. For a chart: {chartSpec, queryRef?, title?, subtitle?}
    // For markdown: {content}. For big-number: {value, label, trend?}.
    config: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
    },
    // 12-col CSS-grid coordinates.
    gridX: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'grid_x' },
    gridY: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'grid_y' },
    gridW: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 6, field: 'grid_w' },
    gridH: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 4, field: 'grid_h' },
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
    tableName: 'dashboard_widgets',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [{ fields: ['dashboard_id'] }],
});

Dashboard.hasMany(DashboardWidget, { as: 'widgets', foreignKey: 'dashboard_id', onDelete: 'CASCADE' });
DashboardWidget.belongsTo(Dashboard, { as: 'dashboard', foreignKey: 'dashboard_id' });

module.exports = { Dashboard, DashboardWidget };
