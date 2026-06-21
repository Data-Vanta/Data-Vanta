const express = require('express');
const router = express.Router();

const authRoutes = require('./auth/auth.route');
const userRoutes = require('./user/user.route');
const profileRoutes = require('./profile/profile.route');
const teamRoutes = require('./team/team.route');
const roleRoutes = require('./role/role.route');
const permissionRoutes = require('./permission/permission.route');
const fileRoutes = require('./file/file.route');
const processRoutes = require('./process/process.route');
const chatRoutes = require('./chat/chat.route');
const memoryRoutes = require('./memory/memory.route');
const tableMetadataRoutes = require('./table-metadata/tableMetadata.route');
const dashboardRoutes = require('./dashboard/dashboard.route');
const notificationRoutes = require('./notification/notification.route');
const connectorRoutes = require('./connector/connector.route');


router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/profile', profileRoutes);
router.use('/team', teamRoutes);
router.use('/role', roleRoutes);
router.use('/permission', permissionRoutes);

// ALL file-related routes will be prefixed with /file
router.use('/file', fileRoutes);

// ALL process-file-related routes will be prefixed with /process
router.use('/process', processRoutes);

// Chat/AI routes
router.use('/chat', chatRoutes);

// Long-term user memories (Phase 2b): prepended to chat system prompt
// when the user enables global memory in Settings.
router.use('/profile/memories', memoryRoutes);

// Per-user table aliases + descriptions (Phase 3). Fed into the Chart-API
// schema profile so the LLM uses business terminology.
router.use('/tables', tableMetadataRoutes);

// Dashboards + widgets (Phase 4). Users pin chat-generated charts into
// a persistent layout that they can share via signed link.
router.use('/dashboards', dashboardRoutes);

// Notifications (Phase 4). Fired by server events (upload done, team
// invite, etc.); streamed to the bell UI.
router.use('/notifications', notificationRoutes);

// External data-source connectors (Postgres/MySQL/MSSQL/Oracle/Mongo/
// BigQuery/Snowflake/Redshift). Credentials are AES-256-GCM sealed and
// never leave the backend; Chart-API runs the actual ingest.
router.use('/connectors', connectorRoutes);

module.exports = router;