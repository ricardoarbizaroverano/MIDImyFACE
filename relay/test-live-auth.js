const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const originFor = (port) => `http://127.0.0.1:${port}`;
const deviceToken = 'auth-test-device-token-000000000000000000';
const masterEmail = 'verified-master@example.test';
const tokenClaims = {
  'token-active': { uid: 'uid-active', email: 'active@example.test', email_verified: true },
  'token-no-email': { uid: 'uid-no-email', email_verified: true },
  'token-unverified-master': { uid: 'uid-unverified', email: masterEmail, email_verified: false },
  'token-ordinary': { uid: 'uid-ordinary', email: 'ordinary@example.test', email_verified: true },
  'token-master': { uid: 'uid-master', email: ` ${masterEmail.toUpperCase()} `, email_verified: true },
  'token-invalid': { error: 'invalid' },
  'token-expired': { error: 'expired' },
};

function serverEnvironment(port, stateFile, overrides = {}) {
  return {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    ALLOWED_ORIGINS: originFor(port),
    REQUIRE_JOIN_TOKEN: 'true',
    RELAY_JOIN_TOKEN_SECRET: 'relay-auth-test-secret-000000000000000000',
    INVITE_TOKEN_SECRET: 'invite-auth-test-secret-00000000000000000',
    AUTH_TOKEN_SECRET: 'console-auth-test-secret-00000000000000000',
    TEST_ADMIN_USERNAME: 'auth-test-admin',
    TEST_ADMIN_PASSWORD: 'auth-test-password-long',
    RPI_DEVICE_TOKEN: deviceToken,
    LIVE_STATE_FILE: stateFile,
    LIVE_SESSION_DURATION_SECONDS: '15',
    LIVE_COOLDOWN_MINUTES: '30',
    LIVE_QUEUE_TICKET_TTL_MS: '45000',
    LIVE_FIREBASE_API_KEY: '',
    LIVE_FIREBASE_AUTH_DOMAIN: '',
    LIVE_FIREBASE_PROJECT_ID: '',
    LIVE_FIREBASE_STORAGE_BUCKET: '',
    LIVE_FIREBASE_MESSAGING_SENDER_ID: '',
    LIVE_FIREBASE_APP_ID: '',
    LIVE_FIREBASE_MEASUREMENT_ID: '',
    FIREBASE_ADMIN_PROJECT_ID: '',
    FIREBASE_ADMIN_CLIENT_EMAIL: '',
    FIREBASE_ADMIN_PRIVATE_KEY: '',
    LIVE_MASTER_EMAILS: '',
    LIVE_FIREBASE_TEST_TOKENS_JSON: '',
    LIVE_REQUIRE_FIREBASE_AUTH: 'true',
    ...overrides,
  };
}

function startServer(port, stateFile, overrides = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: serverEnvironment(port, stateFile, overrides),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stdout.on('data', (chunk) => { diagnostics += chunk.toString(); });
  child.stderr.on('data', (chunk) => { diagnostics += chunk.toString(); });
  return { child, diagnostics: () => diagnostics };
}

