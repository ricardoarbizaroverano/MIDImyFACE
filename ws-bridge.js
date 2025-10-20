// ws-bridge.js (hardened)
const WS_URL = (window.sessionConfig && window.sessionConfig.relay_url) || 
               'wss://midimyface-relay.onrender.com/ws';  // <-- try adding /ws if your server needs it
const WS_PROTOCOLS = undefined; // e.g., ['mmf-bridge-v1'] if your server requires

let ws;
let reconnectAttempts = 0;
let heartbeatTimer = null;
let heartbeatIntervalMs = 15000; // app-level heartbeat

function log(...args) { console.log('[WS]', ...args); }

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // app-level ping message; adjust to what your server expects
        ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
      }
    } catch (e) { /* no-op */ }
  }, heartbeatIntervalMs);
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function nextBackoffMs() {
  const ms = Math.min(30000, 500 * Math.pow(2, reconnectAttempts)); // 0.5s → 30s cap
  reconnectAttempts++;
  return ms;
}

function connectWS() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  wsConnectionState = 'connecting';
  log(`Connecting to ${WS_URL} (attempt ${reconnectAttempts + 1}) …`);
  try {
    ws = WS_PROTOCOLS ? new WebSocket(WS_URL, WS_PROTOCOLS) : new WebSocket(WS_URL);
  } catch (err) {
    console.error('WebSocket constructor failed:', err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    wsConnectionState = 'connected';
    reconnectAttempts = 0;
    log('Connected');
    startHeartbeat();

    // Optionally announce client hello
    try { ws.send(JSON.stringify({ type: 'hello', origin: window.location.origin })); } catch {}
  };

  ws.onerror = (ev) => {
    // Browser gives little here; onclose will have more detail
    console.warn('WS error', ev);
  };

  ws.onclose = (ev) => {
    wsConnectionState = 'disconnected';
    stopHeartbeat();
    // Detailed diagnostics
    console.warn('WS closed', {
      code: ev.code,        // e.g., 1006 (abnormal), 1008 (policy), 1015 (TLS)
      reason: ev.reason,    // proxy/server may pass a reason
      wasClean: ev.wasClean
    });

    // Heuristics
    if (ev.code === 1008) {
      console.warn('Likely origin/protocol policy rejection. Ensure server allows Origin:', window.location.origin);
    } else if (ev.code === 1015 || ev.code === 1006) {
      console.warn('TLS/proxy/cold-start issue possible. Try hitting the base URL in a tab to wake the service.');
    }

    scheduleReconnect();
  };

  ws.onmessage = (msg) => {
    // If your server echoes pings, you can skip parsing here
    try {
      const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
      if (data && data.type === 'pong') return; // app-level pong
      // route messages to your app if needed
      // handleBridgeMessage(data);
    } catch { /* ignore non-JSON */ }
  };
}

function scheduleReconnect() {
  const delay = nextBackoffMs();
  log(`Reconnecting in ${delay} ms …`);
  setTimeout(connectWS, delay);
}

// Public no-op emit shim so offline use doesn’t break
window.mmfEmit = function mmfEmit(type, payload) {
  // If you also forward to WS when connected:
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload, t: Date.now() }));
    }
  } catch { /* no-op */ }
  // Keep as no-op if not connected; callers shouldn’t fail
};

// Kick it off
connectWS();
