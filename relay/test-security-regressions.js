const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');

const relaySecret = 'security-test-relay-secret-0000000000000000';
const stateFile = path.join('/tmp', `midimyface-security-test-${process.pid}.json`);
let child = null;
let childOutput = '';

function liveRelayOrigin(hostname, search) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'live', 'live.js'), 'utf8');
  const constants = source.match(
    /const DEFAULT_RELAY_ORIGIN = [^\n]+;\nconst LOCAL_DEVELOPMENT_HOSTNAMES = [^\n]+;\nconst LOCAL_HTTP_PROTOCOLS = [^\n]+;/
  )?.[0];
  const start = source.indexOf('function resolveRelayOrigin()');
  const end = source.indexOf('async function api(', start);
  assert.ok(constants && start >= 0 && end > start, 'live relay resolver source must be available');
  const context = {
    URL,
    URLSearchParams,
    Set,
    window: { location: { hostname, search } },
  };
  vm.runInNewContext(
    `${constants}\n${source.slice(start, end)}\nglobalThis.__relayOrigin = resolveRelayOrigin();`,
    context
  );
  return context.__relayOrigin;
}

async function liveAuthenticatedRequest(hostname, search) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'live', 'live.js'), 'utf8');
  const constants = source.match(
    /const DEFAULT_RELAY_ORIGIN = [^\n]+;\nconst LOCAL_DEVELOPMENT_HOSTNAMES = [^\n]+;\nconst LOCAL_HTTP_PROTOCOLS = [^\n]+;/
  )?.[0];
  const resolverStart = source.indexOf('function resolveRelayOrigin()');
  const apiEnd = source.indexOf('function normalizeNickname(', resolverStart);
  let request = null;
  const context = {
    URL,
    URLSearchParams,
    Set,
    Error,
    window: { location: { hostname, search } },
    async fetch(target, options) {
      request = { target: String(target), headers: { ...options.headers } };
      return { ok: true, async json() { return {}; } };
    },
  };
  vm.runInNewContext(
    `${constants}
${source.slice(resolverStart, apiEnd)}
const state = { relayOrigin: resolveRelayOrigin() };
globalThis.__requestPromise = api('/api/live/status', { headers: { Authorization: 'Bearer firebase-test-token' } });`,
    context
  );
  await context.__requestPromise;
  return request;
}

function consoleEndpoints(hostname, search, stored = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');
  const start = source.indexOf('const RELAY_URL_DEFAULT =');
  const end = source.indexOf('/* ===== Instruments for local monitor', start);
  assert.ok(start >= 0 && end > start, 'console endpoint resolver source must be available');
  const context = {
    URL,
    URLSearchParams,
    Set,
    location: { hostname, search },
    localStorage: {
      getItem(key) {
        return stored[key] || null;
      },
    },
  };
  vm.runInNewContext(
    `${source.slice(start, end)}
globalThis.__endpoints = { relay: RELAY_URL, api: CONSOLE_API_BASE };`,
    context
  );
  return {
    relay: String(context.__endpoints.relay),
    api: String(context.__endpoints.api),
  };
}

async function consoleAuthenticatedRequest(hostname, search, stored = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');
  const endpointStart = source.indexOf('const RELAY_URL_DEFAULT =');
  const endpointEnd = source.indexOf('/* ===== Instruments for local monitor', endpointStart);
  const apiStart = source.indexOf('async function apiPost(');
  const apiEnd = source.indexOf('function showSessionSetup(', apiStart);
  let request = null;
  const context = {
    URL,
    URLSearchParams,
    Set,
    Error,
    location: { hostname, search },
    localStorage: { getItem: (key) => stored[key] || null },
    window: {
      MMFAuthGate: {
        async getCurrentIdToken() {
          return 'firebase-test-token';
        },
      },
    },
    async fetch(target, options) {
      request = { target: String(target), headers: { ...options.headers } };
      return { ok: true, async json() { return { ok: true }; } };
    },
  };
  vm.runInNewContext(
    `${source.slice(endpointStart, endpointEnd)}
${source.slice(apiStart, apiEnd)}
globalThis.__requestPromise = apiPost('/api/sessions/create', {}, true);`,
    context
  );
  await context.__requestPromise;
  return request;
}