async function request(port, pathname, options = {}) {
  const response = await fetch(`${originFor(port)}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

async function waitForServer(port, processInfo) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processInfo.child.exitCode !== null) throw new Error(`relay stopped before startup: ${processInfo.diagnostics()}`);
    try {
      const result = await request(port, '/health');
      if (result.response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`relay did not start: ${processInfo.diagnostics()}`);
}

async function setInstallationReady(port) {
  const result = await request(port, '/api/live/device/status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine: { alive: true, acceptingParticipants: true, mode: 'hybrid' } }),
  });
  assert.equal(result.response.status, 200);
}

async function startParticipant(port, { token, deviceId, nickname, extraBody = {} }) {
  return request(port, '/api/live/session/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: originFor(port),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      nickname,
      countryCode: 'FI',
      deviceId,
      ...extraBody,
    }),
  });
}

async function configuredAuthTests() {
  const port = 32148;
  const stateFile = path.join('/tmp', `midimyface-live-auth-${process.pid}.json`);
  const privateSentinels = [
    'private-admin-project-sentinel',
    'private-admin-client-sentinel@example.test',
    'private-admin-key-sentinel',
    masterEmail,
    deviceToken,
  ];
  const processInfo = startServer(port, stateFile, {
    LIVE_FIREBASE_API_KEY: 'public-test-api-key',
    LIVE_FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
    LIVE_FIREBASE_PROJECT_ID: 'public-test-project',
    LIVE_FIREBASE_STORAGE_BUCKET: 'public-test-project.firebasestorage.app',
    LIVE_FIREBASE_MESSAGING_SENDER_ID: '123456789',
    LIVE_FIREBASE_APP_ID: '1:123456789:web:test',
    LIVE_FIREBASE_MEASUREMENT_ID: '',
    FIREBASE_ADMIN_PROJECT_ID: privateSentinels[0],
    FIREBASE_ADMIN_CLIENT_EMAIL: privateSentinels[1],
    FIREBASE_ADMIN_PRIVATE_KEY: privateSentinels[2],
    LIVE_MASTER_EMAILS: masterEmail,
    LIVE_FIREBASE_TEST_TOKENS_JSON: JSON.stringify(tokenClaims),
  });

  try {
    await waitForServer(port, processInfo);
    const configResult = await request(port, '/api/live/config', { headers: { Origin: originFor(port) } });
    assert.equal(configResult.response.status, 200);
    assert.deepEqual(Object.keys(configResult.body.firebase).sort(), [
      'apiKey', 'appId', 'authDomain', 'measurementId', 'messagingSenderId', 'projectId', 'storageBucket',
    ]);
    assert.equal(configResult.body.auth.enabled, true);
    assert.equal(configResult.body.auth.required, true);
    const serializedConfig = JSON.stringify(configResult.body);
    for (const sentinel of privateSentinels) assert.equal(serializedConfig.includes(sentinel), false);

    const bootstrapResult = await request(port, '/api/live/bootstrap');
    const statusBefore = await request(port, '/api/live/status');
    for (const sentinel of privateSentinels) {
      assert.equal(JSON.stringify(bootstrapResult.body).includes(sentinel), false);
      assert.equal(JSON.stringify(statusBefore.body).includes(sentinel), false);
    }

    await setInstallationReady(port);
    let result = await startParticipant(port, {
      token: 'token-active',
      deviceId: 'auth_active_device_0000001',
      nickname: 'Active Player',
    });
    assert.equal(result.response.status, 201);

    result = await startParticipant(port, {
      token: 'malformed-token-not-in-verifier',
      deviceId: 'auth_invalid_device_000001',
      nickname: 'Malformed Token',
    });
    assert.equal(result.response.status, 401);
    assert.equal(result.body.error, 'invalid_firebase_token');

    for (const token of ['token-invalid', 'token-expired']) {
      result = await startParticipant(port, {
        token,
        deviceId: `auth_${token.replaceAll('-', '_')}_device`,
        nickname: token,
      });
      assert.equal(result.response.status, 401);
      assert.equal(result.body.error, 'invalid_firebase_token');
    }

    result = await startParticipant(port, {
      deviceId: 'forged_master_device_00001',
      nickname: 'Forged Browser Master',
      extraBody: { email: masterEmail, master: true, masterPriority: true },
    });
    assert.equal(result.response.status, 401);
    assert.equal(result.body.error, 'registration_required');

    result = await startParticipant(port, {
      token: 'token-no-email',
      deviceId: 'no_email_device_000000001',
      nickname: 'No Email',
    });
    assert.equal(result.response.status, 202);
    assert.equal(result.body.queue.priority, 'standard');

    result = await startParticipant(port, {
      token: 'token-unverified-master',
      deviceId: 'unverified_device_0000001',
      nickname: 'Unverified Email',
    });
    assert.equal(result.response.status, 202);
    assert.equal(result.body.queue.priority, 'standard');

    result = await startParticipant(port, {
      token: 'token-ordinary',
      deviceId: 'ordinary_device_000000001',
      nickname: 'Ordinary Account',
    });
    assert.equal(result.response.status, 202);
    assert.equal(result.body.queue.priority, 'standard');

    result = await startParticipant(port, {
      token: 'token-master',
      deviceId: 'master_device_0000000001',
      nickname: 'Verified Master',
      extraBody: { email: 'forged-other@example.test', master: false },
    });
    assert.equal(result.response.status, 202);
    assert.equal(result.body.queue.priority, 'master');
    assert.equal(result.body.queue.position, 1);
  } finally {
    processInfo.child.kill('SIGTERM');
    await fs.rm(stateFile, { force: true });
  }
}

async function missingConfigurationTests() {
  const port = 32149;
  const stateFile = path.join('/tmp', `midimyface-live-auth-missing-${process.pid}.json`);
  const processInfo = startServer(port, stateFile, {
    CONSOLE_API_ENABLED: 'false',
    REQUIRE_JOIN_TOKEN: 'false',
    RELAY_JOIN_TOKEN_SECRET: '',
    INVITE_TOKEN_SECRET: '',
    AUTH_TOKEN_SECRET: '',
    CONSOLE_ADMIN_USERNAME: '',
    CONSOLE_ADMIN_PASSWORD: '',
    TEST_ADMIN_USERNAME: '',
    TEST_ADMIN_PASSWORD: '',
  });
  try {
    await waitForServer(port, processInfo);
    let result = await request(port, '/api/live/config');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.auth.enabled, false);
    assert.equal(result.body.firebase.apiKey, '');

    await setInstallationReady(port);
    result = await startParticipant(port, {
      token: 'any-bearer-token',
      deviceId: 'missing_config_device_0001',
      nickname: 'Missing Config',
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.body.error, 'firebase_admin_unconfigured');

    result = await startParticipant(port, {
      deviceId: 'anonymous_blocked_00000001',
      nickname: 'Anonymous Player',
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.body.error, 'firebase_admin_unconfigured');
  } finally {
    processInfo.child.kill('SIGTERM');
    await fs.rm(stateFile, { force: true });
  }
}

async function run() {
  await configuredAuthTests();
  await missingConfigurationTests();
  console.log('live Firebase authentication security tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
