const { spawn } = require('child_process');

function runCommand(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env: { ...process.env, ...env }, shell: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); process.stdout.write(d); });
    proc.stderr.on('data', d => { stderr += d.toString(); process.stderr.write(d); });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`Command ${cmd} ${args.join(' ')} exited with ${code}\n${stderr}`));
      resolve(stdout);
    });
  });
}

(async () => {
  try {
    if (!process.env.DB_STRING) throw new Error('DB_STRING environment variable must be set and point to a Postgres database.');

    console.log('Running test setup...');
    const setupOut = await runCommand('node', ['scripts/setup-test-data.js'], { DB_STRING: process.env.DB_STRING, JWT_SECRET: process.env.JWT_SECRET || 'test_jwt_secret' });
    const marker = 'TEST_SETUP_RESULT';
    const idx = setupOut.indexOf(marker);
    if (idx === -1) throw new Error('Setup script did not print TEST_SETUP_RESULT');
    const jsonPart = setupOut.slice(idx + marker.length).trim();
    const firstBrace = jsonPart.indexOf('{');
    const lastBrace = jsonPart.lastIndexOf('}');
    const jsonRaw = jsonPart.substring(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonRaw);
    const token = parsed.token;
    const fileId = parsed.fileId;
    if (!token || !fileId) throw new Error('Could not extract token/fileId from setup output');

    const commonEnv = { TEST_TOKEN: token, TEST_FILE_ID: fileId, JWT_SECRET: process.env.JWT_SECRET || 'test_jwt_secret', DB_STRING: process.env.DB_STRING };

    console.log('\nRunning analyze...');
    await runCommand('node', ['scripts/run-analyze.js'], commonEnv);

    console.log('\nRunning normalize...');
    await runCommand('node', ['scripts/run-normalize.js'], commonEnv);

    console.log('\nRunning handle-missing...');
    await runCommand('node', ['scripts/run-handle-missing.js'], { ...commonEnv, TEST_COLUMN: process.env.TEST_COLUMN || 'age', TEST_STRATEGY: process.env.TEST_STRATEGY || 'mean', TEST_FILL_VALUE: process.env.TEST_FILL_VALUE });

    console.log('\nRunning rollback...');
    await runCommand('node', ['scripts/run-rollback.js'], commonEnv);

    console.log('\nAll process tests completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('\nProcess tests failed:', err.message || err);
    process.exit(1);
  }
})();