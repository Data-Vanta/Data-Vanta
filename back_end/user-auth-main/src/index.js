const app = require('./app');
const { sequelize } = require('./db');
const port = process.env.PORT || 3000;

// Handle uncaught exceptions and rejections
process.on('unhandledRejection', (err) => {
  console.log(`Logged Error: ${err}`);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.log(`Logged Error: ${err}`);
  process.exit(1);
});

// Ensure all model files are loaded so associations are registered before sync
// load role/permission join model which sets up belongsToMany associations
require('./api/role/rolePermission.model');
// Load the UserMemory model so sequelize.sync creates/alters the table.
require('./api/memory/memory.model');
require('./api/table-metadata/tableMetadata.model');
require('./api/dashboard/dashboard.model');
require('./api/notification/notification.model');
require('./api/connector/connector.model');
require('./api/chat/chat.model');
require('./api/chat/chatSessionAttachment.model');

// Sync database and start server
// alter:true is safe for dev but disabled in production to prevent schema drift
const syncOptions = process.env.NODE_ENV === 'production' ? {} : { alter: true };
sequelize.sync(syncOptions)
  .then(() => {
    console.log('Database, tables, and associations synced');
    app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
    });
  })
  .catch(err => console.error('Sync error:', err));