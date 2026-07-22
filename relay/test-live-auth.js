const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WebSocket } = require('ws');

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
    CONSOLE_API_ENABLED: 'true',
    RELAY_JOIN_TOKEN_SECRET: 'relay-auth-test-secret-000000000000000000',
    INVITE_TOKEN_SECRET: 'invite-auth-test-secret-00000000000000000',
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

function waitForWsMessage(socket, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('websocket message timeout')), timeoutMs);
    const handler = (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off('message', handler);
      resolve(message);
    };
    socket.on('message', handler);
  });
}

async function openSessionSocket(port, hello) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: originFor(port) } });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const joined = waitForWsMessage(socket, (message) => message.type === 'joined');
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  socket.joinedData = (await joined).data;
  return socket;
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

async function createConsoleSession(port, token = 'token-active') {
  const created = await request(port, '/api/sessions/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: originFor(port) },
    body: JSON.stringify({ max_participants: 25, session_password: 'optional-session-password' }),
  });
  assert.equal(created.response.status, 200);
  return created.body.session;
}

async function requestPerformerJoinToken(port, session, token) {
  return request(port, '/api/sessions/join-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: originFor(port),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ session_id: session.session_id, invite_token: session.invite_token, name: 'Invitee' }),
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

    let consoleCreate = await request(port, '/api/sessions/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: originFor(port) },
      body: JSON.stringify({ max_participants: 10 }),
    });
    assert.equal(consoleCreate.response.status, 401);
    assert.equal(consoleCreate.body.error, 'registration_required');
    consoleCreate = await request(port, '/api/sessions/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer malformed-token-not-in-verifier', Origin: originFor(port) },
      body: JSON.stringify({ max_participants: 10 }),
    });
    assert.equal(consoleCreate.response.status, 401);
    assert.equal(consoleCreate.body.error, 'invalid_firebase_token');

    const obsoleteLogin = await request(port, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: originFor(port) },
      body: JSON.stringify({ username: 'auth-test-admin', password: 'auth-test-password-long' }),
    });
    assert.equal(obsoleteLogin.response.status, 404);

    const consoleSession = await createConsoleSession(port);
    assert.equal(consoleSession.max_participants, 10);
    assert.equal(consoleSession.session_password, 'optional-session-password');
    const hostClaims = JSON.parse(Buffer.from(consoleSession.host_join_token.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(hostClaims.firebase_uid, 'uid-active');
    assert.equal(hostClaims.name, consoleSession.host_name);
    let inviteJoin = await requestPerformerJoinToken(port, consoleSession);
    assert.equal(inviteJoin.response.status, 401);
    assert.equal(inviteJoin.body.error, 'registration_required');
    inviteJoin = await requestPerformerJoinToken(port, consoleSession, 'malformed-token-not-in-verifier');
    assert.equal(inviteJoin.response.status, 401);
    assert.equal(inviteJoin.body.error, 'invalid_firebase_token');
    inviteJoin = await requestPerformerJoinToken(port, consoleSession, 'token-active');
    assert.equal(inviteJoin.response.status, 200);
    const joinClaims = JSON.parse(Buffer.from(inviteJoin.body.join_token.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(joinClaims.firebase_uid, 'uid-active');

    const hostSocket = await openSessionSocket(port, {
      session_id: consoleSession.session_id, role: 'host', name: consoleSession.host_name,
      client_uuid: 'auth-host-client', join_token: consoleSession.host_join_token,
    });
    const performerSocket = await openSessionSocket(port, {
      session_id: consoleSession.session_id, role: 'performer', name: 'Invitee',
      client_uuid: 'auth-performer-client', join_token: inviteJoin.body.join_token,
    });
    const ensembleUpdate = waitForWsMessage(performerSocket, (message) => message.type === 'session/config' && message.data?.tempo === 137);
    hostSocket.send(JSON.stringify({ type: 'session/config', data: { audioMuted: true, key: 'D', scale: 'dorian', gridEnabled: true, quantization: '1/16', tempo: 137, ignored: 'drop-me' } }));
    const ensembleMessage = await ensembleUpdate;
    assert.deepEqual(ensembleMessage.data, { audioMuted: true, key: 'D', scale: 'dorian', gridEnabled: true, quantization: '1/16', tempo: 137, clockStartedAt: ensembleMessage.data.clockStartedAt });
    assert.equal(Number.isFinite(ensembleMessage.data.clockStartedAt), true);
    const performerConfigUpdate = waitForWsMessage(performerSocket, (message) => message.type === 'server/performer-config');
    hostSocket.send(JSON.stringify({ type: 'server/performer-config', to: performerSocket.joinedData.participant_id, data: { role: 'chord', gesture: 'noseX', chordDisplay: 'pitch' } }));
    assert.deepEqual((await performerConfigUpdate).data, { role: 'chord', gesture: 'noseX', chordDisplay: 'pitch' });
    const hostNoteUpdate = waitForWsMessage(performerSocket, (message) => message.type === 'session/host-note');
    hostSocket.send(JSON.stringify({ type: 'session/host-note', data: { note: 64, on: true, velocity: 111 } }));
    assert.deepEqual((await hostNoteUpdate).data, { note: 64, on: true, velocity: 111 });
    hostSocket.close(); performerSocket.close();

    await setInstallationReady(port);
    let result = await startParticipant(port, {
      token: 'token-active',
      deviceId: 'auth_active_device_0000001',
      nickname: 'ActivePlay',
    });
    assert.equal(result.response.status, 201);

    result = await startParticipant(port, {
      token: 'malformed-token-not-in-verifier',
      deviceId: 'auth_invalid_device_000001',
      nickname: 'BadToken',
    });
    assert.equal(result.response.status, 401);
    assert.equal(result.body.error, 'invalid_firebase_token');

    for (const token of ['token-invalid', 'token-expired']) {
      result = await startParticipant(port, {
        token,
        deviceId: `auth_${token.replaceAll('-', '_')}_device`,
        nickname: 'TokenBad',
      });
      assert.equal(result.response.status, 401);
      assert.equal(result.body.error, 'invalid_firebase_token');
    }

    result = await startParticipant(port, {
      deviceId: 'forged_master_device_00001',
      nickname: 'FakeMaster',
      extraBody: { email: masterEmail, master: true, masterPriority: true },
    });
    assert.equal(result.response.status, 401);
    assert.equal(result.body.error, 'registration_required');

    result = await startParticipant(port, {
      token: 'token-no-email',
      deviceId: 'no_email_device_000000001',
      nickname: 'NoEmail',
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.privileges.masterPriority, false);

    result = await startParticipant(port, {
      token: 'token-unverified-master',
      deviceId: 'unverified_device_0000001',
      nickname: 'Unverified',
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.privileges.masterPriority, false);

    result = await startParticipant(port, {
      token: 'token-ordinary',
      deviceId: 'ordinary_device_000000001',
      nickname: 'Ordinary',
    });
    assert.equal(result.response.status, 202);
    assert.equal(result.body.queue.priority, 'standard');

    result = await startParticipant(port, {
      token: 'token-master',
      deviceId: 'master_device_0000000001',
      nickname: 'MasterUser',
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
      nickname: 'MissingCfg',
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.body.error, 'firebase_admin_unconfigured');

    result = await startParticipant(port, {
      deviceId: 'anonymous_blocked_00000001',
      nickname: 'Anonymous',
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
