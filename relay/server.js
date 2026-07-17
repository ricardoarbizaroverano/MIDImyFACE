// server.js
// MIDImyFACE WebSocket Relay — Render-ready
// Listens on process.env.PORT, binds 0.0.0.0, exposes /health (+ CORS) and WS at WS_PATH.

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

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
loadLocalEnvFile(path.join(__dirname, '.env'));
loadLocalEnvFile(path.join(__dirname, '..', '.env'));

function configuredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value || /(PASTE_|REPLACE_|YOUR_)/i.test(value)) return '';
  return value;
}

/* ========================
   Config (env-overridable)
   ======================== */
const PORT         = process.env.PORT || 3000;
const WS_PATH      = process.env.WS_PATH || '/ws';
const MAX_CHANNELS = Number(process.env.MAX_CHANNELS || 16);
const REQUIRE_JOIN_TOKEN = String(process.env.REQUIRE_JOIN_TOKEN || 'true').toLowerCase() !== 'false';
const RELAY_JOIN_TOKEN_SECRET = configuredEnv('RELAY_JOIN_TOKEN_SECRET');

// Console API (served from this same process)
const CONSOLE_API_ENABLED            = String(process.env.CONSOLE_API_ENABLED || 'true').toLowerCase() !== 'false';
const INVITE_TOKEN_SECRET            = configuredEnv('INVITE_TOKEN_SECRET');
const AUTH_TOKEN_SECRET              = configuredEnv('AUTH_TOKEN_SECRET');
// TEST_ADMIN_* used to be the only names for the real console administrator.
// Prefer the accurately named CONSOLE_ADMIN_* variables in deployed services,
// while retaining the old names as a compatibility fallback and for tests.
const DEFAULT_ADMIN_USERNAME         = configuredEnv('CONSOLE_ADMIN_USERNAME') || configuredEnv('TEST_ADMIN_USERNAME');
const DEFAULT_ADMIN_PASSWORD         = configuredEnv('CONSOLE_ADMIN_PASSWORD') || configuredEnv('TEST_ADMIN_PASSWORD');
const DEFAULT_ADMIN_MAX_PARTICIPANTS = Number(
  process.env.CONSOLE_ADMIN_MAX_PARTICIPANTS || process.env.TEST_ADMIN_MAX_PARTICIPANTS || 50
);
const MIDIMYFACE_JOIN_URL            = process.env.MIDIMYFACE_JOIN_URL             || 'https://midimyface.com';
const PUBLIC_BASE_URL                = process.env.PUBLIC_BASE_URL                 || 'https://midimyface-relay.onrender.com';
const LIVE_ROUTE_PATH                = process.env.LIVE_ROUTE_PATH                 || '/live';
const LIVE_YOUTUBE_CHANNEL_ID        = process.env.LIVE_YOUTUBE_CHANNEL_ID         || 'UCequCs51HuUdCYC-RQL-b9g';
const LIVE_INSTAGRAM_HANDLE_RAW      = process.env.LIVE_INSTAGRAM_HANDLE           || '@midimyface';
const LIVE_PAYPAL_DONATION_URL       = process.env.LIVE_PAYPAL_DONATION_URL        || 'https://www.paypal.com/qrcodes/managed/ebc92ae1-6b2e-4d36-93f0-ce2e0b4fbd2d?utm_source=consapp_download';
const LIVE_VENMO_DONATION_URL        = process.env.LIVE_VENMO_DONATION_URL         || 'https://venmo.com/code?user_id=2982237150642176372&created=1784274093';
const RPI_DEVICE_TOKEN               = configuredEnv('RPI_DEVICE_TOKEN');
const LIVE_STATE_FILE                = process.env.LIVE_STATE_FILE                 || path.join(__dirname, 'data', 'live-state.json');
const LIVE_FIREBASE_API_KEY          = configuredEnv('LIVE_FIREBASE_API_KEY');
const LIVE_FIREBASE_AUTH_DOMAIN      = configuredEnv('LIVE_FIREBASE_AUTH_DOMAIN');
const LIVE_FIREBASE_PROJECT_ID       = configuredEnv('LIVE_FIREBASE_PROJECT_ID');
const LIVE_FIREBASE_STORAGE_BUCKET   = configuredEnv('LIVE_FIREBASE_STORAGE_BUCKET');
const LIVE_FIREBASE_MESSAGING_SENDER_ID = configuredEnv('LIVE_FIREBASE_MESSAGING_SENDER_ID');
const LIVE_FIREBASE_APP_ID           = configuredEnv('LIVE_FIREBASE_APP_ID');
const LIVE_FIREBASE_MEASUREMENT_ID   = configuredEnv('LIVE_FIREBASE_MEASUREMENT_ID');
const FIREBASE_ADMIN_PROJECT_ID      = configuredEnv('FIREBASE_ADMIN_PROJECT_ID');
const FIREBASE_ADMIN_CLIENT_EMAIL    = configuredEnv('FIREBASE_ADMIN_CLIENT_EMAIL');
const FIREBASE_ADMIN_PRIVATE_KEY_RAW = configuredEnv('FIREBASE_ADMIN_PRIVATE_KEY');
const LIVE_MASTER_EMAILS_RAW         = configuredEnv('LIVE_MASTER_EMAILS');
const LIVE_SESSION_DURATION_SECONDS  = Math.max(15, Math.min(Number(process.env.LIVE_SESSION_DURATION_SECONDS || 30), 300));
const LIVE_COOLDOWN_MINUTES          = Math.max(1, Math.min(Number(process.env.LIVE_COOLDOWN_MINUTES || 30), 240));
const LIVE_QUEUE_TICKET_TTL_MS       = Math.max(15_000, Math.min(Number(process.env.LIVE_QUEUE_TICKET_TTL_MS || 45_000), 300_000));
const LIVE_SNAPSHOT_TTL_MS           = Math.max(500, Math.min(Number(process.env.LIVE_SNAPSHOT_TTL_MS || 2500), 10_000));
const LIVE_MAX_LANDMARKS             = 478;
const LIVE_MAX_PARTICIPANTS          = 3;
const LIVE_NICKNAME_MIN_LENGTH       = 2;
const LIVE_NICKNAME_MAX_LENGTH       = 10;
const LIVE_PARTICIPANT_COLORS        = ['#67ff9e', '#8e6bff', '#ffb44c'];
const LIVE_REQUIRE_FIREBASE_AUTH     = asBoolean(process.env.LIVE_REQUIRE_FIREBASE_AUTH, true);
const LIVE_BLOCKED_NICKNAME_TERMS    = [
  'asshole','bastard','beaner','bitch','chink','coon','cunt','dick','faggot',
  'fuck','gook','hitler','jerkoff','kike','kkk','nazi','nigga','nigger',
  'penis','pussy','raghead','rape','rapist','shit','slut','vagina','wetback','whore',
];
const LIVE_BLOCKED_NICKNAME_TERM_SET = new Set(LIVE_BLOCKED_NICKNAME_TERMS);

