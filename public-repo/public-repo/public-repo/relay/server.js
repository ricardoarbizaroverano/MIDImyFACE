// server.js
// MIDImyFACE WebSocket Relay — Render-ready
// Listens on process.env.PORT, binds 0.0.0.0, exposes /health (+ CORS) and WS at WS_PATH.

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

function loadLocalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile(path.join(__dirname, '.env.local'));

/* ========================
   Config (env-overridable)
   ======================== */
const PORT         = process.env.PORT || 3000;
const WS_PATH      = process.env.WS_PATH || '/ws';
const MAX_CHANNELS = Number(process.env.MAX_CHANNELS || 16);
const REQUIRE_JOIN_TOKEN = String(process.env.REQUIRE_JOIN_TOKEN || 'true').toLowerCase() !== 'false';
const RELAY_JOIN_TOKEN_SECRET = process.env.RELAY_JOIN_TOKEN_SECRET || '';

// Console API (served from this same process)
const CONSOLE_API_ENABLED            = String(process.env.CONSOLE_API_ENABLED || 'true').toLowerCase() !== 'false';
const INVITE_TOKEN_SECRET            = process.env.INVITE_TOKEN_SECRET            || '';
const AUTH_TOKEN_SECRET              = process.env.AUTH_TOKEN_SECRET              || '';
const DEFAULT_ADMIN_USERNAME         = process.env.TEST_ADMIN_USERNAME             || '';
const DEFAULT_ADMIN_PASSWORD         = process.env.TEST_ADMIN_PASSWORD             || '';
const DEFAULT_ADMIN_MAX_PARTICIPANTS = Number(process.env.TEST_ADMIN_MAX_PARTICIPANTS || 50);
const MIDIMYFACE_JOIN_URL            = process.env.MIDIMYFACE_JOIN_URL             || 'https://midimyface.com';
const PUBLIC_BASE_URL                = process.env.PUBLIC_BASE_URL                 || 'https://midimyface-relay.onrender.com';

// Comma-separated list like:
// "https://midimyface.com,https://www.midimyface.com,http://127.0.0.1:5500"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const NODE_ENV = String(process.env.NODE_ENV || 'development').toLowerCase();

function ensureSecureConfig() {
  const missing = [];
  if (REQUIRE_JOIN_TOKEN && !RELAY_JOIN_TOKEN_SECRET) missing.push('RELAY_JOIN_TOKEN_SECRET');
  if (CONSOLE_API_ENABLED) {
    if (!INVITE_TOKEN_SECRET) missing.push('INVITE_TOKEN_SECRET');
    if (!AUTH_TOKEN_SECRET) missing.push('AUTH_TOKEN_SECRET');
    if (!DEFAULT_ADMIN_USERNAME) missing.push('TEST_ADMIN_USERNAME');
    if (!DEFAULT_ADMIN_PASSWORD) missing.push('TEST_ADMIN_PASSWORD');
  }
  if (missing.length > 0) {
    throw new Error(`[security] missing required env vars: ${missing.join(', ')}`);
  }

  if (NODE_ENV === 'production') {
    const insecureDefaults = new Set([
      'dev-relay-secret-change-me',
      'dev-invite-secret-change-me',
      'dev-auth-secret-change-me',
      'changeme123',
      'admin',
    ]);

    const weak = [];
    if (insecureDefaults.has(RELAY_JOIN_TOKEN_SECRET) || RELAY_JOIN_TOKEN_SECRET.length < 24) weak.push('RELAY_JOIN_TOKEN_SECRET');
    if (insecureDefaults.has(INVITE_TOKEN_SECRET) || INVITE_TOKEN_SECRET.length < 24) weak.push('INVITE_TOKEN_SECRET');
    if (insecureDefaults.has(AUTH_TOKEN_SECRET) || AUTH_TOKEN_SECRET.length < 24) weak.push('AUTH_TOKEN_SECRET');
    if (insecureDefaults.has(DEFAULT_ADMIN_PASSWORD) || DEFAULT_ADMIN_PASSWORD.length < 12) weak.push('TEST_ADMIN_PASSWORD');
    if (ALLOWED_ORIGINS.includes('*')) weak.push('ALLOWED_ORIGINS (wildcard not allowed in production)');

    if (weak.length > 0) {
      throw new Error(`[security] insecure production config: ${weak.join(', ')}`);
    }
  }
}

