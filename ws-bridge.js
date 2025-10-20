/* ==========================================
   midimyface ws-bridge.js  (HELLO + HEARTBEAT)
   ========================================== */
   (() => {
    'use strict';
  
    // ---- Prevent double loading ----
    if (window.__MMF_WS_BRIDGE_LOADED__) {
      console.debug('[MMF] ws-bridge already loaded — skipping');
      return;
    }
    window.__MMF_WS_BRIDGE_LOADED__ = true;
  
    // ---- Shared state (avoid "already declared") ----
    window.wsConnectionState = window.wsConnectionState || 'disconnected';
    window.sessionConfig     = window.sessionConfig     || { session_id: '', password: '', name: '', relay_url: '' };
  
    // ---- Defaults (UI can override relay_url) ----
    const RELAY_HOST_DEFAULT = 'wss://midimyface-relay.onrender.com';
    const WS_PATH            = '/ws';
  
    // ---- Internals ----
    let socket            = null;
    let heartbeatTimer    = null;
    let reconnectTimer    = null;
    let reconnectAttempts = 0;
  
    const MAX_BACKOFF  = 15000;   // ms
    const HEARTBEAT_MS = 25000;   // ms
  
    // remember last config for auto-reconnect
    let lastCfg = null;
  
    // ---- Helpers ----
    function wsDispatchState(state) {
      window.wsConnectionState = state;
      window.dispatchEvent(new CustomEvent('ws:setState', { detail: { state } }));
    }
  
    function clearTimers() {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (reconnectTimer) { clearTimeout(reconnectTimer);   reconnectTimer = null; }
    }
  
    function computeBackoff(n) {
      const ms = Math.min(1000 * Math.pow(1.6, n), MAX_BACKOFF);
      return Math.round(ms);
    }
  
    function buildWsUrl(relayBase) {
      const base = (relayBase && relayBase.trim()) || RELAY_HOST_DEFAULT;
      try {
        const u = new URL(base);
        const proto = (u.protocol === 'http:') ? 'ws:' : (u.protocol === 'https:' ? 'wss:' : u.protocol);
        return `${proto}//${u.host}${WS_PATH}`;
      } catch {
        if (base.startsWith('ws://') || base.startsWith('wss://')) return `${base}${WS_PATH}`;
        return `wss://${base}${WS_PATH}`;
      }
    }
  
    function getOrMakeClientUUID() {
      const KEY = 'mmf_client_uuid';
      try {
        let id = localStorage.getItem(KEY);
        if (!id) {
          id = (crypto && crypto.randomUUID) ? crypto.randomUUID()
              : (Math.random().toString(36).slice(2) + Date.now().toString(36));
          localStorage.setItem(KEY, id);
        }
        return id;
      } catch {
        return Math.random().toString(36).slice(2) + Date.now().toString(36);
      }
    }
  
    function startHeartbeat() {
      stopHeartbeat();
      heartbeatTimer = setInterval(() => {
        // Relay replies with { type: 'system/pong' }
        safeSend({ type: 'system/ping', data: { t: Date.now() } });
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
      if (!cfg || !cfg.session_id || !cfg.name) {
        console.warn('[MMF] Missing session_id or name — not connecting.');
        wsDispatchState('error');
        return;
      }
  
      lastCfg = { ...cfg };
      clearTimers();
      wsDispatchState('connecting');
  
      const url = buildWsUrl(cfg.relay_url);
      console.log('[MMF] Connecting WS to:', url);
  
      socket = new WebSocket(url);
  
      socket.onopen = () => {
        console.log('[MMF] WS open');
  
        // Relay expects "hello" first
        safeSend({
          type: 'hello',
          role: 'performer', // this browser client is a performer
          session_id: cfg.session_id,
          password: cfg.password || '',
          name: cfg.name,
          client_uuid: getOrMakeClientUUID()
        });
  
        startHeartbeat();
        reconnectAttempts = 0;
      };
  
      socket.onmessage = (evt) => {
        let data;
        try { data = JSON.parse(evt.data); } catch { return; }
  
        switch (data.type) {
          case 'hello/ack':
            wsDispatchState('connected');
            console.log('[MMF] hello/ack', data.data || {});
            break;
  
          case 'session/roster':
            console.log('[MMF] roster:', data.data);
            break;
  
          case 'session/joined':
          case 'session/left':
          case 'server/assigned':
            console.log('[MMF] event:', data.type, data.data);
            break;
  
          case 'system/pong':
            // heartbeat ack
            break;
  
          case 'error':
          case 'server/reject':
            console.warn('[MMF] server says:', data);
            wsDispatchState('error');
            break;
  
          default:
            // other relayed messages (midi/*, gesture/*) can be handled later
            break;
        }
      };
  
      socket.onerror = (e) => {
        console.warn('[MMF] WS socket error:', e);
        wsDispatchState('error');
      };
  
      socket.onclose = (evt) => {
        console.log('[MMF] WS closed', {
          wasClean: evt.wasClean,
          code: evt.code,
          reason: evt.reason
        });
        stopHeartbeat();
        if (window.wsConnectionState !== 'disconnected') {
          scheduleReconnect();
        } else {
          wsDispatchState('disconnected');
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
      if (explicit) lastCfg = null; // don't auto-reconnect
      wsDispatchState('disconnected');
    }
  
    // Public API
    const MMFRelay = {
      isConnected: () => !!socket && socket.readyState === WebSocket.OPEN,
      getState:     () => window.wsConnectionState,
      getSession:   () => ({ ...lastCfg }),
  
      send(type, payload = {}) { safeSend({ type, ...payload }); },
  
      // Convenience helpers (match your server’s relay types)
      sendGesture(gestureName, value) {
        if (!lastCfg) return;
        safeSend({ type: 'gesture/update', data: { gesture: gestureName, value } });
      },
  
      // noteOrCc: { kind:'noteon'|'noteoff'|'cc', ch, note?, vel?, cc?, value? }
      sendMidi(noteOrCc) {
        if (!lastCfg) return;
        const map = { noteon: 'midi/note_on', noteoff: 'midi/note_off', cc: 'midi/cc' };
        const t = map[noteOrCc?.kind];
        if (t) safeSend({ type: t, data: noteOrCc });
      },
  
      disconnect: () => disconnect(true),
    };
  
    window.MMFRelay = MMFRelay;
  
    // ---- Hook into your existing UI events ----
    window.addEventListener('session:connect', (e) => {
      const { session_id, password, name, relay_url } = e.detail || {};
      window.sessionConfig.session_id = session_id || '';
      window.sessionConfig.password   = password   || '';
      window.sessionConfig.name       = name       || '';
      window.sessionConfig.relay_url  = relay_url  || '';
      connect(window.sessionConfig);
    });
  
    window.addEventListener('session:disconnect', () => {
      disconnect(true);
    });
  
    console.log('[MMF] ws-bridge loaded');
  })();
  