function homepageBridgeEndpoints(hostname, search, cfg = {}, stored = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ws-bridge.js'), 'utf8');
  const start = source.indexOf('const RELAY_WS_DEFAULT');
  const end = source.indexOf('async function requestJoinToken(', start);
  assert.ok(start >= 0 && end > start, 'homepage bridge endpoint resolver source must be available');
  const context = {
    URL,
    URLSearchParams,
    Set,
    window: { location: { hostname, search } },
    localStorage: {
      getItem: (key) => stored[key] || null,
      setItem(key, value) {
        stored[key] = value;
      },
    },
  };
  vm.runInNewContext(
    `${source.slice(start, end)}
globalThis.__endpoints = {
  api: buildConsoleApiBase(${JSON.stringify(cfg)}),
  ws: buildWsUrl(${JSON.stringify(cfg.relay_url || '')})
};`,
    context
  );
  return {
    api: String(context.__endpoints.api),
    ws: String(context.__endpoints.ws),
  };
}

async function homepageBridgeSessionFlow(hostname, search, stored, detail) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ws-bridge.js'), 'utf8');
  const listeners = new Map();
  const requests = [];
  const sockets = [];
  let timerId = 0;

  class TestCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  class TestWebSocket {
    static OPEN = 1;
    constructor(target) {
      this.url = String(target);
      this.readyState = TestWebSocket.OPEN;
      this.sent = [];
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    send(payload) {
      this.sent.push(String(payload));
    }
    close() {
      this.readyState = 3;
    }
  }

  const window = {
    location: { hostname, search },
    MMFAuthGate: {
      async getCurrentIdToken() {
        return 'firebase-test-token';
      },
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
  };
  const context = {
    AbortController,
    CustomEvent: TestCustomEvent,
    Error,
    Set,
    URL,
    URLSearchParams,
    WebSocket: TestWebSocket,
    clearInterval() {},
    clearTimeout() {},
    console: { debug() {}, log() {}, warn() {} },
    crypto: { randomUUID: () => 'security-test-client-uuid' },
    document: { body: null },
    localStorage: {
      getItem: (key) => stored[key] || null,
      setItem(key, value) {
        stored[key] = value;
      },
    },
    queueMicrotask,
    setInterval() {
      timerId += 1;
      return timerId;
    },
    setTimeout() {
      timerId += 1;
      return timerId;
    },
    window,
    async fetch(target, options = {}) {
      const request = { target: String(target), headers: { ...(options.headers || {}) } };
      requests.push(request);
      const isJoinTokenRequest = request.target.endsWith('/api/sessions/join-token');
      return {
        ok: true,
        status: 200,
        async json() {
          return isJoinTokenRequest
            ? { ok: true, join_token: 'security-test-join-token' }
            : { ok: true };
        },
      };
    },
  };
  vm.runInNewContext(source, context);
  window.dispatchEvent(new TestCustomEvent('session:connect', { detail }));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { requests, sockets };
}

async function assertClientEndpointSecurity() {
  const productionRelay = 'https://midimyface-relay.onrender.com';
  const productionWs = 'wss://midimyface-relay.onrender.com/ws';
  const evil = 'https://attacker.example/collect';

  assert.equal(liveRelayOrigin('midimyface.com', `?relay=${encodeURIComponent(evil)}`), productionRelay);
  assert.equal(liveRelayOrigin('www.midimyface.com', '?relay=http://localhost:9999'), productionRelay);
  assert.equal(liveRelayOrigin('localhost', '?relay=http://localhost:8787/path'), 'http://localhost:8787');
  assert.equal(liveRelayOrigin('127.0.0.1', '?relay=https://attacker.example'), productionRelay);
  assert.equal(liveRelayOrigin('[::1]', '?relay=http://[::1]:8787'), 'http://[::1]:8787');
  assert.equal(new URL(`${liveRelayOrigin('midimyface.com', `?relay=${encodeURIComponent(evil)}`)}/api/live/status`).hostname, 'midimyface-relay.onrender.com');
  const liveRequest = await liveAuthenticatedRequest('midimyface.com', `?relay=${encodeURIComponent(evil)}`);
  assert.equal(new URL(liveRequest.target).origin, productionRelay);
  assert.equal(liveRequest.headers.Authorization, 'Bearer firebase-test-token');

  assert.deepEqual(
    consoleEndpoints(
      'console.midimyface.com',
      '?ws=wss%3A%2F%2Fattacker.example%2Fws&console_api=https%3A%2F%2Fattacker.example',
      { relayURL: 'ws://localhost:9999/ws', consoleAPI: 'http://localhost:9999' }
    ),
    { relay: productionWs, api: productionRelay }
  );
  assert.deepEqual(
    consoleEndpoints('localhost', '?ws=ws%3A%2F%2Flocalhost%3A8787%2Fws&console_api=http%3A%2F%2F127.0.0.1%3A8787%2Fapi'),
    { relay: 'ws://localhost:8787/ws', api: 'http://127.0.0.1:8787' }
  );
  assert.deepEqual(
    consoleEndpoints('127.0.0.1', '', { relayURL: 'ws://127.0.0.1:8787/ws', consoleAPI: 'http://localhost:8787' }),
    { relay: 'ws://127.0.0.1:8787/ws', api: 'http://localhost:8787' }
  );
  assert.deepEqual(
    consoleEndpoints('localhost', '?ws=wss%3A%2F%2Fattacker.example%2Fws&console_api=javascript%3Aalert(1)'),
    { relay: productionWs, api: productionRelay }
  );
  const consoleRequest = await consoleAuthenticatedRequest(
    'console.midimyface.com',
    '?console_api=https%3A%2F%2Fattacker.example',
    { consoleAPI: 'https://attacker.example' }
  );
  assert.equal(new URL(consoleRequest.target).origin, productionRelay);
  assert.equal(consoleRequest.headers.Authorization, 'Bearer firebase-test-token');

  const productionBridge = { api: productionRelay, ws: productionWs };
  assert.deepEqual(
    homepageBridgeEndpoints('midimyface.com', '?console_api=https%3A%2F%2Fevil.example'),
    productionBridge
  );
  assert.deepEqual(
    homepageBridgeEndpoints('midimyface.com', '', { console_api: 'https://evil.example' }),
    productionBridge
  );
  assert.deepEqual(
    homepageBridgeEndpoints('midimyface.com', '', {}, { mmf_console_api: 'https://evil.example' }),
    productionBridge
  );
  assert.deepEqual(
    homepageBridgeEndpoints('www.midimyface.com', '', { relay_url: 'wss://evil.example/ws' }),
    productionBridge
  );
  assert.deepEqual(
    homepageBridgeEndpoints(
      'localhost',
      '?console_api=http%3A%2F%2F127.0.0.1%3A8787',
      { relay_url: 'ws://localhost:8787/ws' }
    ),
    { api: 'http://127.0.0.1:8787', ws: 'ws://localhost:8787/ws' }
  );
  assert.deepEqual(
    homepageBridgeEndpoints(
      'localhost',
      '?console_api=https%3A%2F%2Fevil.example',
      { relay_url: 'wss://evil.example/ws' },
      { mmf_console_api: 'http://localhost:8787' }
    ),
    productionBridge
  );

  const productionFlow = await homepageBridgeSessionFlow(
    'midimyface.com',
    '?console_api=https%3A%2F%2Fevil.example&invite_token=security-test-invite',
    { mmf_console_api: 'https://evil.example' },
    { session_id: 'SECURE', password: 'test', name: 'Performer', relay_url: 'wss://evil.example/ws' }
  );
  const productionJoinRequest = productionFlow.requests.find((request) => request.headers.Authorization);
  assert.equal(productionJoinRequest.target, `${productionRelay}/api/sessions/join-token`);
  assert.equal(productionJoinRequest.headers.Authorization, 'Bearer firebase-test-token');
  assert.equal(productionFlow.sockets.length, 1);
  assert.equal(productionFlow.sockets[0].url, productionWs);
  const productionHello = productionFlow.sockets[0].sent.map(JSON.parse).find((message) => message.type === 'hello');
  assert.equal(productionHello.join_token, 'security-test-join-token');

  const localFlow = await homepageBridgeSessionFlow(
    'localhost',
    '?console_api=http%3A%2F%2Flocalhost%3A8787',
    {},
    { session_id: 'LOCAL', password: 'test', name: 'Performer', relay_url: 'ws://127.0.0.1:8787/ws' }
  );
  const localJoinRequest = localFlow.requests.find((request) => request.headers.Authorization);
  assert.equal(localJoinRequest.target, 'http://localhost:8787/api/sessions/join-token');
  assert.equal(localFlow.sockets.length, 1);
  assert.equal(localFlow.sockets[0].url, 'ws://127.0.0.1:8787/ws');
  const localHello = localFlow.sockets[0].sent.map(JSON.parse).find((message) => message.type === 'hello');
  assert.equal(localHello.join_token, 'security-test-join-token');
}

function assertConsoleNameRendering() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'console', 'index.html'), 'utf8');
  assert.match(source, /<span class="nm" data-participant-name><\/span>/);
  assert.match(source, /participantName\.textContent = p\.name \|\| p\.id/);
  assert.doesNotMatch(source, /<span class="nm">\$\{p\.name\|\|p\.id\}<\/span>/);
  assert.match(source, /if\(nameEl\) nameEl\.textContent = item\.name/);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`relay did not start\n${childOutput}`);
}

