/**
 * MIDImyFACE Live — Participant session
 * Handles camera, face mesh (MediaPipe), gesture extraction, and relay posting.
 * Landmark indices match the main MIDImyFACE source: src/script.js.
 */

const GESTURE_POST_INTERVAL_MS = 100;  // 10 Hz: responsive without flooding the relay
const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619';

// Landmark indices used in the main script
const LM = {
  topLip:     13,
  bottomLip:  14,
  leftMouth:  61,
  rightMouth: 291,
  leftEyeTop: 159,
  leftEyeBot: 145,
  rightEyeTop:386,
  rightEyeBot:374,
  nose:        1,
};

// ------- math helpers -------
function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ------- gesture computation (matches src/script.js) -------
export function extractGestures(landmarks, canvasWidth, canvasHeight) {
  const W = canvasWidth;
  const H = canvasHeight;

  function lm(i)  { return landmarks[i]; }
  function x(i)   { return lm(i).x * W; }
  function y(i)   { return lm(i).y * H; }

  return {
    mouthOpen: dist(x(LM.topLip), y(LM.topLip), x(LM.bottomLip), y(LM.bottomLip)),
    smile:     dist(x(LM.leftMouth), y(LM.leftMouth), x(LM.rightMouth), y(LM.rightMouth)),
    leftWink:  dist(x(LM.leftEyeTop), y(LM.leftEyeTop), x(LM.leftEyeBot), y(LM.leftEyeBot)),
    rightWink: dist(x(LM.rightEyeTop), y(LM.rightEyeTop), x(LM.rightEyeBot), y(LM.rightEyeBot)),
    noseX:     lm(LM.nose).x * W,
    noseY:     lm(LM.nose).y * H,
    accent:    0,
  };
}

// ------- smooth landmarks (matches src/script.js) -------
export function smoothLandmarks(raw, cache) {
  return raw.map((lm, i) => {
    if (!cache[i]) { cache[i] = { x: lm.x, y: lm.y, z: lm.z }; }
    cache[i].x = lerp(cache[i].x, lm.x, 0.4);
    cache[i].y = lerp(cache[i].y, lm.y, 0.4);
    cache[i].z = lerp(cache[i].z, lm.z, 0.4);
    return cache[i];
  });
}

// ------- session class -------
export class ParticipantSession {
  constructor({ relayOrigin, token, session, onStatus, onGestures }) {
    this.relayOrigin   = relayOrigin;
    this.token         = token;
    this.session       = session;
    this.onStatus      = onStatus || (() => {});
    this.onGestures    = onGestures || (() => {});
    this.running       = false;
    this._lmCache      = {};
    this._lastGestures = null;
    this._lastLandmarks = null;
    this._accentLandmarks = null;
    this._postTimer    = null;
    this._video        = null;
    this._canvas       = null;
    this._stream       = null;
    this._faceMesh     = null;
  }

  async start(videoEl, canvasEl) {
    this._video  = videoEl;
    this._canvas = canvasEl;
    this.running = true;

    this.onStatus({ phase: 'camera', message: 'Requesting camera…' });
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
    } catch (err) {
      this.onStatus({ phase: 'error', message: `Camera denied: ${err.message}` });
      await this._stopRemote();
      return;
    }

    this._video.srcObject = this._stream;
    await new Promise((resolve) => { this._video.onloadedmetadata = resolve; });
    await this._video.play();
    this._clearCanvas(this._video.videoWidth || 640, this._video.videoHeight || 480);

    this.onStatus({ phase: 'model', message: 'Loading face model…' });
    try {
      await this._loadFaceMesh();
    } catch (err) {
      this.onStatus({ phase: 'error', message: `Model failed: ${err.message}` });
      await this._stopRemote();
      this._stream?.getTracks().forEach((track) => track.stop());
      return;
    }

