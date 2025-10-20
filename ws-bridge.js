// ws-bridge.js
(() => {
  // >>> REPLACE with your Render websocket URL <<<
  const DEFAULT_RELAY_URL = 'wss://<your-service>.onrender.com/ws';

  let ws = null;
  let hb = null; // heartbeat timer
  const HB_MS = 25000;

  const setState = (state) => {
    window.dispatchEvent(new CustomEvent('ws:setState', { detail: { state } }));
  };

  const safeClose = () => {
    try { hb && clearInterval(hb); } catch {}
    hb = null;
    if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, 'client_close');
    ws = null;
  };

  const startHeartbeat = () => {
    hb && clearInterval(hb);
    hb = setInterval(() => {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'system/ping', data: { t: Date.now() } }));
        }
      } catch {}
    }, HB_MS);
  };

  // Public helper to emit performer events to host
  window.mmfEmit = (type, data = {}) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type, data }));
    return true;
  };

  // Connect when your UI fires 'session:connect'
  window.addEventListener('session:connect', (e) => {
    const d = e.detail || {};
    // If your UI has a Relay URL field, use it; otherwise fallback to DEFAULT_RELAY_URL
    const relayURL = (d.relay_url || DEFAULT_RELAY_URL).trim();
    const session_id = (d.session_id || '').trim();
    const password = (d.password || '').trim();
    const name = (d.name || '').trim();

    if (!relayURL || !session_id || !name) {
      alert('Missing relay URL, session_id or name');
      return;
    }

    safeClose();
    setState('connecting');

    try {
      ws = new WebSocket(relayURL);
    } catch (err) {
      console.error('WS init error', err);
      setState('error');
      return;
    }

    ws.onopen = () => {
      setState('connected');

      const client_uuid =
        (window.localStorage && localStorage.getItem('mmf_client_uuid')) ||
        (crypto.randomUUID?.() || String(Math.random()));

      try { localStorage.setItem('mmf_client_uuid', client_uuid); } catch {}

      // Performer “hello”
      ws.send(JSON.stringify({
        type: 'hello',
        role: 'performer',
        session_id, password, name, client_uuid
      }));

      startHeartbeat();
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'server/assigned') {
          console.log('Assigned channel =>', msg.data?.channel);
        }
        // You can route other messages here
      } catch {
        console.log('WS <=', ev.data);
      }
    };

    ws.onerror = (err) => {
      console.error('WS error', err);
      setState('error');
    };

    ws.onclose = () => {
      setState('disconnected');
      safeClose();
    };
  });

  // Disconnect hook
  window.addEventListener('session:disconnect', () => {
    safeClose();
    setState('disconnected');
  });
})();