function connectWebSocket(wsUrl, origin) {
  return new Promise((resolve, reject) => {
    const options = origin === undefined ? {} : { headers: { Origin: origin } };
    const socket = new WebSocket(wsUrl, options);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function expectWebSocketRejection(wsUrl, origin, expectedStatus = 403) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { headers: { Origin: origin } });
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`websocket rejection timeout for ${origin}`));
    }, 2500);
    socket.once('open', () => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error(`websocket unexpectedly accepted ${origin}`));
    });
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timeout);
      const status = response.statusCode;
      response.destroy();
      try {
        assert.equal(status, expectedStatus);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', () => {});
  });
}

function waitForWsMessage(socket, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('websocket message timeout'));
    }, timeoutMs);
    const onMessage = (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
  });
}

function signJoinToken({ sessionId, role, name }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    type: 'relay_join',
    sid: sessionId,
    role,
    name,
    maxp: 10,
    firebase_uid: `security-test-${role}`,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const signature = crypto.createHmac('sha256', relaySecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function assertOriginAndNameSecurity(port) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const localOrigin = baseUrl;
  const acceptedOrigins = [
    'https://midimyface.com',
    'https://www.midimyface.com',
    'https://console.midimyface.com',
    'https://ricardoarbizaroverano.github.io',
    localOrigin,
  ];
  const rejectedOrigins = [
    'https://midimyface.com.attacker.example',
    'https://midimyface.com-attacker.example',
    'https://www.midimyface.com.evil.example',
    'https://console.midimyface.com.attacker.example',
    'https://midimyface.com@evil.example',
    'https://evil.example/?next=https://midimyface.com',
    'https://midimyface.com:444',
    `http://127.0.0.1:${port + 1}`,
    'null',
    'not a valid origin',
  ];

  for (const origin of acceptedOrigins) {
    for (const pathname of ['/health', '/api/live/status']) {
      const response = await fetch(`${baseUrl}${pathname}`, { headers: { Origin: origin } });
      assert.equal(response.headers.get('access-control-allow-origin'), new URL(origin).origin);
    }
  }
  for (const origin of rejectedOrigins) {
    for (const pathname of ['/health', '/api/live/status']) {
      const response = await fetch(`${baseUrl}${pathname}`, { headers: { Origin: origin } });
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
  }
  const originless = await fetch(`${baseUrl}/health`);
  assert.equal(originless.status, 200);
  assert.equal(originless.headers.get('access-control-allow-origin'), null);

  const maliciousBoot = await fetch(`${baseUrl}/api/boot`, {
    headers: { Origin: 'https://midimyface.com.attacker.example' },
  });
  assert.equal(maliciousBoot.status, 403);
  assert.equal(maliciousBoot.headers.get('access-control-allow-origin'), null);
  const validBoot = await fetch(`${baseUrl}/api/boot`, {
    headers: { Origin: 'https://midimyface.com' },
  });
  assert.equal(validBoot.status, 200);
  assert.equal(validBoot.headers.get('access-control-allow-origin'), 'https://midimyface.com');

  const allowedSocket = await connectWebSocket(wsUrl, localOrigin);
  allowedSocket.close();
  const originlessSocket = await connectWebSocket(wsUrl);
  originlessSocket.close();
  await expectWebSocketRejection(wsUrl, 'https://midimyface.com.attacker.example');
  await expectWebSocketRejection(wsUrl, `http://127.0.0.1:${port + 1}`);
  await expectWebSocketRejection(wsUrl, 'null');

  const sessionId = 'SECURITY';
  const host = await connectWebSocket(wsUrl, localOrigin);
  const hostReady = waitForWsMessage(host, (message) => message.type === 'joined');
  host.send(JSON.stringify({
    type: 'hello',
    session_id: sessionId,
    role: 'host',
    name: 'Host',
    join_token: signJoinToken({ sessionId, role: 'host', name: 'Host' }),
  }));
  await hostReady;

  const performerSockets = [];
  const cases = [
    { raw: 'Normal User', expected: 'Normal User' },
    { raw: 'Árbol', expected: 'Árbol' },
    { raw: '日本', expected: '日本' },
    { raw: '<img src=x onerror="globalThis.__xss=1">', expected: '<img src=x onerror="globalThis._' },
    { raw: '<svg onload="globalThis.__xss=1">', expected: '<svg onload="globalThis.__xss=1"' },
    { raw: '"><script>globalThis.__xss=1</script>', expected: '"><script>globalThis.__xss=1</sc' },
    { raw: 'Ａlice\u202E🙂', expected: 'Alice🙂' },
    { raw: 'Zero\u200BWidth', expected: 'ZeroWidth' },
  ];
  for (const item of cases) {
    const performer = await connectWebSocket(wsUrl, localOrigin);
    performerSockets.push(performer);
    const hostNotice = waitForWsMessage(
      host,
      (message) => message.type === 'session/joined' && message.data?.name === item.expected
    );
    const performerReady = waitForWsMessage(performer, (message) => message.type === 'joined');
    performer.send(JSON.stringify({
      type: 'hello',
      session_id: sessionId,
      role: 'performer',
      name: item.raw,
      join_token: signJoinToken({ sessionId, role: 'performer', name: item.raw }),
    }));
    await Promise.all([hostNotice, performerReady]);
  }

  const emptyNameSocket = await connectWebSocket(wsUrl, localOrigin);
  const missingFields = waitForWsMessage(
    emptyNameSocket,
    (message) => message.type === 'error' && message.error === 'missing_fields'
  );
  const hiddenOnlyName = '\u0000\u202E\u200B';
  emptyNameSocket.send(JSON.stringify({
    type: 'hello',
    session_id: sessionId,
    role: 'performer',
    name: hiddenOnlyName,
    join_token: signJoinToken({ sessionId, role: 'performer', name: hiddenOnlyName }),
  }));
  await missingFields;
  emptyNameSocket.close();
  performerSockets.forEach((socket) => socket.close());
  host.close();
}

async function run() {
  await assertClientEndpointSecurity();
  assertConsoleNameRendering();

  const port = await getFreePort();
  const localOrigin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      ALLOWED_ORIGINS: [
        'https://midimyface.com',
        'https://www.midimyface.com',
        'https://console.midimyface.com',
        'https://ricardoarbizaroverano.github.io',
        localOrigin,
      ].join(','),
      REQUIRE_JOIN_TOKEN: 'true',
      RELAY_JOIN_TOKEN_SECRET: relaySecret,
      CONSOLE_API_ENABLED: 'false',
      LIVE_REQUIRE_FIREBASE_AUTH: 'false',
      LIVE_STATE_FILE: stateFile,
      MMF_SECRET_KEY: 'a'.repeat(64),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { childOutput += String(chunk); });
  child.stderr.on('data', (chunk) => { childOutput += String(chunk); });

  await waitForServer(localOrigin);
  await assertOriginAndNameSecurity(port);
  console.log('Security regression tests passed.');
}

run()
  .catch((error) => {
    console.error(childOutput);
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await fsPromises.unlink(stateFile).catch(() => {});
  });
