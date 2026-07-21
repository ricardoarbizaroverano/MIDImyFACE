const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WebSocket } = require('ws');

const port = 32147;
const origin = `http://127.0.0.1:${port}`;
const deviceToken = 'test-device-token-000000000000000000000000';
const stateFile = path.join('/tmp', `midimyface-live-test-${process.pid}.json`);
let streamAbort = null;

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
    LIVE_DEVICE_HEARTBEAT_TTL_MS: '500',
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

function waitForWsMessage(socket, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('websocket message timeout')), timeoutMs);
    const onMessage = (raw) => {
      let message = null;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
  });
}

async function readSseSnapshot(reader, predicate, timeoutMs = 3000) {
  const decoder = new TextDecoder();
  let buffered = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SSE snapshot timeout')), remaining)),
    ]);
    if (result.done) throw new Error('SSE stream closed');
    buffered += decoder.decode(result.value, { stream: true });
    const events = buffered.split('\n\n');
    buffered = events.pop() || '';
    for (const event of events) {
      const dataLine = event.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      const payload = JSON.parse(dataLine.slice(5).trim());
      if (predicate(payload)) return payload;
    }
  }
  throw new Error('SSE snapshot timeout');
}

async function run() {
  await waitForServer();
  let result = await request('/api/live/device/status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine: { alive: true, acceptingParticipants: true, mode: 'hybrid' } }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.installationStatus.online, true);
  assert.equal(result.body.status.protocolVersion, 'midimyface-live-v2');
  assert.equal(result.body.status.media.cameraFeedEnabled, false);
  assert.equal(result.body.status.media.state, 'DISABLED');
  assert.equal(typeof result.body.installationStatus.notificationId, 'string');
  const installationEpoch = Number(result.body.status?.installationEpoch);
  assert.ok(Number.isSafeInteger(installationEpoch) && installationEpoch > 0);

  await new Promise((resolve) => setTimeout(resolve, 550));
  result = await request('/api/live/status');
  assert.equal(result.body.status.machine.controlReachable, false);
  assert.equal(result.body.status.machine.acceptingParticipants, false);
  result = await request('/api/live/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ nickname: 'NoControl', countryCode: 'UY', deviceId: 'test_device_no_control' }),
  });
  assert.equal(result.response.status, 503);
  assert.equal(result.body.error, 'installation_control_unreachable');
  result = await request('/api/live/device/status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine: { alive: true, acceptingParticipants: true, mode: 'hybrid' } }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status.media.cameraFeedEnabled, false);

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
  const participantSessionId = result.body.session.sessionId;
  assert.equal(result.body.session.installationEpoch, installationEpoch);
  const concurrentTokens = [];
  const concurrentSessionIds = [];
  for (const [index, nickname] of ['Second', 'Third'].entries()) {
    result = await request('/api/live/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ nickname, countryCode: 'FI', deviceId: `test_device_000000000000000${index + 2}` }),
    });
    assert.equal(result.response.status, 201);
    concurrentTokens.push(result.body.token);
    concurrentSessionIds.push(result.body.session.sessionId);
    assert.equal(result.body.session.installationEpoch, installationEpoch);
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
      installationEpoch,
      participantSessionId,
      sequenceNumber: 0,
      clientTimestamp: Date.now(),
      gestures: { mouthOpen: 20.123, accent: 8.5 },
      triggerCounts: { mouthOpen: 2, accent: 1 },
      landmarks: fullFaceLandmarks,
      frameAspect: 9 / 16,
    }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.metadata.installationEpoch, installationEpoch);
  assert.equal(result.body.metadata.participantSessionId, participantSessionId);
  assert.equal(result.body.metadata.sequenceNumber, 0);

  result = await request('/api/live/session/gestures', {
    method: 'POST',
    headers: { Authorization: `Bearer ${participantToken}`, 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      installationEpoch,
      participantSessionId,
      sequenceNumber: 0,
      clientTimestamp: Date.now(),
      gestures: { mouthOpen: 21 },
      triggerCounts: { mouthOpen: 3 },
      landmarks: fullFaceLandmarks,
    }),
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error, 'invalid_sequence_number');

  result = await request('/api/live/session/gestures', {
    method: 'POST',
    headers: { Authorization: `Bearer ${participantToken}`, 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      installationEpoch,
      participantSessionId,
      sequenceNumber: 1,
      clientTimestamp: Date.now() - 90_000,
      gestures: { mouthOpen: 21 },
      triggerCounts: { mouthOpen: 3 },
      landmarks: fullFaceLandmarks,
    }),
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error, 'stale_client_timestamp');

  result = await request('/api/live/session/gestures', {
    method: 'POST',
    headers: { Authorization: `Bearer ${concurrentTokens[0]}`, 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      installationEpoch,
      participantSessionId: concurrentSessionIds[0],
      sequenceNumber: 0,
      clientTimestamp: Date.now(),
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
      installationEpoch,
      participantSessionId,
      sequenceNumber: 1,
      clientTimestamp: Date.now(),
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
  assert.equal(result.body.installationEpoch, installationEpoch);
  assert.equal(result.body.sequenceNumber, 1);
  assert.ok(Number.isFinite(result.body.clientTimestamp));

  streamAbort = new AbortController();
  const streamResponse = await fetch(`${origin}/api/live/session/gestures/stream`, {
    headers: { Authorization: `Bearer ${deviceToken}` },
    signal: streamAbort.signal,
  });
  assert.equal(streamResponse.status, 200);
  const streamReader = streamResponse.body.getReader();
  await readSseSnapshot(streamReader, (payload) => payload.sequenceNumber === 1);

  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: origin } });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'live/participant-auth', token: participantToken }));
  const ready = await waitForWsMessage(socket, (message) => message.type === 'live/participant-ready');
  assert.equal(ready.data.sessionId, participantSessionId);
  socket.send(JSON.stringify({
    type: 'live/gesture',
    data: {
      installationEpoch,
      participantSessionId,
      sequenceNumber: 2,
      clientTimestamp: Date.now(),
      gestures: { mouthOpen: 22 },
      triggerCounts: { mouthOpen: 3, accent: 1 },
      landmarks: fullFaceLandmarks,
      frameAspect: 9 / 16,
    },
  }));
  const acknowledgment = await waitForWsMessage(socket, (message) => message.type === 'live/gesture-ack');
  assert.equal(acknowledgment.data.sequenceNumber, 2);
  const streamed = await readSseSnapshot(streamReader, (payload) => payload.sequenceNumber === 2);
  assert.equal(streamed.triggerCounts.mouthOpen, 3);
  assert.equal(streamed.landmarks.length, 468);
  socket.close();
  streamAbort.abort();
  streamAbort = null;

  result = await request('/api/live/device/reset-runtime', {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({}),
  });
  assert.equal(result.response.status, 200);
  assert.ok(Number.isSafeInteger(result.body.installationEpoch));
  assert.notEqual(result.body.installationEpoch, installationEpoch);
  const nextInstallationEpoch = result.body.installationEpoch;

  result = await request('/api/live/status');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.sessions.length, 0);
  assert.equal(result.body.queue.waiting, 0);
  assert.equal(result.body.installationEpoch, nextInstallationEpoch);

  result = await request('/api/live/session/gestures', {
    method: 'POST',
    headers: { Authorization: `Bearer ${participantToken}`, 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      installationEpoch,
      participantSessionId,
      sequenceNumber: 2,
      clientTimestamp: Date.now(),
      gestures: { mouthOpen: 23 },
      triggerCounts: { mouthOpen: 4 },
      landmarks: fullFaceLandmarks,
    }),
  });
  assert.equal(result.response.status, 401);

  result = await request('/api/live/queue/status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${queueToken}`, 'Content-Type': 'application/json', Origin: origin },
    body: '{}',
  });
  assert.equal(result.response.status, 410);

  result = await request('/api/live/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ nickname: 'TestPlayr', countryCode: 'UY', deviceId: 'test_device_0000000000000001' }),
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.session.installationEpoch, nextInstallationEpoch);

  result = await request('/api/live/session/stop', {
    method: 'POST',
    headers: { Authorization: `Bearer ${result.body.token}`, 'Content-Type': 'application/json', Origin: origin },
    body: '{}',
  });
  assert.equal(result.response.status, 200);

  result = await request('/api/live/session/gestures', {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  assert.equal(result.body.active, false);
  assert.deepEqual(result.body.gestures, {});
  assert.deepEqual(result.body.triggerCounts, {});

  result = await request('/api/live/device/status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine: { alive: false, acceptingParticipants: false, mode: 'offline' } }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.installationStatus.online, false);
  console.log('live session integration test passed');
}

run()
  .finally(async () => {
    streamAbort?.abort();
    child.kill('SIGTERM');
    await fs.rm(stateFile, { force: true });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