// Comma-separated list like:
// "https://midimyface.com,https://www.midimyface.com,http://127.0.0.1:5500"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const NODE_ENV = String(process.env.NODE_ENV || 'development').toLowerCase();
const LIVE_INSTAGRAM_HANDLE = LIVE_INSTAGRAM_HANDLE_RAW.startsWith('@')
  ? LIVE_INSTAGRAM_HANDLE_RAW
  : `@${LIVE_INSTAGRAM_HANDLE_RAW}`;
const LIVE_INSTAGRAM_URL = `https://www.instagram.com/${LIVE_INSTAGRAM_HANDLE.replace(/^@/, '')}/`;
const LIVE_YOUTUBE_CHANNEL_URL = `https://www.youtube.com/channel/${LIVE_YOUTUBE_CHANNEL_ID}`;
const LIVE_YOUTUBE_VIDEOS_URL = `${LIVE_YOUTUBE_CHANNEL_URL}/videos`;
const LIVE_YOUTUBE_LIVE_EMBED_URL = `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(LIVE_YOUTUBE_CHANNEL_ID)}&autoplay=1`;
const LIVE_MASTER_EMAILS = LIVE_MASTER_EMAILS_RAW
  .split(',')
  .map((email) => String(email || '').trim().toLowerCase())
  .filter(Boolean);
const LIVE_MASTER_EMAIL_SET = new Set(LIVE_MASTER_EMAILS);

function ensureSecureConfig() {
  const missing = [];
  if (REQUIRE_JOIN_TOKEN && !RELAY_JOIN_TOKEN_SECRET) missing.push('RELAY_JOIN_TOKEN_SECRET');
  if (CONSOLE_API_ENABLED) {
    if (!INVITE_TOKEN_SECRET) missing.push('INVITE_TOKEN_SECRET');
    if (!AUTH_TOKEN_SECRET) missing.push('AUTH_TOKEN_SECRET');
    if (!DEFAULT_ADMIN_USERNAME) missing.push('CONSOLE_ADMIN_USERNAME');
    if (!DEFAULT_ADMIN_PASSWORD) missing.push('CONSOLE_ADMIN_PASSWORD');
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
    if (REQUIRE_JOIN_TOKEN && (insecureDefaults.has(RELAY_JOIN_TOKEN_SECRET) || RELAY_JOIN_TOKEN_SECRET.length < 24)) {
      weak.push('RELAY_JOIN_TOKEN_SECRET');
    }
    if (CONSOLE_API_ENABLED) {
      if (insecureDefaults.has(INVITE_TOKEN_SECRET) || INVITE_TOKEN_SECRET.length < 24) weak.push('INVITE_TOKEN_SECRET');
      if (insecureDefaults.has(AUTH_TOKEN_SECRET) || AUTH_TOKEN_SECRET.length < 24) weak.push('AUTH_TOKEN_SECRET');
      if (insecureDefaults.has(DEFAULT_ADMIN_PASSWORD) || DEFAULT_ADMIN_PASSWORD.length < 12) weak.push('CONSOLE_ADMIN_PASSWORD');
    }
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(baseValue, overrideValue) {
  if (!isPlainObject(baseValue) || !isPlainObject(overrideValue)) {
    return overrideValue === undefined ? baseValue : overrideValue;
  }

  const merged = { ...baseValue };
  for (const [key, value] of Object.entries(overrideValue)) {
    merged[key] = key in baseValue ? deepMerge(baseValue[key], value) : value;
  }
  return merged;
}

function cleanString(value, maxLength = 240) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLength);
}

function normalizeLiveNickname(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function liveNicknameModerationForms(value) {
  const leetMap = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i' };
  const spaced = normalizeLiveNickname(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0134578@$!]/g, (char) => leetMap[char] || char)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const compact = spaced.replace(/\s+/g, '');
  return { compact, tokens: spaced ? spaced.split(' ') : [] };
}

function liveNicknameContainsBlockedTerm(value) {
  const { compact, tokens } = liveNicknameModerationForms(value);
  return tokens.some((token) => LIVE_BLOCKED_NICKNAME_TERM_SET.has(token))
    || LIVE_BLOCKED_NICKNAME_TERMS.some((term) => compact.includes(term));
}