    this.onStatus({ phase: 'active', message: 'Active — make faces!' });
    this._schedulePost();
    this._processLoop();
  }

  async stop({ notifyRelay = true } = {}) {
    this.running = false;
    clearTimeout(this._postTimer);
    this._stream?.getTracks().forEach((t) => t.stop());
    this._faceMesh?.close?.();
    this._clearCanvas(this._canvas?.width || 640, this._canvas?.height || 480);
    if (notifyRelay) await this._stopRemote();
    this.onStatus({ phase: 'stopped', message: 'Session ended.' });
  }

  async _loadFaceMesh() {
    // Dynamic import of MediaPipe from CDN — no bundler needed
    await _loadScript(`${MEDIAPIPE_CDN}/face_mesh.js`);
    const FaceMesh = window.FaceMesh;
    if (typeof FaceMesh !== 'function') throw new Error('FaceMesh not available');

    this._faceMesh = new FaceMesh({ locateFile: (f) => `${MEDIAPIPE_CDN}/${f}` });
    this._faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    this._faceMesh.onResults((results) => this._onFaceResults(results));
    await this._faceMesh.initialize();
  }

  _onFaceResults(results) {
    if (!this.running) return;
    const lms = results?.multiFaceLandmarks?.[0];
    if (!lms || lms.length === 0) {
      this._clearCanvas(this._video.videoWidth || 640, this._video.videoHeight || 480);
      return;
    }

    const smoothed = smoothLandmarks(lms, this._lmCache);
    const W = this._video.videoWidth  || 640;
    const H = this._video.videoHeight || 480;
    const gestures = extractGestures(smoothed, W, H);
    gestures.accent = this._computeAccent(smoothed, W, H);
    this._lastGestures = gestures;
    this._lastLandmarks = smoothed.map((landmark) => ({ x: landmark.x, y: landmark.y }));
    this.onGestures(gestures, smoothed);

    // Draw landmark overlay on canvas
    this._drawLandmarks(smoothed, W, H);
  }

  _computeAccent(landmarks, W, H) {
    const indices = [1, 10, 13, 14, 61, 152, 263, 291];
    const current = indices.map((index) => landmarks[index]).filter(Boolean);
    if (!this._accentLandmarks || this._accentLandmarks.length !== current.length) {
      this._accentLandmarks = current.map((landmark) => ({ x: landmark.x, y: landmark.y }));
      return 0;
    }
    let totalPixels = 0;
    current.forEach((landmark, index) => {
      const previous = this._accentLandmarks[index];
      totalPixels += Math.hypot((landmark.x - previous.x) * W, (landmark.y - previous.y) * H);
      previous.x = landmark.x;
      previous.y = landmark.y;
    });
    return Math.min(100, totalPixels / Math.max(1, current.length) * 4);
  }

  _drawLandmarks(landmarks, W, H) {
    const ctx = this._canvas?.getContext('2d');
    if (!ctx) return;
    this._canvas.width  = this._video.videoWidth  || W;
    this._canvas.height = this._video.videoHeight || H;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);
    ctx.fillStyle = '#67ff9e';
    const dotRadius = Math.max(2, Math.round(Math.min(this._canvas.width, this._canvas.height) * 0.005));
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc((1 - lm.x) * this._canvas.width, lm.y * this._canvas.height, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _clearCanvas(W, H) {
    const ctx = this._canvas?.getContext('2d');
    if (!ctx || !this._canvas) return;
    this._canvas.width = W;
    this._canvas.height = H;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);
  }

  async _processLoop() {
    if (!this.running) return;
    if (this._video.readyState >= 2 && this._faceMesh) {
      try { await this._faceMesh.send({ image: this._video }); } catch (_e) { /* ignore frame errors */ }
    }
    requestAnimationFrame(() => this._processLoop());
  }

  _schedulePost() {
    if (!this.running) return;
    this._postTimer = setTimeout(async () => {
      if (this._lastGestures) {
        try {
          await this._postGestures(this._lastGestures, this._lastLandmarks || []);
        } catch (error) {
          if (error?.status === 401 || error?.status === 410) {
            this.running = false;
            this._stream?.getTracks().forEach((track) => track.stop());
            this._faceMesh?.close?.();
            this.onStatus({ phase: 'expired', message: 'Your turn is complete.' });
            return;
          }
        }
      }
      this._schedulePost();
    }, GESTURE_POST_INTERVAL_MS);
  }

  async _postGestures(gestures, landmarks) {
    const url = `${this.relayOrigin}/api/live/session/gestures`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ gestures, landmarks }),
    });
    if (!response.ok) {
      const error = new Error(`gesture_post_${response.status}`);
      error.status = response.status;
      throw error;
    }
  }

  async _stopRemote() {
    if (!this.token) return;
    const token = this.token;
    this.token = '';
    try {
      await fetch(`${this.relayOrigin}/api/live/session/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
        keepalive: true,
      });
    } catch {
      // The server-side expiry remains the final hardware safety boundary.
    }
  }
}

// ------- helpers -------
function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload  = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(s);
  });
}
