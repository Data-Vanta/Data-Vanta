const { Sequelize } = require('sequelize');
require('dotenv').config();

const devConnection = process.env.DB_STRING;
const prodConnection = process.env.DB_STRING_PROD;

const connectionString = process.env.NODE_ENV === 'production' ? prodConnection : devConnection;

// Enforce Postgres usage — fail fast if DB_STRING isn't provided or isn't a Postgres URL
if (!connectionString) {
  console.error("ERROR: DB_STRING (or DB_STRING_PROD for production) is not set. Please set it to a Postgres connection string, for example: 'postgres://user:pass@host:5432/db'");
  process.exit(1);
}

if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) {
  console.error("ERROR: DB_STRING does not appear to be a Postgres URL. Please provide a Postgres connection string (postgres://...).");
  process.exit(1);
}

const sequelize = new Sequelize(connectionString, {
  dialect: 'postgres',
  logging: false
});

sequelize.authenticate()
  .then(() => console.log('Database connected'))
  .catch(err => console.error('Database connection error:', err));

module.exports = sequelize;
