/* ==========================================
   midimyface ws-bridge.js  (HELLO + HEARTBEAT + ACK TIMEOUT)
   ========================================== */
   (() => {
    'use strict';
  
    if (window.__MMF_WS_BRIDGE_LOADED__) {
      console.debug('[MMF] ws-bridge already loaded — skipping');
      return;
    }
    window.__MMF_WS_BRIDGE_LOADED__ = true;
  
    window.wsConnectionState = window.wsConnectionState || 'disconnected';
    window.sessionConfig     = window.sessionConfig     || { session_id: '', password: '', name: '', relay_url: '' };
  
    const RELAY_HOST_DEFAULT = 'wss://midimyface-relay.onrender.com';
    const WS_PATH            = '/ws';
  
    let socket = null;
    let heartbeatTimer = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let ackTimer = null;              // NEW: wait for hello/ack
  
    const MAX_BACKOFF  = 15000; // ms
    const HEARTBEAT_MS = 25000; // ms
    const ACK_TIMEOUT  = 10000; // ms
  
    let lastCfg = null;
  
    function wsDispatchState(state) {
      window.wsConnectionState = state;
      window.dispatchEvent(new CustomEvent('ws:setState', { detail: { state } }));
    }
    function clearTimers() {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ackTimer)       { clearTimeout(ackTimer);       ackTimer = null; }
    }
    function computeBackoff(n) {
      return Math.round(Math.min(1000 * Math.pow(1.6, n), MAX_BACKOFF));
    }
    function buildWsUrl(relayBase) {
      const base = (relayBase && relayBase.trim()) || RELAY_HOST_DEFAULT;
    
      try {
        const u = new URL(base);
    
        // Decide protocol
        const proto =
          u.protocol === 'http:'  ? 'ws:'  :
          u.protocol === 'https:' ? 'wss:' : u.protocol;
    
        // If the user already provided a non-root path, don't append WS_PATH
        const hasPath = u.pathname && u.pathname !== '/' && u.pathname !== '';
        if (hasPath) {
          // Normalize no trailing slash (render/ws vs render/ws/)
          const normalizedPath = u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname;
          return `${proto}//${u.host}${normalizedPath}`;
        }
    
        // Otherwise use our default WS_PATH
        return `${proto}//${u.host}${WS_PATH}`;
      } catch {
        // base isn't a full URL, treat as host
        if (base.startsWith('ws://') || base.startsWith('wss://')) {
          // If it already ends with /ws or has any path, use as-is
          try {
            const u2 = new URL(base);
            const hasPath = u2.pathname && u2.pathname !== '/' && u2.pathname !== '';
            if (hasPath) return base;
          } catch {}
          return `${base}${WS_PATH}`;
        }
        // bare host
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
      } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
    }
    function startHeartbeat() {
      stopHeartbeat();
      heartbeatTimer = setInterval(() => {
        safeSend({ type: 'system/ping', data: { t: Date.now() } });
      }, HEARTBEAT_MS);
    }
    function stopHeartbeat() {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    }
    function safeSend(obj) {
      try { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj)); }
      catch (e) { console.warn('[MMF] WS send failed:', e); }
    }
  
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

      // Log final resolved URL (to catch double /ws, wrong protocol, etc.)
      console.log('[MMF] WS URL:', url);
      socket = new WebSocket(url);
  
      socket.onopen = () => {
        console.log('[MMF] WS open — sending hello');
        safeSend({
          type: 'hello',
          role: 'performer',
          session_id: cfg.session_id,
          password: cfg.password || '',
          name: cfg.name,
          client_uuid: getOrMakeClientUUID()
        });
  
        // Wait for hello/ack; if not received, show error (stuck yellow otherwise)
        ackTimer = setTimeout(() => {
          console.warn('[MMF] No hello/ack within 10s — check server logs/session_id/password/origins');
          wsDispatchState('error');
          try { socket.close(4000, 'ack timeout'); } catch {}
        }, ACK_TIMEOUT);
  
        startHeartbeat();
        reconnectAttempts = 0;
      };
  
      socket.onmessage = (evt) => {
        let data;
        try { data = JSON.parse(evt.data); } catch { console.debug('[MMF] Non-JSON frame', evt.data); return; }
  
        // Log everything for now
        console.log('[MMF] <=', data);
  
        switch (data.type) {
          // Accept any of these as the server's handshake confirmation
          case 'hello/ack':
          case 'joined':
          case 'welcome':
          case 'ok':
            if (ackTimer) { clearTimeout(ackTimer); ackTimer = null; }
            wsDispatchState('connected');
            break;
        
          case 'system/pong':
            break;
        
          case 'error':
          case 'server/reject':
            if (ackTimer) { clearTimeout(ackTimer); ackTimer = null; }
            console.warn('[MMF] server says:', data);
            wsDispatchState('error');
            break;
        
          default:
            // session/*, server/*, midi/*, gesture/* — just log for now
            break;
        }        
      };
  
      socket.onerror = (e) => {
        console.warn('[MMF] WS socket error:', e);
        wsDispatchState('error');
      };
  
      socket.onclose = (evt) => {
        console.log('[MMF] WS closed', { wasClean: evt.wasClean, code: evt.code, reason: evt.reason });
        stopHeartbeat();
        if (ackTimer) { clearTimeout(ackTimer); ackTimer = null; }
        if (window.wsConnectionState !== 'disconnected') {
          scheduleReconnect();
        } else {
          wsDispatchState('disconnected');
        }
      };
    }
  
    function scheduleReconnect() {
      if (!lastCfg) { wsDispatchState('disconnected'); return; }
      wsDispatchState('connecting');
      const delay = computeBackoff(reconnectAttempts++);
      console.log(`[MMF] Reconnecting in ${delay} ms…`);
      reconnectTimer = setTimeout(() => connect(lastCfg), delay);
    }
  
    function disconnect(explicit = false) {
      clearTimers();
      if (socket) { try { socket.close(1000, 'client disconnect'); } catch {} socket = null; }
      if (explicit) lastCfg = null;
      wsDispatchState('disconnected');
    }
  
    const MMFRelay = {
      isConnected: () => !!socket && socket.readyState === WebSocket.OPEN,
      getState:     () => window.wsConnectionState,
      getSession:   () => ({ ...lastCfg }),
      send(type, payload = {}) { safeSend({ type, ...payload }); },
      sendGesture(gestureName, value) {
        if (!lastCfg) return;
        safeSend({ type: 'gesture/update', data: { gesture: gestureName, value } });
      },
      sendMidi(noteOrCc) {
        if (!lastCfg) return;
        const map = { noteon: 'midi/note_on', noteoff: 'midi/note_off', cc: 'midi/cc' };
        const t = map[noteOrCc?.kind];
        if (t) safeSend({ type: t, data: noteOrCc });
      },
      disconnect: () => disconnect(true),
    };
    window.MMFRelay = MMFRelay;
  
    // UI hooks
    window.addEventListener('session:connect', (e) => {
      const { session_id, password, name, relay_url } = e.detail || {};
      window.sessionConfig.session_id = session_id || '';
      window.sessionConfig.password   = password   || '';
      window.sessionConfig.name       = name       || '';
      window.sessionConfig.relay_url  = relay_url  || '';
  
      // Wake Render service with a timeout, then try WS regardless
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 6000);
      fetch('https://midimyface-relay.onrender.com/health', { signal: controller.signal })
        .then(() => {
          console.log('[MMF] Relay awake, connecting…');
          connect(window.sessionConfig);
        })
        .catch(err => {
          console.warn('[MMF] Relay wake-up skipped/failed:', err?.name || err);
          connect(window.sessionConfig);
        });
    });
  
    window.addEventListener('session:disconnect', () => {
      disconnect(true);
    });
  
    console.log('[MMF] ws-bridge loaded');
  })();
  
