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
    CONSOLE_ADMIN_USERNAME: 'test-admin',
    CONSOLE_ADMIN_PASSWORD: 'test-password-long',
    RPI_DEVICE_TOKEN: deviceToken,
    LIVE_STATE_FILE: stateFile,
    LIVE_SESSION_DURATION_SECONDS: '15',
    LIVE_SNAPSHOT_TTL_MS: '1000',
    LIVE_REQUIRE_FIREBASE_AUTH: 'false',
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
    body: JSON.stringify({ nickname: 'LongNickname11', countryCode: 'UY', deviceId: 'test_device_validation_long' }),
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, 'nickname_too_long');

  result = await request('/api/live/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ nickname: 'NaziBeat', countryCode: 'UY', deviceId: 'test_device_validation_block' }),
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, 'nickname_inappropriate');

  result = await request('/api/live/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ nickname: 'TestPlayr', countryCode: 'UY', deviceId: 'test_device_0000000000000001' }),
  });
  assert.equal(result.response.status, 201);
  assert.ok(result.body.token);
  const participantToken = result.body.token;
  const concurrentTokens = [];
  for (const [index, nickname] of ['Second', 'Third'].entries()) {
    result = await request('/api/live/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ nickname, countryCode: 'FI', deviceId: `test_device_000000000000000${index + 2}` }),
    });
    assert.equal(result.response.status, 201);
    concurrentTokens.push(result.body.token);
  }
  result = await request('/api/live/status');
  assert.equal(result.body.sessions.length, 3);
  assert.equal(result.body.capacity.available, 0);
  assert.deepEqual(result.body.sessions.map((session) => session.colorIndex), [0, 1, 2]);

  result = await request('/api/live/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ nickname: 'QueuedUp', countryCode: 'FI', deviceId: 'test_device_0000000000000004' }),
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

  result = await request('/api/live/session/gestures', {
    method: 'POST',
    headers: { Authorization: `Bearer ${concurrentTokens[0]}`, 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      gestures: { smile: 12 },
      triggerCounts: { smile: 1 },
      landmarks: fullFaceLandmarks.slice(0, 100),
      frameAspect: 4 / 3,
    }),
  });
  assert.equal(result.response.status, 200);

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
  assert.equal(result.body.participants.length, 1);
  assert.equal(result.body.participants[0].nickname, 'Second');

  result = await request('/api/live/session/gestures');
  assert.equal(result.response.status, 401);

  result = await request('/api/live/session/gestures', {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.fresh, true);
  assert.equal(result.body.participants.length, 3);
  assert.equal(result.body.participants.filter((participant) => participant.fresh).length, 2);
  assert.equal(result.body.participant.nickname, 'TestPlayr');
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
  assert.equal(result.body.session.nickname, 'QueuedUp');
  const queuedParticipantToken = result.body.token;

  for (const token of concurrentTokens) {
    result = await request('/api/live/session/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: origin },
      body: '{}',
    });
    assert.equal(result.response.status, 200);
  }

  result = await request('/api/live/session/stop', {
    method: 'POST',
    headers: { Authorization: `Bearer ${queuedParticipantToken}`, 'Content-Type': 'application/json', Origin: origin },
    body: '{}',
  });
  assert.equal(result.response.status, 200);

  result = await request('/api/live/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ nickname: 'TestPlayr', countryCode: 'UY', deviceId: 'test_device_0000000000000001' }),
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
