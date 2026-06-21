require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');

async function run() {
  if (!process.env.DB_STRING) {
    console.error("ERROR: DB_STRING environment variable must be set and point to a Postgres database.");
    process.exit(1);
  }

  const token = process.env.TEST_TOKEN || '';
  const fileId = process.env.TEST_FILE_ID || '';

  if (!token || !fileId) {
    console.error('Please set TEST_TOKEN and TEST_FILE_ID environment variables (or run test:setup first).');
    process.exit(1);
  }

  const res = await request(app)
    .post(`/api/v1/process/${fileId}/rollback`)
    .set('x-auth-token', token)
    .send();

  console.log('ROLLBACK_RESPONSE');
  console.log(JSON.stringify(res.body, null, 2));
  process.exit(0);
}

run().catch(err => {
  console.error('Error running rollback:', err);
  process.exit(1);
});