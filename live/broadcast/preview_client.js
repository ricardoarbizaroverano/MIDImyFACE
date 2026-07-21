export class PreviewClient {
  constructor({ relayOrigin, onStream, onStats, onConnectionState, onMediaState, role = 'waiting_viewer', sessionId = '' } = {}) {
    this.relayOrigin = String(relayOrigin || '').replace(/\/+$/, '');
    this.onStream = typeof onStream === 'function' ? onStream : () => {};
    this.onStats = typeof onStats === 'function' ? onStats : () => {};
    this.onConnectionState = typeof onConnectionState === 'function' ? onConnectionState : () => {};
    this.onMediaState = typeof onMediaState === 'function' ? onMediaState : () => {};
    this.role = String(role || 'waiting_viewer').trim().toLowerCase();
    this.sessionId = String(sessionId || '').trim();
    this.connectionId = '';
    this.token = '';
    this.pc = null;
    this.stream = null;
    this.pollTimer = 0;
    this.statsTimer = 0;
    this.closed = false;
    this.reconnectTimer = 0;
    this.disconnectTimer = 0;
    this.reconnectDelayMs = 600;
    this.lastStatsSnapshot = null;
    this.connectionState = 'connecting';
  }

  async start() {
    this.closed = false;
    this._emitConnectionState('connecting');
    await this._connect();
  }

  stop() {
    this.closed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.pollTimer = 0;
    this.statsTimer = 0;
    this.reconnectTimer = 0;
    this.disconnectTimer = 0;
    this._disconnectRemote().catch(() => {});
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.stream = null;
    this._emitMediaState({ hasVideo: false, hasAudio: false });
  }

  async _connect() {
    try {
      const connectPayload = await this._api('/api/live/preview/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: this.role, sessionId: this.sessionId }),
      });
      this.connectionId = String(connectPayload.connectionId || '');
      this.token = String(connectPayload.token || '');
      if (!this.connectionId) throw new Error('preview_connect_failed');
      if (!this.token) throw new Error('preview_token_missing');

      const iceServers = Array.isArray(connectPayload.iceServers) && connectPayload.iceServers.length
        ? connectPayload.iceServers
        : [{ urls: ['stun:stun.l.google.com:19302'] }];

      this.pc = new RTCPeerConnection({
        iceServers,
      });

      this.pc.ontrack = (event) => {
        if (!this.stream) this.stream = new MediaStream();
        const incomingTracks = event.streams?.[0]?.getTracks?.() || [];
        for (const track of [...incomingTracks, event.track].filter(Boolean)) {
          if (!this.stream.getTracks().some((existing) => existing.id === track.id)) {
            this.stream.addTrack(track);
          }
        }
        const tracks = this.stream?.getTracks?.() || [];
        const hasVideo = tracks.some((track) => track.kind === 'video' && track.enabled !== false);
        const hasAudio = tracks.some((track) => track.kind === 'audio' && track.enabled !== false);
        this._emitMediaState({ hasVideo, hasAudio });
        this.onStream(this.stream);
      };

      this.pc.onicecandidate = (event) => {
        if (!event.candidate || !this.connectionId) return;
        this._sendSignal('pi', 'ice', {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        }).catch(() => {});
      };

      this.pc.onconnectionstatechange = () => {
        const state = String(this.pc?.connectionState || '').toLowerCase();
        if (state === 'connected') {
          if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
          this.disconnectTimer = 0;
          this.reconnectDelayMs = 600;
          this._emitConnectionState('connected');
          return;
        }
        if (state === 'connecting' || state === 'new') {
          this._emitConnectionState('connecting');
          return;
        }
        if (state === 'disconnected') {
          this._emitConnectionState('reconnecting');
          this._scheduleDisconnectedReconnect();
          return;
        }
        if (state === 'failed' || state === 'closed') {
          this._emitConnectionState('reconnecting');
          this._scheduleReconnect();
        }
      };

      const offer = await this.pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
      await this.pc.setLocalDescription(offer);
      const localOffer = this.pc.localDescription || offer;
      await this._sendSignal('pi', 'offer', {
        type: localOffer.type,
        sdp: localOffer.sdp,
      });
      this._pollSignals();
      this._startStatsLoop();
    } catch {
      this._emitConnectionState('reconnecting');
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = 0;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = 0;
    if (this.connectionId && this.token) {
      this._disconnectRemote(this.connectionId, this.token).catch(() => {});
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.connectionId = '';
    this.token = '';
    this.lastStatsSnapshot = null;
    this.stream = null;
    this._emitMediaState({ hasVideo: false, hasAudio: false });
    this._emitConnectionState('reconnecting');
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(4000, this.reconnectDelayMs * 1.5);
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = 0;
      if (!this.closed) await this._connect();
    }, delay);
  }

  _scheduleDisconnectedReconnect() {
    if (this.closed || this.disconnectTimer || this.reconnectTimer) return;
    this.disconnectTimer = window.setTimeout(() => {
      this.disconnectTimer = 0;
      if (!this.closed && String(this.pc?.connectionState || '').toLowerCase() === 'disconnected') {
        this._scheduleReconnect();
      }
    }, 2500);
  }

  async _pollSignals() {
    if (this.closed || !this.connectionId) return;
    try {
      const payload = await this._api(`/api/live/preview/poll?role=viewer&connectionId=${encodeURIComponent(this.connectionId)}&token=${encodeURIComponent(this.token)}`);
      const signals = Array.isArray(payload.signals) ? payload.signals : [];
      for (const signal of signals) {
        await this._handleSignal(signal);
      }
    } catch {
      this._emitConnectionState('reconnecting');
      this._scheduleReconnect();
      return;
    }
    this.pollTimer = window.setTimeout(() => this._pollSignals(), 120);
  }

  async _handleSignal(signal) {
    if (!this.pc) return;
    const type = String(signal?.type || '');
    const data = signal?.data || {};
    if (type === 'answer' && data.sdp) {
      await this.pc.setRemoteDescription({ type: data.type || 'answer', sdp: data.sdp });
      return;
    }
    if (type === 'ice' && data.candidate) {
      await this.pc.addIceCandidate({
        candidate: data.candidate,
        sdpMid: data.sdpMid,
        sdpMLineIndex: data.sdpMLineIndex,
      });
      return;
    }
    if (type === 'disconnect') {
      this._emitConnectionState('reconnecting');
      this._scheduleReconnect();
    }
  }

  _emitConnectionState(nextState) {
    this.connectionState = nextState;
    this.onConnectionState(nextState);
  }

  _emitMediaState(state) {
    this.onMediaState({ hasVideo: Boolean(state?.hasVideo), hasAudio: Boolean(state?.hasAudio) });
  }

  async _sendSignal(to, type, data) {
    if (!this.connectionId || !this.token) return;
    await this._api('/api/live/preview/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: this.connectionId,
        token: this.token,
        to,
        type,
        data,
      }),
    });
  }

  async _disconnectRemote(connectionId = this.connectionId, token = this.token) {
    if (!connectionId || !token) return;
    await this._api('/api/live/preview/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId, token }),
    });
  }

  _startStatsLoop() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = window.setInterval(async () => {
      if (!this.pc) return;
      try {
        const stats = await this.pc.getStats();
        let fps = 0;
        let framesDecoded = 0;
        let jitter = 0;
        for (const report of stats.values()) {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            fps = Number(report.framesPerSecond || fps || 0);
            framesDecoded = Number(report.framesDecoded || 0);
            jitter = Number(report.jitter || 0);
            const now = report.timestamp || performance.now();
            const received = Number(report.framesReceived || 0);
            const remoteTsMs = Number(report.lastPacketReceivedTimestamp || 0);
            let receiveFps = 0;
            if (this.lastStatsSnapshot && now > this.lastStatsSnapshot.atMs && received >= this.lastStatsSnapshot.framesReceived) {
              receiveFps = (received - this.lastStatsSnapshot.framesReceived) / ((now - this.lastStatsSnapshot.atMs) / 1000);
            }
            this.lastStatsSnapshot = { atMs: now, framesReceived: received };
            const frameAgeMs = remoteTsMs > 0 ? Math.max(0, now - remoteTsMs) : 0;
            this.onStats({
              fps,
              receiveFps: Number(receiveFps.toFixed(2)),
              framesDecoded,
              framesReceived: received,
              jitter,
              frameAgeMs: Number(frameAgeMs.toFixed(1)),
            });
            return;
          }
        }
        this.onStats({ fps, framesDecoded, jitter, frameAgeMs: 0, receiveFps: 0, framesReceived: 0 });
      } catch {
        // Ignore stats errors and keep stream running.
      }
    }, 1000);
  }

  async _api(path, options = {}) {
    const response = await fetch(`${this.relayOrigin}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `http_${response.status}`);
    }
    return payload;
  }
}