ensureSecureConfig();

/* ========
   Helpers
   ======== */
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const nowMs  = () => Date.now();
const nowSec = () => Math.floor(Date.now() / 1000);
const genId  = () =>
  (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));

function verifySignedToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  if (signature !== expected) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (parsed.exp && nowSec() > Number(parsed.exp)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function originAllowed(origin) {
  // Allow if Origin missing (health checks, curl) or '*' present.
  if (!origin || ALLOWED_ORIGINS.includes('*')) return true;
  // Starts-with match so scheme+host (and optional port) are enough.
  return ALLOWED_ORIGINS.some(o => o && origin.startsWith(o));
}

/* ============================
   Console API helpers
   ============================ */
function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function signToken(payload, secret) {
  const h   = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const p   = b64urlJson(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}
const randomId       = (n = 12) => crypto.randomBytes(n).toString('base64url');
const randomSid      = ()       => crypto.randomBytes(4).toString('hex').toUpperCase();
const randomPassword = ()       => crypto.randomBytes(6).toString('base64url').slice(0, 10);

function createInviteToken({ sessionId, maxParticipants }) {
  return signToken({ type: 'invite', sid: sessionId, maxp: maxParticipants, iat: nowSec(), exp: nowSec() + 86400, jti: randomId(8) }, INVITE_TOKEN_SECRET);
}
function createAuthToken({ username }) {
  return signToken({ type: 'host_auth', sub: username, iat: nowSec(), exp: nowSec() + 43200, jti: randomId(8) }, AUTH_TOKEN_SECRET);
}
function createRelayJoinToken({ sessionId, role, name, maxParticipants, clientUuid }) {
  return signToken({
    type: 'relay_join', sid: sessionId, role, name,
    maxp: maxParticipants, client_uuid: clientUuid || null,
    iat: nowSec(), exp: nowSec() + 1800, jti: randomId(8),
  }, RELAY_JOIN_TOKEN_SECRET);
}

const consoleUsers    = new Map();
const consoleSessions = new Map();

function ensureDefaultAdmin() {
  if (!consoleUsers.has(DEFAULT_ADMIN_USERNAME)) {
    consoleUsers.set(DEFAULT_ADMIN_USERNAME, {
      username: DEFAULT_ADMIN_USERNAME,
      passwordHash: sha256(DEFAULT_ADMIN_PASSWORD),
      tierMaxParticipants: DEFAULT_ADMIN_MAX_PARTICIPANTS,
      isAdmin: true,
    });
  }
}
ensureDefaultAdmin();

function parseConsoleAuth(req) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const pl    = verifySignedToken(token, AUTH_TOKEN_SECRET);
  if (!pl || pl.type !== 'host_auth' || !pl.sub) return null;
  return consoleUsers.get(pl.sub) || null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const CONSOLE_CORS_ORIGINS = [
  'https://ricardoarbizaroverano.github.io',
  'https://console.midimyface.com',
  'https://midimyface.com',
  'https://www.midimyface.com',
];
function apiCors(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
  if (ALLOWED_ORIGINS.includes('*') || !origin) {
    return { ...headers, 'Access-Control-Allow-Origin': '*' };
  }
  if (ALLOWED_ORIGINS.some(o => origin.startsWith(o)) || CONSOLE_CORS_ORIGINS.some(o => origin.startsWith(o))) {
    return { ...headers, 'Access-Control-Allow-Origin': origin };
  }
  return headers;
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
function sendText(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain', ...headers });
  res.end(body);
}

/* ===========================
   In-memory session registry
   =========================== */
/**
 * sessions: {
 *   [session_id]: {
 *     maxParticipants: number,
 *     createdAt: number,
 *     hostId: string | null,
 *     participants: Map<participantId, Participant>,
 *     clientMap: Map<client_uuid, participantId>,
 *     channelMap: Map<participantId, number>,
 *     stickyByClient: Map<client_uuid, number>,
 *   }
 * }
 *
 * Participant = {
 *   id, role: 'host' | 'performer', name, client_uuid, ws, connectedAt
 * }
 */
const sessions = Object.create(null);

function getOrCreateSession(session_id, maxParticipantsHint) {
  if (!sessions[session_id]) {
    sessions[session_id] = {
      maxParticipants: Number(maxParticipantsHint || 10),
      createdAt: nowMs(),
      hostId: null,
      participants: new Map(),
      clientMap: new Map(),
      channelMap: new Map(),
      stickyByClient: new Map(),
    };
    return { session: sessions[session_id], created: true };
  }
  if (maxParticipantsHint) {
    sessions[session_id].maxParticipants = Number(maxParticipantsHint) || sessions[session_id].maxParticipants;
  }
  return { session: sessions[session_id], created: false };
}

function connectedPerformerCount(session) {
  let count = 0;
  for (const p of session.participants.values()) {
    if (p.role === 'performer') count += 1;
  }
  return count;
}

function firstFreeChannel(session) {
  const used = new Set(session.channelMap.values());
  for (let c = 1; c <= MAX_CHANNELS; c++) {
    if (!used.has(c)) return c;
  }
  return null;
}

function assignChannel(session, participant) {
  // Sticky channel by client_uuid if available
  if (participant.client_uuid) {
    const sticky = session.stickyByClient.get(participant.client_uuid);
    if (sticky) {
      const taken = [...session.channelMap.values()].includes(sticky);
      if (!taken) return sticky;
    }
  }
  return firstFreeChannel(session);
}

function notifyHost(session, type, data) {
  const hostId = session.hostId;
  if (!hostId) return;
  const host = session.participants.get(hostId);
  if (host && host.ws && host.ws.readyState === 1) {
    host.ws.send(JSON.stringify({ type, data, ts_server: nowMs() }));
  }
}

function sendTo(ws, payload) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToHost(session, fromParticipantId, type, data) {
  const channel = session.channelMap.get(fromParticipantId) || null;
  const participant = session.participants.get(fromParticipantId);
  notifyHost(session, type, {
       ...data,                          // keep gesture payload intact (including data.name = gesture)
       from: fromParticipantId,
       channel,
      performer_id: fromParticipantId,  // new explicit fields
      performer_name: participant?.name || null
     });
}


function cleanupParticipant(session, participantId) {
  const p = session.participants.get(participantId);
  if (!p) return;

  const ch = session.channelMap.get(participantId);
  session.channelMap.delete(participantId);
  session.participants.delete(participantId);

  if (p.role === 'host' && session.hostId === participantId) {
    session.hostId = null;
  }

  notifyHost(session, 'session/left', {
    participant_id: participantId,
    channel: ch || null,
    name: p.name
  });
}

/* ============
   Periodic GC
   ============ */
setInterval(() => {
  for (const [sid, sess] of Object.entries(sessions)) {
    if (sess.participants.size === 0) {
      delete sessions[sid];
      console.log('[relay] GC removed empty session:', sid);
    }
  }
}, 60_000);

/* =================
   HTTP Health/Info (+ CORS)
   ================= */
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const origin = req.headers.origin || '';

  // CORS headers (reflect allowed origin, or * if configured)
  const allowStar = ALLOWED_ORIGINS.includes('*');
  const cors = allowStar
    ? { 'Access-Control-Allow-Origin': '*' }
    : (originAllowed(origin) ? { 'Access-Control-Allow-Origin': origin } : {});
  const base = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight
  if (req.method === 'OPTIONS') {
    if (CONSOLE_API_ENABLED && parsed.pathname.startsWith('/api/')) {
      const c = apiCors(origin);
      res.writeHead(204, c);
      res.end();
      return;
    }
    res.writeHead(204, { ...base, ...cors });
    res.end();
    return;
  }

  if (parsed.pathname === '/health' || parsed.pathname === '/.well-known/health') {
    return sendJson(res, 200, { ok: true, time: new Date().toISOString(), ws_path: WS_PATH }, { ...base, ...cors });
  }

  if (parsed.pathname === '/') {
    return sendText(
      res,
      200,
      `MIDImyFACE Relay: OK
Use WebSocket at ${WS_PATH}
Allowed origins: ${ALLOWED_ORIGINS.join(', ') || '(none)'}
`,
      { ...base, ...cors }
    );
  }

  /* ─── Console API ─── */
  if (CONSOLE_API_ENABLED && parsed.pathname.startsWith('/api/')) {
    const c = apiCors(origin);
    if (req.method === 'OPTIONS') { res.writeHead(204, c); res.end(); return; }

    if (req.method === 'POST' && parsed.pathname === '/api/auth/login') {
      try {
        const body = await readBody(req);
        const user = consoleUsers.get(String(body.username || '').trim());
        if (!user || user.passwordHash !== sha256(String(body.password || ''))) {
          return sendJson(res, 401, { ok: false, error: 'invalid_credentials' }, c);
        }
        return sendJson(res, 200, { ok: true, token: createAuthToken({ username: user.username }), user: { username: user.username, tierMaxParticipants: user.tierMaxParticipants, isAdmin: user.isAdmin } }, c);
      } catch { return sendJson(res, 400, { ok: false, error: 'invalid_json' }, c); }
    }

    if (req.method === 'POST' && parsed.pathname === '/api/sessions/create') {
      const authUser = parseConsoleAuth(req);
      if (!authUser) return sendJson(res, 401, { ok: false, error: 'unauthorized' }, c);
      try {
        const body = await readBody(req);
        const maxp = Math.max(1, Math.min(Number(body.max_participants || 10), authUser.tierMaxParticipants));
        const sid  = randomSid();
        const pwd  = String(body.session_password || '').trim() || randomPassword();
        consoleSessions.set(sid, { sessionId: sid, passwordHash: sha256(pwd), maxParticipants: maxp, createdBy: authUser.username, createdAt: Date.now() });
        const invToken      = createInviteToken({ sessionId: sid, maxParticipants: maxp });
        const hostJoinToken = createRelayJoinToken({ sessionId: sid, role: 'host', name: `Host:${authUser.username}`, maxParticipants: maxp });
        const inviteUrl     = `${MIDIMYFACE_JOIN_URL}?session_id=${encodeURIComponent(sid)}&invite_token=${encodeURIComponent(invToken)}&console_api=${encodeURIComponent(PUBLIC_BASE_URL)}`;
        return sendJson(res, 200, { ok: true, session: { session_id: sid, session_password: pwd, max_participants: maxp, invite_token: invToken, invite_url: inviteUrl, host_join_token: hostJoinToken } }, c);
      } catch { return sendJson(res, 400, { ok: false, error: 'invalid_json' }, c); }
    }

    if (req.method === 'POST' && parsed.pathname === '/api/sessions/join-token') {
      try {
        const body     = await readBody(req);
        const name     = String(body.name || '').trim().slice(0, 40);
        const cUuid    = String(body.client_uuid || '').trim() || null;
        const invToken = String(body.invite_token || '').trim();
        let   sid      = String(body.session_id || '').trim();
        if (!name) return sendJson(res, 400, { ok: false, error: 'missing_name' }, c);
        if (invToken) {
          const inv = verifySignedToken(invToken, INVITE_TOKEN_SECRET);
          if (!inv || inv.type !== 'invite' || !inv.sid) return sendJson(res, 401, { ok: false, error: 'invalid_invite' }, c);
          sid = inv.sid;
        }
        if (!sid || !consoleSessions.has(sid)) return sendJson(res, 404, { ok: false, error: 'session_not_found' }, c);
        const session = consoleSessions.get(sid);
        if (!invToken && sha256(String(body.password || '')) !== session.passwordHash) {
          return sendJson(res, 401, { ok: false, error: 'bad_session_password' }, c);
        }
        const joinToken = createRelayJoinToken({ sessionId: sid, role: 'performer', name, maxParticipants: session.maxParticipants, clientUuid: cUuid });
        return sendJson(res, 200, { ok: true, join_token: joinToken, session_id: sid, max_participants: session.maxParticipants }, c);
      } catch { return sendJson(res, 400, { ok: false, error: 'invalid_json' }, c); }
    }

    if (req.method === 'POST' && parsed.pathname === '/api/sessions/host-join-token') {
      const authUser = parseConsoleAuth(req);
      if (!authUser) return sendJson(res, 401, { ok: false, error: 'unauthorized' }, c);
      try {
        const body    = await readBody(req);
        const session = consoleSessions.get(String(body.session_id || ''));
        if (!session) return sendJson(res, 404, { ok: false, error: 'session_not_found' }, c);
        if (session.createdBy !== authUser.username && !authUser.isAdmin) return sendJson(res, 403, { ok: false, error: 'forbidden' }, c);
        return sendJson(res, 200, { ok: true, host_join_token: createRelayJoinToken({ sessionId: session.sessionId, role: 'host', name: `Host:${authUser.username}`, maxParticipants: session.maxParticipants }) }, c);
      } catch { return sendJson(res, 400, { ok: false, error: 'invalid_json' }, c); }
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' }, c);
  }

  return sendText(res, 404, 'Not Found', { ...base, ...cors });
});

/* =================
   WebSocket Server
   ================= */
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = url.parse(req.url);
  const origin = req.headers.origin || null;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (pathname !== WS_PATH) {
    console.warn('[relay] rejecting WS: wrong path', { got: pathname, expected: WS_PATH, ip });
    try { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); } catch {}
    socket.destroy();
    return;
  }

  if (!originAllowed(origin)) {
    console.warn('[relay] rejecting WS: bad Origin', { origin, allowed: ALLOWED_ORIGINS, ip });
    try { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); } catch {}
    socket.destroy();
    return;
  }

  console.log('[relay] upgrade OK', { origin, ip });
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws._participant = null; // filled after hello/join

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); }
    catch {
      sendTo(ws, { type: 'error', error: 'invalid_json' });
      return;
    }

    const t = msg?.type;

    // Expect initial hello/join
    if (!ws._participant) {
      if (t !== 'hello' && t !== 'join') {
        sendTo(ws, { type: 'error', error: 'expected_hello_or_join_first' });
        return;
      }

      const {
        session_id,
        role: rawRole,
        name,
        client_uuid,
        join_token,
      } = msg || {};

      if (!session_id || !name) {
        sendTo(ws, { type: 'error', error: 'missing_fields' });
        return;
      }

      const tokenPayload = join_token
        ? verifySignedToken(join_token, RELAY_JOIN_TOKEN_SECRET)
        : null;

      if (REQUIRE_JOIN_TOKEN && !tokenPayload) {
        sendTo(ws, { type: 'error', error: 'missing_or_invalid_join_token' });
        return;
      }

      if (tokenPayload) {
        if (tokenPayload.type !== 'relay_join' || tokenPayload.sid !== session_id) {
          sendTo(ws, { type: 'error', error: 'invalid_join_token_scope' });
          return;
        }
        if (tokenPayload.name && String(tokenPayload.name).slice(0, 32) !== String(name).slice(0, 32)) {
          sendTo(ws, { type: 'error', error: 'join_token_name_mismatch' });
          return;
        }
      }

      const roleFromToken = tokenPayload?.role;
      const effectiveRole = (roleFromToken === 'host' || roleFromToken === 'performer')
        ? roleFromToken
        : ((rawRole === 'host' || rawRole === 'performer') ? rawRole : 'performer');

      // Create/get session BEFORE using it anywhere
      const createRes = getOrCreateSession(session_id, tokenPayload?.maxp || null);
      const session   = createRes.session;
      const created   = createRes.created;

      // If this client_uuid is already connected, drop the old participant first
            // Reconnect path: if this client_uuid already exists, REUSE the same participant id
            if (client_uuid) {
              const existingId = session.clientMap.get(client_uuid);
              if (existingId && session.participants.has(existingId)) {
                const prev = session.participants.get(existingId);
      
                // Detach old socket so its 'close' handler won't clean up this participant
                if (prev.ws) {
                  try { prev.ws._participant = null; } catch {}
                  try { prev.ws.close(4001, 'replaced'); } catch {}
                }
      
                // Swap in the new socket and refresh timestamps
                prev.ws = ws;
                prev.connectedAt = nowMs();
                ws._participant = prev;
      
                // Ack to performer with SAME participant_id + existing channel
                const chExisting = session.channelMap.get(existingId) || null;
                sendTo(ws, {
                  type: 'joined',
                  data: {
                    role: prev.role || 'performer',
                    session_id,
                    participant_id: existingId,
                    channel: chExisting
                  },
                  ts_server: nowMs(),
                });
      
                // Tell host (using same event shape your console already handles)
                notifyHost(session, 'session/joined', {
                  participant_id: existingId,
                  name: prev.name,
                  channel: chExisting
                });
      
                return; // short-circuit — do NOT create a new participant
              }
            }
      

      const role = effectiveRole;
      const participantId = genId();
      const participant = {
        id: participantId,
        role,
        name: String(name).slice(0, 32),
        client_uuid: client_uuid || null,
        ws,
        connectedAt: nowMs(),
      };

      session.participants.set(participantId, participant);
      if (participant.client_uuid) {
        session.clientMap.set(participant.client_uuid, participantId);
      }

      console.log('[relay] joined:', {
        session_id,
        role,
        name: participant.name,
        participant_id: participantId,
        client_uuid: participant.client_uuid || '(none)'
      });

      if (role === 'host') {
        session.hostId = participantId;
        ws._participant = participant;

        // Ack host
        sendTo(ws, {
          type: 'joined', // client accepts: joined|ok|welcome
          data: { role: 'host', session_id, created },
          ts_server: nowMs(),
        });

        // Send current roster of performers
        const roster = [];
        for (const [pid, p] of session.participants.entries()) {
          if (p.role === 'performer') {
            roster.push({
              participant_id: pid,
              name: p.name,
              channel: session.channelMap.get(pid) || null
            });
          }
        }
        sendTo(ws, { type: 'session/roster', data: roster, ts_server: nowMs() });
        return;
      }

      // Performer participant cap enforcement (tier)
      const maxAllowed = Number(session.maxParticipants || 10);
      const connectedCount = connectedPerformerCount(session);
      if (connectedCount > maxAllowed) {
        session.participants.delete(participantId);
        if (participant.client_uuid) session.clientMap.delete(participant.client_uuid);
        sendTo(ws, {
          type: 'server/reject',
          data: { reason: 'session_full', max_participants: maxAllowed }
        });
        try { ws.close(1008, 'session_full'); } catch {}
        return;
      }

      // Performer: assign MIDI channel
      const ch = assignChannel(session, participant);
      if (!ch) {
        sendTo(ws, { type: 'server/reject', data: { reason: 'no_channels' } });
        try { ws.close(1008, 'no_channels'); } catch {}
      } else {      
        session.channelMap.set(participantId, ch);
        if (participant.client_uuid) session.stickyByClient.set(participant.client_uuid, ch);
      }

      ws._participant = participant;

      // Ack to performer
      sendTo(ws, {
        type: 'joined',
        data: {
          role: 'performer',
          session_id,
          participant_id: participantId,
          channel: ch || null,
        },
        ts_server: nowMs(),
      });

      // Notify host of new performer
      notifyHost(session, 'session/joined', {
        participant_id: participantId,
        name: participant.name,
        channel: ch || null,
      });

      return;
    }

    // From here on, participant is known
    const participant = ws._participant;
    const session_id = Object.entries(sessions).find(([, s]) => s.participants.has(participant.id))?.[0];
    if (!session_id) { sendTo(ws, { type: 'error', error: 'session_not_found' }); return; }
    const session = sessions[session_id];

    // Heartbeat from client
    if (t === 'system/ping') {
      sendTo(ws, { type: 'system/pong', ts_server: nowMs(), echo: msg?.data || null });
      return;
    }

    // Host → Performer control (server/*)
    if (participant.role === 'host' && t?.startsWith('server/')) {
      const toId = msg?.to;
      if (!toId) { sendTo(ws, { type: 'error', error: 'missing_to' }); return; }
      const dest = session.participants.get(toId);
      if (!dest) { sendTo(ws, { type: 'error', error: 'participant_not_found' }); return; }

      if (t === 'server/assign') {
        const newCh = Number(msg?.data?.midi_channel);
        if (!newCh || newCh < 1 || newCh > MAX_CHANNELS) {
          sendTo(ws, { type: 'error', error: 'invalid_channel' });
          return;
        }
        const takenBy = [...session.channelMap.entries()].find(([, ch]) => ch === newCh)?.[0];
        if (takenBy && takenBy !== toId) {
          sendTo(ws, { type: 'error', error: 'channel_in_use' });
          return;
        }
        session.channelMap.set(toId, newCh);
        if (dest.client_uuid) session.stickyByClient.set(dest.client_uuid, newCh);

        sendTo(dest.ws, { type: 'server/assigned', data: { channel: newCh }, ts_server: nowMs() });
        notifyHost(session, 'server/assigned', { participant_id: toId, channel: newCh });
        return;
      }

      // Pass-through any other server/* command
      sendTo(dest.ws, { type: t, data: msg?.data || {}, ts_server: nowMs() });
      return;
    }

    // Performer → Host relay (music / gestures)
    const relayTypes = new Set([
      'gesture/update',
      'midi/cc',
      'midi/note_on',
      'midi/note_off',
      'face/landmarks',
      'percussion/trigger',
      'envelope/update',
      'mode/change',
    ]);
    if (relayTypes.has(t)) {
      broadcastToHost(session, participant.id, t, msg.data || {});
      return;
    }

    // Unknown type
    sendTo(ws, { type: 'error', error: 'unknown_type', got: t });
  });

  ws.on('close', (code, reasonBuf) => {
    const reason = (() => {
      try { return reasonBuf?.toString?.() || ''; } catch { return ''; }
    })();
    const p = ws._participant;
    if (!p) return;

    for (const [sid, sess] of Object.entries(sessions)) {
      if (sess.participants.has(p.id)) {
        console.log('[relay] disconnected:', {
          session_id: sid, participant_id: p.id, role: p.role, code, reason
        });
        cleanupParticipant(sess, p.id);
        break;
      }
    }
  });

  ws.on('error', (err) => {
    console.error('[relay] WS error:', err?.message || err);
  });
});

/* =========================
   WS Heartbeat (server→all)
   ========================= */
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      return;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 30_000);

server.on('close', () => clearInterval(interval));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP listening on :${PORT}`);
  console.log(`WebSocket path: ${WS_PATH}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ') || '(none)'}`);
});
