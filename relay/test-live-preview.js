const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const port = 32150;
const origin = `http://127.0.0.1:${port}`;
const deviceToken = 'preview-test-device-token-1234567890';

const child = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    ALLOWED_ORIGINS: origin,
    REQUIRE_JOIN_TOKEN: 'false',
    CONSOLE_API_ENABLED: 'false',
    RPI_DEVICE_TOKEN: deviceToken,
    LIVE_PREVIEW_MAX_VIEWERS: '1',
    LIVE_PREVIEW_MAX_PER_CLIENT: '1',
    LIVE_PREVIEW_TOKEN_TTL_SEC: '120',
    LIVE_PREVIEW_MAX_ICE_PER_QUEUE: '8',
    AUTH_TOKEN_SECRET: 'preview-test-auth-secret-1234567890',
    RELAY_JOIN_TOKEN_SECRET: 'preview-test-relay-secret-1234567890',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function request(pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
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

  let result = await request('/api/live/preview/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ role: 'waiting_viewer' }),
  });
  assert.equal(result.response.status, 201);
  assert.equal(typeof result.body.connectionId, 'string');
  assert.equal(typeof result.body.token, 'string');
  assert.ok(Array.isArray(result.body.iceServers));

  const connectionId = result.body.connectionId;
  const token = result.body.token;

  result = await request('/api/live/preview/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ role: 'waiting_viewer' }),
  });
  assert.equal(result.response.status, 429);
  assert.equal(result.body.error, 'preview_client_limit_reached');

  result = await request('/api/live/preview/signal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ connectionId, to: 'pi', type: 'offer', data: { sdp: 'x', type: 'offer' } }),
  });
  assert.equal(result.response.status, 401);
  assert.equal(result.body.error, 'invalid_preview_token');

  result = await request('/api/live/preview/signal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      connectionId,
      token,
      to: 'pi',
      type: 'offer',
      data: { sdp: 'v=0\n', type: 'offer' },
    }),
  });
  assert.equal(result.response.status, 200);

  result = await request('/api/live/preview/poll?role=pi', {
    headers: { Authorization: `Bearer ${deviceToken}`, Origin: origin },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.signals.length, 1);
  assert.equal(result.body.signals[0].type, 'offer');

  result = await request('/api/live/preview/signal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      connectionId,
      to: 'viewer',
      type: 'answer',
      data: { sdp: 'v=0\n', type: 'answer' },
    }),
  });
  assert.equal(result.response.status, 200);

  result = await request(`/api/live/preview/poll?role=viewer&connectionId=${encodeURIComponent(connectionId)}&token=${encodeURIComponent(token)}`, {
    headers: { Origin: origin },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.signals.length, 1);
  assert.equal(result.body.signals[0].type, 'answer');

  result = await request('/api/live/preview/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ connectionId, token }),
  });
  assert.equal(result.response.status, 200);

  console.log('live preview signaling test passed');
}

run()
  .finally(() => {
    child.kill('SIGTERM');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
