const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const port = 32147;
const origin = `http://127.0.0.1:${port}`;
const deviceToken = 'test-device-token-000000000000000000000000';
const stateFile = path.join('/tmp', `midimyface-live-test-${process.pid}.json`);

const child = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    ALLOWED_ORIGINS: origin,
    REQUIRE_JOIN_TOKEN: 'true',
    RELAY_JOIN_TOKEN_SECRET: 'relay-test-secret-000000000000000000000',
    INVITE_TOKEN_SECRET: 'invite-test-secret-00000000000000000000',
    AUTH_TOKEN_SECRET: 'auth-test-secret-000000000000000000000',
    TEST_ADMIN_USERNAME: 'test-admin',
    TEST_ADMIN_PASSWORD: 'test-password-long',
    RPI_DEVICE_TOKEN: deviceToken,
    LIVE_STATE_FILE: stateFile,
    LIVE_SESSION_DURATION_SECONDS: '15',
    LIVE_SNAPSHOT_TTL_MS: '1000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function request(pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const result = await request('/health');
      if (result.response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('relay did not start');
}

async function run() {
  await waitForServer();
  let result = await request('/api/live/device/status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine: { alive: true, acceptingParticipants: true, mode: 'hybrid' } }),
  });
  assert.equal(result.response.status, 200);

  result = await request('/api/live/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ nickname: 'Test Player', countryCode: 'UY', deviceId: 'test_device_0000000000000001' }),
  });
  assert.equal(result.response.status, 201);
  assert.ok(result.body.token);
  const participantToken = result.body.token;
  result = await request('/api/live/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ nickname: 'Queued Player', countryCode: 'FI', deviceId: 'test_device_0000000000000002' }),
  });
  assert.equal(result.response.status, 202);
  assert.equal(result.body.queued, true);
  assert.equal(result.body.queue.position, 1);
  const queueToken = result.body.queueToken;

  result = await request('/api/live/queue/status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${queueToken}`, 'Content-Type': 'application/json', Origin: origin },
    body: '{}',
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ready, false);
  assert.equal(result.body.queue.position, 1);
  const fullFaceLandmarks = Array.from({ length: 468 }, (_, index) => ({
    x: (index % 26) / 25,
    y: Math.floor(index / 26) / 17,
  }));

  result = await request('/api/live/session/gestures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ gestures: { mouthOpen: 20 } }),
  });
  assert.equal(result.response.status, 401);

  result = await request('/api/live/session/gestures', {
    method: 'POST',
    headers: { Authorization: `Bearer ${participantToken}`, 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      gestures: { mouthOpen: 20.123, accent: 8.5 },
      triggerCounts: { mouthOpen: 2, accent: 1 },
      landmarks: fullFaceLandmarks,
      frameAspect: 9 / 16,
    }),
  });
  assert.equal(result.response.status, 200);

  result = await request('/api/live/session/gestures');
  assert.equal(result.response.status, 401);

  result = await request('/api/live/session/gestures', {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.fresh, true);
  assert.equal(result.body.participant.nickname, 'Test Player');
  assert.equal(result.body.landmarks.length, 468);
  assert.deepEqual(result.body.landmarks[0], { x: 0, y: 0 });
  assert.deepEqual(result.body.triggerCounts, { mouthOpen: 2, accent: 1 });
  assert.equal(result.body.frameAspect, 0.5625);

  result = await request('/api/live/session/stop', {
    method: 'POST',
    headers: { Authorization: `Bearer ${participantToken}`, 'Content-Type': 'application/json', Origin: origin },
    body: '{}',
  });
  assert.equal(result.response.status, 200);

  result = await request('/api/live/queue/status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${queueToken}`, 'Content-Type': 'application/json', Origin: origin },
    body: '{}',
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ready, true);
  assert.equal(result.body.session.nickname, 'Queued Player');
  const queuedParticipantToken = result.body.token;

  result = await request('/api/live/session/stop', {
    method: 'POST',
    headers: { Authorization: `Bearer ${queuedParticipantToken}`, 'Content-Type': 'application/json', Origin: origin },
    body: '{}',
  });
  assert.equal(result.response.status, 200);

  result = await request('/api/live/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ nickname: 'Test Player', countryCode: 'UY', deviceId: 'test_device_0000000000000001' }),
  });
  assert.equal(result.response.status, 429);
  assert.equal(result.body.error, 'participant_cooldown');

  result = await request('/api/live/session/gestures', {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  assert.equal(result.body.active, false);
  assert.deepEqual(result.body.gestures, {});
  assert.deepEqual(result.body.triggerCounts, {});
  console.log('live session integration test passed');
}

run()
  .finally(async () => {
    child.kill('SIGTERM');
    await fs.rm(stateFile, { force: true });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