function validateLiveNickname(value) {
  const nickname = normalizeLiveNickname(value);
  if (nickname.length < LIVE_NICKNAME_MIN_LENGTH) return { ok: false, error: 'nickname_required' };
  if (nickname.length > LIVE_NICKNAME_MAX_LENGTH) return { ok: false, error: 'nickname_too_long' };
  if (liveNicknameContainsBlockedTerm(nickname)) return { ok: false, error: 'nickname_inappropriate' };
  return { ok: true, nickname };
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function parseBearerToken(req) {
  const authHeader = String(req.headers.authorization || '');
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
}

function firebasePublicConfig() {
  return {
    apiKey: LIVE_FIREBASE_API_KEY,
    authDomain: LIVE_FIREBASE_AUTH_DOMAIN,
    projectId: LIVE_FIREBASE_PROJECT_ID,
    storageBucket: LIVE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: LIVE_FIREBASE_MESSAGING_SENDER_ID,
    appId: LIVE_FIREBASE_APP_ID,
    measurementId: LIVE_FIREBASE_MEASUREMENT_ID,
  };
}

function firebaseConfigured() {
  const cfg = firebasePublicConfig();
  return Boolean(cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId);
}

function firebaseAdminConfigured() {
  return Boolean(FIREBASE_ADMIN_PROJECT_ID && FIREBASE_ADMIN_CLIENT_EMAIL && FIREBASE_ADMIN_PRIVATE_KEY_RAW);
}

let firebaseAuthVerifierInitialized = false;
let firebaseAuthVerifier = null;

function testFirebaseAuthVerifier() {
  if (NODE_ENV !== 'test' || !process.env.LIVE_FIREBASE_TEST_TOKENS_JSON) return null;
  try {
    const tokenClaims = JSON.parse(process.env.LIVE_FIREBASE_TEST_TOKENS_JSON);
    return {
      async verifyIdToken(token) {
        const result = tokenClaims?.[token];
        if (!isPlainObject(result) || result.error) throw new Error('invalid_test_firebase_token');
        return result;
      },
    };
  } catch {
    return null;
  }
}

function getFirebaseAuthVerifier() {
  if (firebaseAuthVerifierInitialized) return firebaseAuthVerifier;
  firebaseAuthVerifierInitialized = true;

  const testVerifier = testFirebaseAuthVerifier();
  if (testVerifier) {
    firebaseAuthVerifier = testVerifier;
    return firebaseAuthVerifier;
  }
  if (!firebaseAdminConfigured()) return null;

  try {
    const appName = 'midimyface-live-relay';
    const privateKey = FIREBASE_ADMIN_PRIVATE_KEY_RAW.replace(/\\n/g, '\n');
    const app = getApps().find((candidate) => candidate.name === appName) || initializeApp({
      credential: cert({
        projectId: FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey,
      }),
    }, appName);
    firebaseAuthVerifier = getAuth(app);
  } catch {
    console.warn('[live-auth] Firebase Admin initialization failed; check the backend environment variables.');
    firebaseAuthVerifier = null;
  }
  return firebaseAuthVerifier;
}

function firebaseVerificationAvailable() {
  if (!firebaseAdminConfigured() && !(NODE_ENV === 'test' && process.env.LIVE_FIREBASE_TEST_TOKENS_JSON)) return false;
  return Boolean(getFirebaseAuthVerifier());
}

function liveAuthError(code, statusCode) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function verifiedFirebaseIdentity(req) {
  const idToken = parseBearerToken(req);
  if (!idToken) return { authenticated: false, master: false, uid: '' };
  const verifier = getFirebaseAuthVerifier();
  if (!verifier) throw liveAuthError('firebase_admin_unconfigured', 503);

  let claims;
  try {
    claims = await verifier.verifyIdToken(idToken);
  } catch {
    throw liveAuthError('invalid_firebase_token', 401);
  }
  const uid = cleanString(claims?.uid || claims?.sub || '', 128);
  if (!uid) throw liveAuthError('invalid_firebase_token', 401);
  const email = typeof claims?.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const emailVerified = claims?.email_verified === true;
  return {
    authenticated: true,
    master: Boolean(emailVerified && email && LIVE_MASTER_EMAIL_SET.has(email)),
    uid,
  };
}

function buildLivePublicConfigPayload() {
  const firebase = firebasePublicConfig();
  return {
    ok: true,
    auth: {
      provider: 'google',
      required: LIVE_REQUIRE_FIREBASE_AUTH,
      enabled: firebaseConfigured() && firebaseVerificationAvailable(),
      firebaseConfigured: firebaseConfigured(),
      backendVerificationConfigured: firebaseVerificationAvailable(),
    },
    firebase,
  };
}

function createDefaultLiveState() {
  return {
    updatedAt: null,
    updatedBy: 'defaults',
    machine: {
      alive: false,
      mode: 'offline',
      acceptingParticipants: false,
      heartbeatAt: null,
      statusLabel: 'offline',
      message: 'Come back later or check our latest socials and live archives.',
      offlineReason: 'No live data yet.',
    },
    venue: {
      name: '',
      city: '',
      country: '',
      address: '',
      timezone: '',
      note: '',
    },
    schedule: {
      startsAt: '',
      endsAt: '',
      nextStartsAt: '',
      note: 'Venue and schedule details will appear here when the installation publishes them.',
    },
    stream: {
      platform: 'youtube',
      isLive: false,
      watchUrl: LIVE_YOUTUBE_CHANNEL_URL,
      embedUrl: LIVE_YOUTUBE_LIVE_EMBED_URL,
      channelId: LIVE_YOUTUBE_CHANNEL_ID,
      channelUrl: LIVE_YOUTUBE_CHANNEL_URL,
      videosUrl: LIVE_YOUTUBE_VIDEOS_URL,
    },
    social: {
      instagramHandle: LIVE_INSTAGRAM_HANDLE,
      instagramUrl: LIVE_INSTAGRAM_URL,
    },
    donations: {
      paypalUrl: LIVE_PAYPAL_DONATION_URL,
      venmoUrl: LIVE_VENMO_DONATION_URL,
      suggestedAmounts: [1, 2, 5],
    },
    queue: {
      enabled: false,
      open: false,
      busy: false,
      turnDurationSeconds: 30,
      cooldownMinutes: LIVE_COOLDOWN_MINUTES,
      oneFreeTurn: true,
      message: 'Queue opens only when the installation is live and accepting participants.',
      estimatedWaitMinutes: null,
    },
    content: {
      heroTitle: 'MIDImyFACE Live',
      heroSubtitle: 'A public installation you can watch online or visit in person.',
      fallbackMessage: 'No live data yet. Come back later or check the channel and social links.',
    },
  };
}

function sanitizeLiveStatePatch(input) {
  const patch = isPlainObject(input) ? input : {};
  return {
    updatedAt: cleanString(patch.updatedAt || new Date().toISOString(), 64),
    updatedBy: cleanString(patch.updatedBy || 'raspberry-pi', 80),
    machine: {
      alive: asBoolean(patch.machine?.alive, false),
      mode: cleanString(patch.machine?.mode || 'offline', 32) || 'offline',
      acceptingParticipants: asBoolean(patch.machine?.acceptingParticipants, false),
      heartbeatAt: cleanString(patch.machine?.heartbeatAt || new Date().toISOString(), 64),
      statusLabel: cleanString(patch.machine?.statusLabel || patch.machine?.mode || 'offline', 48) || 'offline',
      message: cleanString(patch.machine?.message || '', 240),
      offlineReason: cleanString(patch.machine?.offlineReason || '', 240),
    },
    venue: {
      name: cleanString(patch.venue?.name || '', 120),
      city: cleanString(patch.venue?.city || '', 120),
      country: cleanString(patch.venue?.country || '', 120),
      address: cleanString(patch.venue?.address || '', 180),
      timezone: cleanString(patch.venue?.timezone || '', 80),
      note: cleanString(patch.venue?.note || '', 240),
    },
    schedule: {
      startsAt: cleanString(patch.schedule?.startsAt || '', 80),
      endsAt: cleanString(patch.schedule?.endsAt || '', 80),
      nextStartsAt: cleanString(patch.schedule?.nextStartsAt || '', 80),
      note: cleanString(patch.schedule?.note || '', 240),
    },
    stream: {
      platform: cleanString(patch.stream?.platform || 'youtube', 32) || 'youtube',
      isLive: asBoolean(patch.stream?.isLive, false),
      watchUrl: cleanString(patch.stream?.watchUrl || LIVE_YOUTUBE_CHANNEL_URL, 240),
      embedUrl: cleanString(patch.stream?.embedUrl || LIVE_YOUTUBE_LIVE_EMBED_URL, 240),
      channelId: cleanString(patch.stream?.channelId || LIVE_YOUTUBE_CHANNEL_ID, 120),
      channelUrl: cleanString(patch.stream?.channelUrl || LIVE_YOUTUBE_CHANNEL_URL, 240),
      videosUrl: cleanString(patch.stream?.videosUrl || LIVE_YOUTUBE_VIDEOS_URL, 240),
    },
    social: {
      instagramHandle: cleanString(patch.social?.instagramHandle || LIVE_INSTAGRAM_HANDLE, 80) || LIVE_INSTAGRAM_HANDLE,
      instagramUrl: cleanString(patch.social?.instagramUrl || LIVE_INSTAGRAM_URL, 240) || LIVE_INSTAGRAM_URL,
    },
    donations: {
      paypalUrl: cleanString(patch.donations?.paypalUrl || LIVE_PAYPAL_DONATION_URL, 400) || LIVE_PAYPAL_DONATION_URL,
      venmoUrl: cleanString(patch.donations?.venmoUrl || LIVE_VENMO_DONATION_URL, 400) || LIVE_VENMO_DONATION_URL,
      suggestedAmounts: Array.isArray(patch.donations?.suggestedAmounts)
        ? patch.donations.suggestedAmounts.map((amount) => Number(amount)).filter((amount) => Number.isFinite(amount) && amount > 0).slice(0, 6)
        : [1, 2, 5],
    },
    queue: {
      enabled: asBoolean(patch.queue?.enabled, false),
      open: asBoolean(patch.queue?.open, false),
      busy: asBoolean(patch.queue?.busy, false),
      turnDurationSeconds: Math.max(10, Math.min(Number(patch.queue?.turnDurationSeconds || 30), 180)),
      cooldownMinutes: Math.max(1, Math.min(Number(patch.queue?.cooldownMinutes || LIVE_COOLDOWN_MINUTES), 240)),
      oneFreeTurn: asBoolean(patch.queue?.oneFreeTurn, true),
      message: cleanString(patch.queue?.message || '', 240),
      estimatedWaitMinutes: patch.queue?.estimatedWaitMinutes === null || patch.queue?.estimatedWaitMinutes === undefined || patch.queue?.estimatedWaitMinutes === ''
        ? null
        : Math.max(0, Math.min(Number(patch.queue.estimatedWaitMinutes), 1440)),
    },
    content: {
      heroTitle: cleanString(patch.content?.heroTitle || 'MIDImyFACE Live', 120) || 'MIDImyFACE Live',
      heroSubtitle: cleanString(patch.content?.heroSubtitle || 'A public installation you can watch online or visit in person.', 240),
      fallbackMessage: cleanString(patch.content?.fallbackMessage || 'No live data yet. Come back later or check the channel and social links.', 240),
    },
  };
}

function ensureDataDirectory(filePath) {
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadLiveState() {
  const defaults = createDefaultLiveState();
  try {
    if (!fs.existsSync(LIVE_STATE_FILE)) {
      return defaults;
    }
    const parsed = JSON.parse(fs.readFileSync(LIVE_STATE_FILE, 'utf8'));
    return deepMerge(defaults, parsed);
  } catch (error) {
    console.warn('[live] Failed to load live state file, using defaults:', error?.message || error);
    return defaults;
  }
}

function persistLiveState(state) {
  try {
    ensureDataDirectory(LIVE_STATE_FILE);
    fs.writeFileSync(LIVE_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.warn('[live] Failed to persist live state:', error?.message || error);
  }
}

let liveState = loadLiveState();
const liveGestureSnapshots = new Map();
const activeLiveSessions = new Map();
const liveSessionStartByIp = new Map();
const liveCooldownByIdentity = new Map();
const liveQueue = [];

function liveRequestIp(req) {
  return cleanString(String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0], 80);
}

function liveSessionExpired(session) {
  return !session || Date.now() >= session.expiresAtMs;
}

function clearLiveSession(sessionId) {
  if (!sessionId) return;
  activeLiveSessions.delete(sessionId);
  liveGestureSnapshots.delete(sessionId);
}

function expireLiveSessionsIfNeeded() {
  for (const session of activeLiveSessions.values()) {
    if (liveSessionExpired(session)) clearLiveSession(session.sessionId);
  }
}

function publicLiveSessions() {
  expireLiveSessionsIfNeeded();
  return Array.from(activeLiveSessions.values()).map(publicLiveSession);
}

function liveIdentityKey(req, body = {}, firebaseIdentity = null) {
  if (firebaseIdentity?.authenticated && firebaseIdentity.uid) {
    return sha256(`firebase:${firebaseIdentity.uid}`);
  }
  const deviceId = cleanString(body?.deviceId || '', 80);
  const stableDeviceId = /^[a-zA-Z0-9_-]{16,80}$/.test(deviceId) ? deviceId : '';
  return sha256(`${stableDeviceId || 'anonymous'}:${liveRequestIp(req)}`);
}

function purgeLiveQueue() {
  const staleBefore = Date.now() - LIVE_QUEUE_TICKET_TTL_MS;
  for (let index = liveQueue.length - 1; index >= 0; index -= 1) {
    if (liveQueue[index].lastSeenAtMs < staleBefore) liveQueue.splice(index, 1);
  }
}

function cooldownRemainingMs(identityKey) {
  const startedAtMs = liveCooldownByIdentity.get(identityKey) || 0;
  return Math.max(0, startedAtMs + LIVE_COOLDOWN_MINUTES * 60_000 - Date.now());
}

function queueEstimateSeconds(position) {
  const remaining = Array.from(activeLiveSessions.values())
    .map((session) => Math.max(0, session.expiresAtMs - Date.now()))
    .sort((a, b) => a - b);
  const freeSlots = Math.max(0, LIVE_MAX_PARTICIPANTS - activeLiveSessions.size);
  if (position <= freeSlots) return 0;
  const occupiedPosition = Math.max(0, position - freeSlots - 1);
  const slotIndex = occupiedPosition % LIVE_MAX_PARTICIPANTS;
  const cyclesAhead = Math.floor(occupiedPosition / LIVE_MAX_PARTICIPANTS);
  const baseSlotMs = remaining[slotIndex] ?? remaining[remaining.length - 1] ?? 0;
  return Math.ceil((baseSlotMs + cyclesAhead * LIVE_SESSION_DURATION_SECONDS * 1000) / 1000);
}

function publicQueueTicket(entry) {
  const position = liveQueue.indexOf(entry) + 1;
  return {
    position,
    totalWaiting: liveQueue.length,
    estimatedWaitSeconds: queueEstimateSeconds(position),
    turnDurationSeconds: LIVE_SESSION_DURATION_SECONDS,
    priority: entry.master === true ? 'master' : 'standard',
  };
}

function insertLiveQueueEntry(entry) {
  if (!entry.master) {
    liveQueue.push(entry);
    return;
  }
  const firstStandardIndex = liveQueue.findIndex((queued) => !queued.master);
  if (firstStandardIndex < 0) liveQueue.push(entry);
  else liveQueue.splice(firstStandardIndex, 0, entry);
}

function createLiveParticipantSession({ nickname, countryCode, identityKey, master = false }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const startedAtMs = Date.now();
  const expiresAtMs = startedAtMs + LIVE_SESSION_DURATION_SECONDS * 1000;
  const usedColorIndexes = new Set(Array.from(activeLiveSessions.values()).map((session) => session.colorIndex));
  const colorIndex = [0, 1, 2].find((index) => !usedColorIndexes.has(index)) ?? 0;
  const activeLiveSession = {
    sessionId: genId(),
    tokenHash: sha256(token),
    identityKey,
    master: master === true,
    nickname,
    countryCode,
    colorIndex,
    color: LIVE_PARTICIPANT_COLORS[colorIndex],
    startedAt: new Date(startedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    lastSeenAtMs: startedAtMs,
  };
  activeLiveSessions.set(activeLiveSession.sessionId, activeLiveSession);
  if (!master) liveCooldownByIdentity.set(identityKey, startedAtMs);
  return {
    token,
    session: publicLiveSession(activeLiveSession),
    privileges: { masterPriority: master === true },
  };
}

function liveParticipantAuth(req) {
  expireLiveSessionsIfNeeded();
  const bearerToken = parseBearerToken(req);
  if (!bearerToken) return null;
  const providedHash = Buffer.from(sha256(bearerToken), 'hex');
  for (const session of activeLiveSessions.values()) {
    const expectedHash = Buffer.from(session.tokenHash, 'hex');
    if (providedHash.length === expectedHash.length && crypto.timingSafeEqual(providedHash, expectedHash)) return session;
  }
  return null;
}

function sanitizeLiveLandmarks(value) {
  if (!Array.isArray(value)) return [];
  const landmarks = [];
  for (const item of value.slice(0, LIVE_MAX_LANDMARKS)) {
    const x = Number(item?.x);
    const y = Number(item?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    landmarks.push({
      x: Math.round(Math.max(0, Math.min(1, x)) * 10_000) / 10_000,
      y: Math.round(Math.max(0, Math.min(1, y)) * 10_000) / 10_000,
    });
  }
  return landmarks;
}

function publicLiveParticipantSnapshots({ excludeSessionId = '', includeStale = true } = {}) {
  expireLiveSessionsIfNeeded();
  return Array.from(activeLiveSessions.values())
    .filter((session) => session.sessionId !== excludeSessionId)
    .map((session) => {
      const snapshot = liveGestureSnapshots.get(session.sessionId) || null;
      const snapshotAgeMs = snapshot?.updatedAt ? Date.now() - Date.parse(snapshot.updatedAt) : null;
      const fresh = snapshotAgeMs !== null && Number.isFinite(snapshotAgeMs) && snapshotAgeMs <= LIVE_SNAPSHOT_TTL_MS;
      if (!includeStale && !fresh) return null;
      return {
        ...publicLiveSession(session),
        fresh,
        gestures: fresh ? snapshot.gestures : {},
        triggerCounts: fresh ? snapshot.triggerCounts : {},
        landmarks: fresh ? snapshot.landmarks : [],
        frameAspect: fresh ? snapshot.frameAspect : 4 / 3,
        updatedAt: snapshot?.updatedAt || null,
      };
    })
    .filter(Boolean);
}

function publicLiveSession(session) {
  if (!session) return null;
  return {
    sessionId: session.sessionId,
    nickname: session.nickname,
    countryCode: session.countryCode,
    colorIndex: session.colorIndex,
    color: session.color,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
  };
}

function updateLiveState(rawPatch, updatedBy = 'raspberry-pi') {
  const normalizedPatch = sanitizeLiveStatePatch({ ...rawPatch, updatedBy, updatedAt: new Date().toISOString() });
  liveState = deepMerge(liveState, normalizedPatch);
  persistLiveState(liveState);
  return liveState;
}

function publicLiveState(state = liveState) {
  const { auth: _legacyPrivateAuth, ...publicState } = state || {};
  return publicState;
}

function buildLiveBootstrapPayload() {
  return {
    ok: true,
    route: LIVE_ROUTE_PATH,
    relayOrigin: PUBLIC_BASE_URL,
    links: {
      youtubeChannelUrl: LIVE_YOUTUBE_CHANNEL_URL,
      youtubeVideosUrl: LIVE_YOUTUBE_VIDEOS_URL,
      youtubeLiveEmbedUrl: LIVE_YOUTUBE_LIVE_EMBED_URL,
      instagramHandle: LIVE_INSTAGRAM_HANDLE,
      instagramUrl: LIVE_INSTAGRAM_URL,
      paypalDonationUrl: LIVE_PAYPAL_DONATION_URL,
      venmoDonationUrl: LIVE_VENMO_DONATION_URL,
    },
    queuePolicy: {
      turnDurationSeconds: LIVE_SESSION_DURATION_SECONDS,
      cooldownMinutes: LIVE_COOLDOWN_MINUTES,
      freeTurnsPerCooldownWindow: 1,
      paidExtraTurnsEnabled: false,
    },
  };
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
  if (!CONSOLE_API_ENABLED) return;
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

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteCount = 0;
    let tooLarge = false;
    req.on('data', c => {
      byteCount += c.length;
      if (byteCount > maxBytes) {
        tooLarge = true;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(new Error('payload_too_large'));
        return;
      }
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
  const isLiveApiRequest = parsed.pathname.startsWith('/api/live/');

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
    if (isLiveApiRequest || (CONSOLE_API_ENABLED && parsed.pathname.startsWith('/api/'))) {
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

  /* ─── Boot key endpoint — serves AES key to legitimate origins only ─── */
  if (req.method === 'GET' && parsed.pathname === '/api/boot') {
    const bootAllowed = [
      'https://www.midimyface.com',
      'https://midimyface.com',
    ];
    const MMF_SECRET_KEY = process.env.MMF_SECRET_KEY || '';
    if (!bootAllowed.includes(origin)) {
      return sendJson(res, 403, { error: 'forbidden' }, { ...base, 'Access-Control-Allow-Origin': origin || '*' });
    }
    if (!MMF_SECRET_KEY || MMF_SECRET_KEY.length !== 64) {
      return sendJson(res, 503, { error: 'server misconfigured' }, { ...base, 'Access-Control-Allow-Origin': origin });
    }
    return sendJson(res, 200, { key: MMF_SECRET_KEY }, {
      ...base,
      'Access-Control-Allow-Origin': origin,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    });
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

  if (isLiveApiRequest) {
    const c = apiCors(origin);

    if (req.method === 'GET' && parsed.pathname === '/api/live/config') {
      return sendJson(res, 200, buildLivePublicConfigPayload(), {
        ...c,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      });
    }

    if (req.method === 'GET' && parsed.pathname === '/api/live/bootstrap') {
      return sendJson(res, 200, buildLiveBootstrapPayload(), {
        ...c,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      });
    }

    if (req.method === 'GET' && parsed.pathname === '/api/live/status') {
      expireLiveSessionsIfNeeded();
      purgeLiveQueue();
      const sessions = publicLiveSessions();
      return sendJson(res, 200, {
        ok: true,
        status: publicLiveState(),
        session: sessions[0] || null,
        sessions,
        capacity: { active: sessions.length, maximum: LIVE_MAX_PARTICIPANTS, available: Math.max(0, LIVE_MAX_PARTICIPANTS - sessions.length) },
        queue: {
          waiting: liveQueue.length,
          turnDurationSeconds: LIVE_SESSION_DURATION_SECONDS,
          cooldownMinutes: LIVE_COOLDOWN_MINUTES,
        },
        serverTime: new Date().toISOString(),
      }, {
        ...c,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/live/device/status') {
      if (!RPI_DEVICE_TOKEN) {
        return sendJson(res, 503, { ok: false, error: 'rpi_device_token_not_configured' }, c);
      }

      const bearerToken = parseBearerToken(req);
      if (!bearerToken || bearerToken !== RPI_DEVICE_TOKEN) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_device' }, c);
      }

      try {
        const body = await readBody(req, 8_192);
        const nextState = updateLiveState(body, cleanString(body?.updatedBy || 'raspberry-pi', 80) || 'raspberry-pi');
        return sendJson(res, 200, {
          ok: true,
          status: publicLiveState(nextState),
          serverTime: new Date().toISOString(),
        }, c);
      } catch {
        return sendJson(res, 400, { ok: false, error: 'invalid_json' }, c);
      }
    }

    // Participant control requires a verified Firebase account by default.
    // Explicit test/bench deployments may opt back into anonymous sessions.
    if (req.method === 'POST' && parsed.pathname === '/api/live/session/start') {
      try {
        expireLiveSessionsIfNeeded();
        if (!liveState.machine?.alive || !liveState.machine?.acceptingParticipants) {
          return sendJson(res, 409, { ok: false, error: 'installation_not_accepting' }, c);
        }

        const body = await readBody(req, 8_192);
        const nicknameValidation = validateLiveNickname(body?.nickname || '');
        const countryCode = cleanString(body?.countryCode || '', 2).toUpperCase();
        if (!nicknameValidation.ok) return sendJson(res, 400, { ok: false, error: nicknameValidation.error }, c);
        if (!/^[A-Z]{2}$/.test(countryCode)) return sendJson(res, 400, { ok: false, error: 'country_required' }, c);
        const nickname = nicknameValidation.nickname;

        if (LIVE_REQUIRE_FIREBASE_AUTH && !firebaseVerificationAvailable()) {
          throw liveAuthError('firebase_admin_unconfigured', 503);
        }
        const firebaseIdentity = await verifiedFirebaseIdentity(req);
        if (LIVE_REQUIRE_FIREBASE_AUTH && !firebaseIdentity.authenticated) {
          throw liveAuthError('registration_required', 401);
        }
        const identityKey = liveIdentityKey(req, body, firebaseIdentity);
        const remainingCooldownMs = firebaseIdentity.master ? 0 : cooldownRemainingMs(identityKey);
        if (!firebaseIdentity.master && remainingCooldownMs > 0) {
          return sendJson(res, 429, {
            ok: false,
            error: 'participant_cooldown',
            retryAfterMs: remainingCooldownMs,
            cooldownMinutes: LIVE_COOLDOWN_MINUTES,
          }, c);
        }

        if (!firebaseIdentity.master) {
          if (liveSessionStartByIp.size > 1000) liveSessionStartByIp.clear();
          const lastStart = liveSessionStartByIp.get(identityKey) || 0;
          if (Date.now() - lastStart < 3000) {
            return sendJson(res, 429, { ok: false, error: 'start_rate_limited', retryAfterMs: 3000 - (Date.now() - lastStart) }, c);
          }
          liveSessionStartByIp.set(identityKey, Date.now());
        }

        purgeLiveQueue();
        if (activeLiveSessions.size >= LIVE_MAX_PARTICIPANTS || liveQueue.length > 0) {
          const duplicateIndex = liveQueue.findIndex((entry) => entry.identityKey === identityKey);
          if (duplicateIndex >= 0) liveQueue.splice(duplicateIndex, 1);
          const queueToken = crypto.randomBytes(32).toString('base64url');
          const queuedAtMs = Date.now();
          const entry = {
            ticketHash: sha256(queueToken),
            identityKey,
            master: firebaseIdentity.master,
            nickname,
            countryCode,
            queuedAtMs,
            lastSeenAtMs: queuedAtMs,
          };
          insertLiveQueueEntry(entry);
          return sendJson(res, 202, {
            ok: true,
            queued: true,
            queueToken,
            queue: publicQueueTicket(entry),
            serverTime: new Date().toISOString(),
          }, { ...c, 'Cache-Control': 'no-store' });
        }

        const reservation = createLiveParticipantSession({
          nickname,
          countryCode,
          identityKey,
          master: firebaseIdentity.master,
        });
        return sendJson(res, 201, {
          ok: true,
          ...reservation,
          serverTime: new Date().toISOString(),
        }, { ...c, 'Cache-Control': 'no-store' });
      } catch (error) {
        if (error?.code === 'firebase_admin_unconfigured' || error?.code === 'invalid_firebase_token' || error?.code === 'registration_required') {
          return sendJson(res, error.statusCode || 401, { ok: false, error: error.code }, c);
        }
        return sendJson(res, 400, { ok: false, error: 'invalid_json' }, c);
      }
    }

    if (req.method === 'POST' && parsed.pathname === '/api/live/queue/status') {
      try {
        expireLiveSessionsIfNeeded();
        purgeLiveQueue();
        const queueToken = parseBearerToken(req);
        if (!queueToken) return sendJson(res, 401, { ok: false, error: 'queue_token_required' }, c);
        const ticketHash = sha256(queueToken);
        const entryIndex = liveQueue.findIndex((entry) => entry.ticketHash === ticketHash);
        if (entryIndex < 0) return sendJson(res, 410, { ok: false, error: 'queue_ticket_expired' }, c);
        const entry = liveQueue[entryIndex];
        entry.lastSeenAtMs = Date.now();

        if (activeLiveSessions.size < LIVE_MAX_PARTICIPANTS && entryIndex === 0) {
          const remainingCooldownMs = entry.master ? 0 : cooldownRemainingMs(entry.identityKey);
          liveQueue.shift();
          if (!entry.master && remainingCooldownMs > 0) {
            return sendJson(res, 429, {
              ok: false,
              error: 'participant_cooldown',
              retryAfterMs: remainingCooldownMs,
            }, c);
          }
          const reservation = createLiveParticipantSession(entry);
          return sendJson(res, 200, {
            ok: true,
            ready: true,
            ...reservation,
            serverTime: new Date().toISOString(),
          }, { ...c, 'Cache-Control': 'no-store' });
        }

        return sendJson(res, 200, {
          ok: true,
          ready: false,
          queue: publicQueueTicket(entry),
          serverTime: new Date().toISOString(),
        }, { ...c, 'Cache-Control': 'no-store' });
      } catch {
        return sendJson(res, 400, { ok: false, error: 'invalid_queue_request' }, c);
      }
    }

    // The active participant posts gesture and landmark snapshots.
    if (req.method === 'POST' && parsed.pathname === '/api/live/session/gestures') {
      try {
        const session = liveParticipantAuth(req);
        if (!session) return sendJson(res, 401, { ok: false, error: 'invalid_or_expired_session' }, c);
        const body = await readBody(req, 128_000);
        const gestures = isPlainObject(body?.gestures) ? body.gestures : {};
        const triggerCounts = isPlainObject(body?.triggerCounts) ? body.triggerCounts : {};
        const sanitized = {};
        const sanitizedTriggerCounts = {};
        const GESTURE_KEYS = ['mouthOpen','smile','leftWink','rightWink','noseX','noseY','accent'];
        for (const key of GESTURE_KEYS) {
          const v = gestures[key];
          if (v !== undefined && v !== null) {
            const n = Number(v);
            if (Number.isFinite(n)) sanitized[key] = Math.round(n * 100) / 100;
          }
          const count = Number(triggerCounts[key]);
          if (Number.isSafeInteger(count) && count >= 0) {
            sanitizedTriggerCounts[key] = Math.min(count, 1_000_000_000);
          }
        }
        const requestedFrameAspect = Number(body?.frameAspect);
        const frameAspect = Number.isFinite(requestedFrameAspect)
          ? Math.max(0.4, Math.min(2.5, Math.round(requestedFrameAspect * 10_000) / 10_000))
          : 4 / 3;
        const liveGestureSnapshot = {
          gestures: sanitized,
          triggerCounts: sanitizedTriggerCounts,
          landmarks: sanitizeLiveLandmarks(body?.landmarks),
          frameAspect,
          updatedAt: new Date().toISOString(),
          participant: { nickname: session.nickname, countryCode: session.countryCode },
          sessionId: session.sessionId,
        };
        liveGestureSnapshots.set(session.sessionId, liveGestureSnapshot);
        session.lastSeenAtMs = Date.now();
        return sendJson(res, 200, {
          ok: true,
          gestures: sanitized,
          triggerCounts: sanitizedTriggerCounts,
          expiresAt: session.expiresAt,
          remainingMs: Math.max(0, session.expiresAtMs - Date.now()),
          participants: publicLiveParticipantSnapshots({ excludeSessionId: session.sessionId, includeStale: false }),
          serverTime: new Date().toISOString(),
        }, {
          ...c,
          'Cache-Control': 'no-store',
        });
      } catch {
        return sendJson(res, 400, { ok: false, error: 'invalid_json' }, c);
      }
    }

    // Pi polls this to get the latest gesture snapshot from the current participant
    if (req.method === 'GET' && parsed.pathname === '/api/live/session/gestures') {
      if (!RPI_DEVICE_TOKEN) return sendJson(res, 503, { ok: false, error: 'rpi_device_token_not_configured' }, c);
      const bearerToken = parseBearerToken(req);
      if (!bearerToken || bearerToken !== RPI_DEVICE_TOKEN) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_device' }, c);
      }
      expireLiveSessionsIfNeeded();
      const participants = publicLiveParticipantSnapshots({ includeStale: true });
      const primary = participants.find((participant) => participant.fresh) || participants[0] || null;
      const fresh = participants.some((participant) => participant.fresh);
      return sendJson(res, 200, {
        ok: true,
        active: activeLiveSessions.size > 0,
        fresh,
        stale: Boolean(activeLiveSessions.size > 0 && !fresh),
        session: primary ? publicLiveSession(primary) : null,
        sessions: publicLiveSessions(),
        participants,
        ...(primary?.fresh ? {
          gestures: primary.gestures,
          triggerCounts: primary.triggerCounts,
          landmarks: primary.landmarks,
          frameAspect: primary.frameAspect,
          updatedAt: primary.updatedAt,
          participant: { nickname: primary.nickname, countryCode: primary.countryCode, color: primary.color, colorIndex: primary.colorIndex },
          sessionId: primary.sessionId,
        } : {
          gestures: {},
          triggerCounts: {},
          landmarks: [],
          frameAspect: 4 / 3,
          updatedAt: primary?.updatedAt || null,
          participant: primary ? {
            nickname: primary.nickname,
            countryCode: primary.countryCode,
            color: primary.color,
            colorIndex: primary.colorIndex,
          } : null,
        }),
        serverTime: new Date().toISOString(),
      }, {
        ...c,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/live/session/stop') {
      const session = liveParticipantAuth(req);
      if (!session) return sendJson(res, 401, { ok: false, error: 'invalid_or_expired_session' }, c);
      clearLiveSession(session.sessionId);
      return sendJson(res, 200, { ok: true, stopped: true, serverTime: new Date().toISOString() }, {
        ...c,
        'Cache-Control': 'no-store',
      });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/live/device/message') {
      if (!RPI_DEVICE_TOKEN) {
        return sendJson(res, 503, { ok: false, error: 'rpi_device_token_not_configured' }, c);
      }

      const bearerToken = parseBearerToken(req);
      if (!bearerToken || bearerToken !== RPI_DEVICE_TOKEN) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_device' }, c);
      }

      try {
        const body = await readBody(req);
        const message = cleanString(body?.message || '', 240);
        if (!message) {
          return sendJson(res, 400, { ok: false, error: 'message_required' }, c);
        }

        const updatedBy = cleanString(body?.updatedBy || 'raspberry-pi-desktop', 80) || 'raspberry-pi-desktop';
        const nextState = updateLiveState({
          machine: {
            message,
          },
          queue: {
            message,
          },
          content: {
            fallbackMessage: message,
          },
        }, updatedBy);

        return sendJson(res, 200, {
          ok: true,
          message,
          status: publicLiveState(nextState),
          serverTime: new Date().toISOString(),
        }, c);
      } catch {
        return sendJson(res, 400, { ok: false, error: 'invalid_json' }, c);
      }
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' }, c);
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
