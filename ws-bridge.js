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
    window.sessionConfig     = window.sessionConfig     || { session_id: '', password: '', name: '', relay_url: '', console_api: '', invite_token: '' };
  
    const RELAY_WS_DEFAULT   = 'wss://midimyface-relay.onrender.com/ws';
    const WS_PATH            = '/ws';
    const CONSOLE_API_DEFAULT = 'https://midimyface-relay.onrender.com';
    const LOCAL_DEVELOPMENT_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
    const LOCAL_API_PROTOCOLS = new Set(['http:', 'https:']);
    const LOCAL_WS_PROTOCOLS = new Set(['ws:', 'wss:']);
  
    let socket = null;
    let heartbeatTimer = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let ackTimer = null;              // NEW: wait for hello/ack
    let ensembleBeatTimer = null;
  
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
    function localEndpointOverride(value, allowedProtocols) {
      if (!LOCAL_DEVELOPMENT_HOSTNAMES.has(window.location.hostname)) return null;
      try {
        const endpoint = new URL(String(value || '').trim());
        if (!allowedProtocols.has(endpoint.protocol)
          || !LOCAL_DEVELOPMENT_HOSTNAMES.has(endpoint.hostname)) {
          return null;
        }
        return endpoint;
      } catch {
        return null;
      }
    }
    function buildWsUrl(relayBase) {
      const endpoint = localEndpointOverride(relayBase, LOCAL_WS_PROTOCOLS);
      if (!endpoint) return RELAY_WS_DEFAULT;
      const hasPath = endpoint.pathname && endpoint.pathname !== '/';
      const path = hasPath
        ? (endpoint.pathname.endsWith('/') ? endpoint.pathname.slice(0, -1) : endpoint.pathname)
        : WS_PATH;
      return `${endpoint.protocol}//${endpoint.host}${path}`;
    }
    function buildConsoleApiBase(cfg) {
      if (!LOCAL_DEVELOPMENT_HOSTNAMES.has(window.location.hostname)) return CONSOLE_API_DEFAULT;
      const q = new URLSearchParams(window.location.search);
      const fromQuery = q.get('console_api');
      const fromCfg = cfg?.console_api || '';
      let fromStorage = '';
      try { fromStorage = localStorage.getItem('mmf_console_api') || ''; } catch {}
      const endpoint = localEndpointOverride(
        fromQuery || fromCfg || fromStorage,
        LOCAL_API_PROTOCOLS
      );
      if (!endpoint) return CONSOLE_API_DEFAULT;
      try { localStorage.setItem('mmf_console_api', endpoint.origin); } catch {}
      return endpoint.origin;
    }

    async function requestJoinToken(cfg) {
      const apiBase = buildConsoleApiBase(cfg);
      const inviteToken = cfg.invite_token || new URLSearchParams(window.location.search).get('invite_token') || '';
      const body = {
        session_id: cfg.session_id,
        password: cfg.password || '',
        name: cfg.name,
        client_uuid: getOrMakeClientUUID(),
      };
      if (inviteToken) body.invite_token = inviteToken;

      const firebaseToken = await window.MMFAuthGate?.getCurrentIdToken?.(true);
      if (!firebaseToken) throw new Error('registration_required');
      const res = await fetch(`${apiBase}/api/sessions/join-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${firebaseToken}` },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({ ok: false, error: 'invalid_response' }));
      if (!res.ok || !data.ok || !data.join_token) {
        throw new Error(data.error || `token_http_${res.status}`);
      }
      return data.join_token;
    }

    function relayHealthUrl(relayBase) {
      try {
        const wsUrl = new URL(buildWsUrl(relayBase));
        const proto = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
        return `${proto}//${wsUrl.host}/health`;
      } catch {
        return 'https://midimyface-relay.onrender.com/health';
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
    function asObj(input) {
      return input && typeof input === 'object' ? input : {};
    }
    function readDetail(evt) {
      return asObj(evt?.detail || evt?.data || evt);
    }

    function startEnsembleClock(config = {}) {
      if (ensembleBeatTimer) { clearTimeout(ensembleBeatTimer); ensembleBeatTimer = null; }
      const tempo = Math.max(40, Math.min(240, Number(config.tempo) || 120));
      const beatMs = 60000 / tempo;
      const origin = Number(config.clockStartedAt) || Date.now();
      const tick = () => {
        const elapsed = Math.max(0, Date.now() - origin);
        const beatIndex = Math.floor(elapsed / beatMs);
        const beatInBar = (beatIndex % 4) + 1;
        document.body?.classList.add('session-beat');
        document.body?.classList.toggle('session-downbeat', beatInBar === 1);
        document.body?.setAttribute('data-session-beat', String(beatInBar));
        window.dispatchEvent(new CustomEvent('session:beat', { detail: { beat: beatInBar, tempo } }));
        setTimeout(() => document.body?.classList.remove('session-beat', 'session-downbeat'), Math.min(130, beatMs * 0.28));
        const nextDelay = Math.max(12, beatMs - (elapsed % beatMs));
        ensembleBeatTimer = setTimeout(tick, nextDelay);
      };
      tick();
    }
  
    async function connect(cfg) {
      if (!cfg || !cfg.session_id || !cfg.name) {
        console.warn('[MMF] Missing session_id or name — not connecting.');
        wsDispatchState('error');
        return;
      }
  
      lastCfg = { ...cfg };
      clearTimers();
      wsDispatchState('connecting');

      let joinToken = '';
      try {
        joinToken = await requestJoinToken(cfg);
      } catch (e) {
        console.warn('[MMF] Failed to obtain join token:', e?.message || e);
        wsDispatchState('error');
        return;
      }
  
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
          name: cfg.name,
          client_uuid: getOrMakeClientUUID(),
          join_token: joinToken,
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
          // Accept these as valid handshake replies from the relay
          case 'hello/ack':
          case 'joined':
          case 'welcome':
          case 'ok':
            if (ackTimer) { clearTimeout(ackTimer); ackTimer = null; }
            wsDispatchState('connected');
            console.log('[MMF] ✅ Connected to relay session:', data.data);
            break;
        
          case 'system/pong':
            break;

          case 'session/config':
            window.dispatchEvent(new CustomEvent('session:config', { detail: data.data || {} }));
            startEnsembleClock(data.data || {});
            break;

          case 'session/host-note':
            window.dispatchEvent(new CustomEvent('session:host-note', { detail: data.data || {} }));
            break;

          case 'server/performer-config':
            window.dispatchEvent(new CustomEvent('session:performer-config', { detail: data.data || {} }));
            break;
        
          case 'error':
          case 'server/reject':
            if (ackTimer) { clearTimeout(ackTimer); ackTimer = null; }
            console.warn('[MMF] server says:', data);
            wsDispatchState('error');
            break;
        
          default:
            // session/*, server/*, midi/*, gesture/* — just log for now
            console.log('[MMF] <=', data);
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
      if (ensembleBeatTimer) { clearTimeout(ensembleBeatTimer); ensembleBeatTimer = null; }
      document.body?.classList.remove('session-beat', 'session-downbeat');
      wsDispatchState('disconnected');
    }
  
    const MMFRelay = {
      isConnected: () => !!socket && socket.readyState === WebSocket.OPEN,
      getState:     () => window.wsConnectionState,
      getSession:   () => ({ ...lastCfg }),
      send(type, payload = {}) { safeSend({ type, ...payload }); },
      sendGesture(gestureName, value) {
        if (!lastCfg) return;
        safeSend({ type: 'gesture/update', data: { name: gestureName, gesture: gestureName, value } });
      },
      sendMidi(noteOrCc) {
        if (!lastCfg) return;
        const map = { noteon: 'midi/note_on', noteoff: 'midi/note_off', cc: 'midi/cc' };
        const payload = asObj(noteOrCc);
        const inferredKind = payload.kind || payload.type || '';
        const t = map[inferredKind] || (inferredKind === 'midi/note_on' ? 'midi/note_on' : (inferredKind === 'midi/note_off' ? 'midi/note_off' : (inferredKind === 'midi/cc' ? 'midi/cc' : null)));
        if (t) safeSend({ type: t, data: payload });
      },
      disconnect: () => disconnect(true),
    };
    window.MMFRelay = MMFRelay;
  
    // UI hooks
    window.addEventListener('session:connect', (e) => {
      const { session_id, password, name, relay_url } = e.detail || {};
      const q = new URLSearchParams(window.location.search);
      const localDevelopment = LOCAL_DEVELOPMENT_HOSTNAMES.has(window.location.hostname);
      window.sessionConfig.session_id = session_id || '';
      window.sessionConfig.password   = password   || '';
      window.sessionConfig.name       = name       || '';
      window.sessionConfig.relay_url  = localDevelopment ? (relay_url || '') : '';
      window.sessionConfig.console_api = localDevelopment ? (q.get('console_api') || '') : '';
      window.sessionConfig.invite_token = q.get('invite_token') || '';
  
      // Wake Render service with a timeout, then try WS regardless
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 6000);
      fetch(relayHealthUrl(window.sessionConfig.relay_url), { signal: controller.signal })
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

    window.addEventListener('mmf:auth-signed-out', () => {
      disconnect(true);
    });

    // Bridge app-level events -> relay frames (supports obfuscated/legacy emitters)
    window.addEventListener('gesture/update', (evt) => {
      if (!MMFRelay.isConnected()) return;
      const d = readDetail(evt);
      const name = d.name || d.gesture;
      const value = Number(d.value);
      if (!name || Number.isNaN(value)) return;
      safeSend({ type: 'gesture/update', data: { name, gesture: name, value } });
    });

    window.addEventListener('performance/target', (evt) => {
      if (!MMFRelay.isConnected()) return;
      const d = readDetail(evt);
      safeSend({ type: 'performance/target', data: {
        cellIndex: Number(d.cellIndex),
        midi: d.midi == null ? null : Number(d.midi),
        rows: Number(d.rows),
        cols: Number(d.cols),
        gateOpen: Boolean(d.gateOpen),
      }});
    });

    window.addEventListener('performance/gate_on', (evt) => {
      if (!MMFRelay.isConnected()) return;
      const d = readDetail(evt);
      safeSend({ type: 'performance/gate_on', data: {
        note: d.note == null ? null : Number(d.note),
        gateSource: d.gateSource || null,
        cellIndex: d.cellIndex == null ? null : Number(d.cellIndex),
        ts: Date.now(),
      }});
    });

    window.addEventListener('performance/gate_off', (evt) => {
      if (!MMFRelay.isConnected()) return;
      const d = readDetail(evt);
      safeSend({ type: 'performance/gate_off', data: {
        note: d.note == null ? null : Number(d.note),
        gateSource: d.gateSource || null,
        ts: Date.now(),
      }});
    });

    window.addEventListener('midi/cc', (evt) => {
      if (!MMFRelay.isConnected()) return;
      const d = readDetail(evt);
      safeSend({ type: 'midi/cc', data: {
        kind: 'cc',
        channel: d.channel,
        cc: d.cc,
        value: d.value,
        name: d.name || d.gesture || null,
      }});
    });

    window.addEventListener('midi/note_on', (evt) => {
      if (!MMFRelay.isConnected()) return;
      const d = readDetail(evt);
      safeSend({ type: 'midi/note_on', data: {
        kind: 'noteon',
        channel: d.channel,
        name: d.name || d.gesture || null,
        gesture: d.gesture || d.name || null,
        note: d.note,
        vel: d.vel ?? d.velocity,
      }});
    });

    window.addEventListener('midi/note_off', (evt) => {
      if (!MMFRelay.isConnected()) return;
      const d = readDetail(evt);
      safeSend({ type: 'midi/note_off', data: {
        kind: 'noteoff',
        channel: d.channel,
        name: d.name || d.gesture || null,
        gesture: d.gesture || d.name || null,
        note: d.note,
        vel: d.vel ?? d.velocity ?? 0,
      }});
    });

    window.addEventListener('face/landmarks', (evt) => {
      if (!MMFRelay.isConnected()) return;
      const d = readDetail(evt);
      const incoming = Array.isArray(d.points) ? d.points : [];
      if (!incoming.length) return;
      const points = incoming
        .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }));
      if (!points.length) return;
      safeSend({ type: 'face/landmarks', data: {
        points,
        ts: Number(d.ts) || Date.now(),
      }});
    });
  
    console.log('[MMF] ws-bridge loaded');
  })();
  
