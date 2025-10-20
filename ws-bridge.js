/* ==========================================
   midimyface ws-bridge.js  (UPDATED, SAFE)
   ========================================== */

(() => {
  'use strict';

  // ---- Prevent double loading (Live Server / cache / accidental re-includes) ----
  if (window.__MMF_WS_BRIDGE_LOADED__) {
    console.debug('[MMF] ws-bridge already loaded — skipping');
    return;
  }
  window.__MMF_WS_BRIDGE_LOADED__ = true;

  // ---- Connection state + last config (kept on window to share with other modules if needed) ----
  window.wsConnectionState = window.wsConnectionState || 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'error'
  window.sessionConfig = window.sessionConfig || { session_id: '', password: '', name: '', relay_url: '' };

  // ---- Configurable defaults (edit RELAY_HOST once; UI can override via relay_url input) ----
const RELAY_HOST_DEFAULT = 'wss://midimyface-relay.onrender.com'; // <- correct
const WS_PATH = '/ws';

  // ---- Internal vars ----
  let socket = null;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_BACKOFF = 15000; // ms
  const HEARTBEAT_MS = 25000;

  // Keep the last good config so auto-reconnect knows what to use
  let lastCfg = null;

  // ---- Helpers ----
  function wsDispatchState(state) {
    window.wsConnectionState = state;
    window.dispatchEvent(new CustomEvent('ws:setState', { detail: { state } }));
  }

  function clearTimers() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }

  function computeBackoff(n) {
    // 1.6^n, clamped
    const ms = Math.min(1000 * Math.pow(1.6, n), MAX_BACKOFF);
    return Math.round(ms);
  }

  function buildWsUrl(relayBase) {
    const base = (relayBase && relayBase.trim()) || RELAY_HOST_DEFAULT;
    // If user pasted http(s), convert to ws(s)
    try {
      const u = new URL(base);
      const proto = (u.protocol === 'http:') ? 'ws:' : (u.protocol === 'https:' ? 'wss:' : u.protocol);
      return `${proto}//${u.host}${WS_PATH}`;
    } catch {
      // If it's already ws/wss or a bare host, just trust it
      if (base.startsWith('ws://') || base.startsWith('wss://')) return `${base}${WS_PATH}`;
      return `wss://${base}${WS_PATH}`;
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      safeSend({ type: 'ping', t: Date.now() });
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function safeSend(obj) {
    try {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(obj));
      }
    } catch (e) {
      console.warn('[MMF] WS send failed:', e);
    }
  }

  // ---- Core connect / disconnect ----
  function connect(cfg) {
    // Basic validation
    if (!cfg || !cfg.session_id || !cfg.name) {
      console.warn('[MMF] Missing session_id or name — not connecting.');
      wsDispatchState('error');
      return;
    }

    lastCfg = { ...cfg }; // remember for reconnects
    clearTimers();
    wsDispatchState('connecting');

    const url = buildWsUrl(cfg.relay_url);
    console.log('[MMF] Connecting WS to:', url);

    socket = new WebSocket(url);

    socket.onopen = () => {
      console.log('[MMF] WS open');
      // Join handshake
      safeSend({
        type: 'join',
        session_id: cfg.session_id,
        password: cfg.password || '',
        name: cfg.name
      });

      startHeartbeat();
      reconnectAttempts = 0; // reset backoff; we'll set "connected" when server acks
    };

    socket.onmessage = (evt) => {
      let data;
      try {
        data = JSON.parse(evt.data);
      } catch {
        // Not JSON — ignore
        return;
      }

      switch (data.type) {
        case 'welcome':
        case 'joined':
        case 'ok':
          // Server confirmed — mark connected
          wsDispatchState('connected');
          break;

        case 'error':
          console.warn('[MMF] WS error from server:', data.message);
          wsDispatchState('error');
          // server might close after this
          break;

        case 'peer_join':
        case 'peer_leave':
          // FYI events; you can surface in UI if desired
          console.log('[MMF] Peer event:', data);
          break;

        case 'midi':
        case 'gesture':
        case 'chat':
          // In future, route to UI or MIDI logic as needed
          // window.dispatchEvent(new CustomEvent('relay:event', { detail: data }));
          break;

        case 'pong':
          // heartbeat ack
          break;

        default:
          // Unknown messages can be routed if you wish
          // console.debug('[MMF] WS message:', data);
          break;
      }
    };

    socket.onerror = (e) => {
      console.warn('[MMF] WS socket error:', e);
      wsDispatchState('error');
    };

    socket.onclose = () => {
      console.log('[MMF] WS closed');
      stopHeartbeat();
      if (window.wsConnectionState !== 'disconnected') {
        // Attempt reconnect only if user didn’t explicitly disconnect
        scheduleReconnect();
      }
    };
  }

  function scheduleReconnect() {
    if (!lastCfg) {
      wsDispatchState('disconnected');
      return;
    }
    wsDispatchState('connecting');
    const delay = computeBackoff(reconnectAttempts++);
    console.log(`[MMF] Reconnecting in ${delay} ms…`);
    reconnectTimer = setTimeout(() => connect(lastCfg), delay);
  }

  function disconnect(explicit = false) {
    clearTimers();
    if (socket) {
      try { socket.close(1000, 'client disconnect'); } catch {}
      socket = null;
    }
    if (explicit) {
      // User asked to disconnect: don't auto-reconnect
      lastCfg = null;
    }
    wsDispatchState('disconnected');
  }


  const MMFRelay = {
    isConnected: () => !!socket && socket.readyState === WebSocket.OPEN,
    getState: () => window.wsConnectionState,
    getSession: () => ({ ...lastCfg }),

    // Generic sender
    send(type, payload = {}) {
      safeSend({ type, ...payload });
    },

    // Convenience helpers
    sendGesture(gestureName, value) {
      if (!lastCfg) return;
      safeSend({
        type: 'gesture',
        session_id: lastCfg.session_id,
        from: lastCfg.name,
        gesture: gestureName,
        value
      });
    },

    sendMidi(noteOrCc) {
      if (!lastCfg) return;
      // noteOrCc example:
      // { kind:'noteon', ch:1, note:60, vel:100 }
      // { kind:'noteoff', ch:1, note:60 }
      // { kind:'cc', ch:1, cc:10, value:64 }
      safeSend({
        type: 'midi',
        session_id: lastCfg.session_id,
        from: lastCfg.name,
        data: noteOrCc
      });
    },

    disconnect: () => disconnect(true),
  };

  // Expose API
  window.MMFRelay = MMFRelay;

  // ---- Hook into your existing UI events ----
  window.addEventListener('session:connect', (e) => {
    const { session_id, password, name, relay_url } = e.detail || {};
    // update global sessionConfig for other modules (non-sensitive; we do not persist password)
    window.sessionConfig.session_id = session_id || '';
    window.sessionConfig.password = password || '';
    window.sessionConfig.name = name || '';
    window.sessionConfig.relay_url = relay_url || '';

    connect(window.sessionConfig);
  });

  window.addEventListener('session:disconnect', () => {
    disconnect(true);
  });

  console.log('[MMF] ws-bridge loaded');
})();
