require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const jwt = require('jsonwebtoken');
// Require a Postgres DB connection string for tests. Don't fall back to sqlite.
if (!process.env.DB_STRING) {
  console.error("ERROR: DB_STRING environment variable is not set. Please set it to a Postgres connection string (e.g. 'postgres://user:pass@host:5432/db').");
  process.exit(1);
}
// Optionally validate basic postgres prefix
if (!/^postgres(?:ql)?:\/\//i.test(process.env.DB_STRING)) {
  console.error("ERROR: DB_STRING does not look like a Postgres connection string. Please provide a valid Postgres URL (postgres://...).");
  process.exit(1);
}
const UserRepository = require('../src/api/user/user.repository');
const FileRepository = require('../src/api/file/file.repository');
const { sequelize } = require('../src/db');

async function ensureUploads() {
  const uploadsDir = path.join(__dirname, '../uploads');
  await fs.mkdir(uploadsDir, { recursive: true });
}

async function createSampleCSV(filePath) {
  const csv = `id,name,age,score\n1,Alice,30,85\n2,Bob,,92\n3,Charlie,25,\n4,David,40,73`;
  await fs.writeFile(filePath, csv, 'utf8');
}

async function run() {
  await sequelize.sync(); // ensure models are available

  // Create test user (or reuse existing)
  const email = process.env.TEST_USER_EMAIL || 'test+df@example.com';
  let user = await UserRepository.findByEmail(email);
  if (!user) {
    user = await UserRepository.create({
      email,
      password: 'password123',
      name: 'DF Test',
      role: 'User'
    });
    // Verify email so auth middleware passes
    await UserRepository.verifyEmail(user.id);
    user = await UserRepository.findByEmail(email);
  }

  // Ensure uploads and create CSV
  await ensureUploads();
  const filename = 'sample_test.csv';
  const storagePath = path.join(__dirname, '../uploads', filename);
  await createSampleCSV(storagePath);
  const stats = await fs.stat(storagePath);

  // Create file record
  const fileRecord = await FileRepository.create({
    userId: user.id,
    originalFilename: filename,
    storagePath: storagePath,
    mimetype: 'text/csv',
    sizeInBytes: stats.size
  });

  // Create JWT
  const secret = process.env.JWT_SECRET || 'test_jwt_secret';
  const token = jwt.sign({ userId: user.id }, secret, { expiresIn: '1h' });

  console.log('TEST_SETUP_RESULT');
  console.log(JSON.stringify({ token, fileId: fileRecord.id }, null, 2));
  process.exit(0);
}

run().catch(err => {
  console.error('Error creating test data:', err);
  process.exit(1);
});