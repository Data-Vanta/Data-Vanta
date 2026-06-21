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
  const column = process.env.TEST_COLUMN || 'age';
  const strategy = process.env.TEST_STRATEGY || 'mean';
  const fillValue = process.env.TEST_FILL_VALUE;

  if (!token || !fileId) {
    console.error('Please set TEST_TOKEN and TEST_FILE_ID environment variables (or run test:setup first).');
    process.exit(1);
  }

  const body = { column, strategy };
  if (fillValue !== undefined) body.fillValue = Number(fillValue);

  const res = await request(app)
    .post(`/api/v1/process/${fileId}/handle-missing`)
    .set('x-auth-token', token)
    .send(body);

  console.log('HANDLE_MISSING_RESPONSE');
  console.log(JSON.stringify(res.body, null, 2));
  process.exit(0);
}

run().catch(err => {
  console.error('Error running handle-missing:', err);
  process.exit(1);
});