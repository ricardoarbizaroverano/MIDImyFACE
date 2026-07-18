/**
 * MIDImyFACE Live — Participant session
 * Handles camera, face mesh (MediaPipe), gesture extraction, and relay posting.
 * Landmark indices match the main MIDImyFACE source: src/script.js.
 */

const GESTURE_POST_INTERVAL_MS = 50;  // ~20 Hz; Pi interpolates between network snapshots
const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619';
const PERCUSSION_SENSITIVITY = 5;
export const WINK_HOLD_MS = 250;
const LANDMARK_SMOOTHING = 0.58;
export const GESTURE_IDS = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY', 'accent'];
export const GRID_TRIGGER_IDS = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY', 'accent', 'mouthOpen'];
const MOUTH_GATE_OPEN_PX = 10;
const MOUTH_GATE_CLOSE_PX = 7;
const MOUTH_LANDMARKS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78, 191, 80, 81, 82, 13, 312, 311, 310, 415];
const GRID_VISUALS = globalThis.MMFPerformanceGridVisuals || {
  GRID_COLS: 4,
  GRID_ROWS: 2,
  FLASH_DURATION_MS: 240,
  HIT_EFFECT_DURATION_MS: 620,
  getCellVisual({ index, activeCellIndex = -1, gateOpen = false, flashCellIndex = -1, flashUntil = 0, now = 0 } = {}) {
    const selected = index === activeCellIndex;
    const firing = selected && flashCellIndex === index && now < flashUntil;
    if (firing) {
      return { firing, selected, fill: [185, 255, 106, 0.34], stroke: [255, 255, 255, 1], lineWidth: 4, shadow: [185, 255, 106, 1], shadowBlur: 22, label: [5, 7, 8, 1] };
    }
    if (selected) {
      return { firing, selected, fill: [50, 255, 140, gateOpen ? 0.24 : 0.12], stroke: [185, 255, 106, 0.88], lineWidth: 2.5, shadow: [54, 246, 178, 1], shadowBlur: 8, label: [255, 255, 255, gateOpen ? 1 : 0.88] };
    }
    return { firing, selected, fill: [20, 140, 60, 0.055], stroke: [124, 255, 79, 0.27], lineWidth: 1, shadow: null, shadowBlur: 0, label: [185, 255, 106, 0.42] };
  },
  createHitEffect(pad, startedAt = 0) { return { pad, startedAt }; },
  getHitEffectProgress(effect, now = 0) { return Math.max(0, Math.min(1, (now - Number(effect?.startedAt || 0)) / 620)); },
  getHitEffectStyle(progress) {
    const alpha = Math.max(0, 1 - progress);
    return { alpha, stroke: progress < 0.45 ? [255, 255, 255, alpha] : [185, 255, 106, alpha], lineWidth: Math.max(1, 5 * (1 - progress)), shadow: [124, 255, 79, alpha], shadowBlur: 18 * (1 - progress), label: [255, 255, 255, alpha] };
  },
  filterActiveHitEffects(effects, now = 0) { return Array.isArray(effects) ? effects.filter((effect) => (now - Number(effect?.startedAt || 0)) < 620) : []; },
  getNosePulse(now = 0) { return 1 + Math.sin(now / 125) * 0.1; },
};
const GRID_COLS = GRID_VISUALS.GRID_COLS || 4;
const GRID_ROWS = GRID_VISUALS.GRID_ROWS || 2;

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

function rgba(color) {
  if (!Array.isArray(color) || color.length < 4) return 'rgba(255,255,255,1)';
  return `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},${Math.max(0, Math.min(1, color[3]))})`;
}

function countryFlag(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '';
  return normalized.replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

function formatParticipantLabel(peer = {}) {
  const nickname = String(peer.nickname || 'Guest').trim() || 'Guest';
  const flag = countryFlag(peer.countryCode);
  return flag ? `${nickname} ${flag}` : nickname;
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
    cache[i].x = lerp(cache[i].x, lm.x, LANDMARK_SMOOTHING);
    cache[i].y = lerp(cache[i].y, lm.y, LANDMARK_SMOOTHING);
    cache[i].z = lerp(cache[i].z, lm.z, LANDMARK_SMOOTHING);
    return cache[i];
  });
}

// This is the same sudden-movement trigger used by the main page's
// percussion mode (src/script.js: handleGestureDisparador). Keeping the
// decision in the participant browser avoids trying to reconstruct motion
// from delayed network samples on the Raspberry Pi.
export function getGestureTriggerProfile(gestureId) {
  const profiles = {
    mouthOpen: { mode: 'ascending', activationRatio: 0.06, rearmRatio: 0.028, spanScale: 1, speedScale: 1, minRawDelta: 4 },
    smile: { mode: 'ascending', activationRatio: 0.05, rearmRatio: 0.024, spanScale: 0.55, speedScale: 0.75, minRawDelta: 3 },
    leftWink: { mode: 'descending', activationRatio: 0.14, rearmRatio: 0.08, spanScale: 0.14, speedScale: 0.26, minRawDelta: 1.5 },
    rightWink: { mode: 'descending', activationRatio: 0.14, rearmRatio: 0.08, spanScale: 0.14, speedScale: 0.26, minRawDelta: 1.5 },
    noseX: { mode: 'bidirectional', activationRatio: 0.055, rearmRatio: 0.02, spanScale: 0.12, speedScale: 0.48, minRawDelta: 6 },
    noseY: { mode: 'bidirectional', activationRatio: 0.05, rearmRatio: 0.02, spanScale: 0.1, speedScale: 0.45, minRawDelta: 5 },
    // Accent is the existing seventh live channel. It uses the exact same
    // trigger state machine on whole-face motion instead of a held distance.
    accent: { mode: 'ascending', activationRatio: 0.05, rearmRatio: 0.025, spanScale: 0.12, speedScale: 0.35, minRawDelta: 4 },
  };
  return profiles[gestureId] || profiles.mouthOpen;
}

export function createGestureTriggerState() {
  return {
    lastValue: null,
    lastSampleTime: 0,
    lastTriggerTime: 0,
    restValue: null,
    armed: true,
    closedSince: null,
  };
}

function mapValue(value, inMin, inMax, outMin, outMax) {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

export function evaluateGestureTrigger(
  gestureId,
  currentValue,
  state,
  { sensitivity = PERCUSSION_SENSITIVITY, min = 0, max = 200, now = Date.now() } = {},
) {
  const lastValue = state.lastValue;
  const profile = getGestureTriggerProfile(gestureId);
  let triggered = false;

  if (!Number.isFinite(state.restValue)) state.restValue = currentValue;

  if (sensitivity > 0 && lastValue !== null && state.lastSampleTime) {
    const elapsedMs = Math.max(16, now - state.lastSampleTime);
    const calibratedSpan = Number.isFinite(min) && Number.isFinite(max) && max > min ? max - min : 200;
    const delta = currentValue - lastValue;
    const absDelta = Math.abs(delta);
    const restValue = Number.isFinite(state.restValue) ? state.restValue : currentValue;
    const offsetFromRest = currentValue - restValue;
    const absOffsetFromRest = Math.abs(offsetFromRest);
    const effectiveSpan = Math.max(calibratedSpan * profile.spanScale, profile.minRawDelta * 2, 1);
    const activationDelta = Math.max(profile.minRawDelta, effectiveSpan * profile.activationRatio);
    const rearmDelta = Math.max(profile.minRawDelta * 0.5, effectiveSpan * profile.rearmRatio);

    // Winks intentionally use inverse/dwell logic: the eye aperture must stay
    // closed for 250 ms. A normal short blink therefore never becomes a hit.
    if (gestureId === 'leftWink' || gestureId === 'rightWink') {
      const isClosed = currentValue <= restValue - activationDelta;
      const isOpenAgain = currentValue >= restValue - rearmDelta;

      if (state.armed && isClosed) {
        if (!Number.isFinite(state.closedSince)) state.closedSince = now;
        if (now - state.closedSince >= WINK_HOLD_MS && now - state.lastTriggerTime > WINK_HOLD_MS) {
          triggered = true;
          state.lastTriggerTime = now;
          state.armed = false;
        }
      } else if (isOpenAgain) {
        state.closedSince = null;
        if (!state.armed) state.armed = true;
        state.restValue = lerp(restValue, currentValue, 0.18);
      }

      state.lastValue = currentValue;
      state.lastSampleTime = now;
      return triggered;
    }

    const normalizedSpeed = absDelta / effectiveSpan / (elapsedMs / 1000);
    const triggerSpeed = mapValue(sensitivity, 1, 10, 3.2, 0.22) * profile.speedScale;
    const cooldownMs = 220;
    const directionOk =
      (profile.mode === 'ascending' && delta > 0 && offsetFromRest >= activationDelta) ||
      (profile.mode === 'descending' && delta < 0 && -offsetFromRest >= activationDelta) ||
      (profile.mode === 'bidirectional' && absOffsetFromRest >= activationDelta && offsetFromRest * delta > 0);

    if (
      state.armed &&
      absDelta >= Math.max(profile.minRawDelta * 0.6, 1) &&
      directionOk &&
      normalizedSpeed >= triggerSpeed &&
      now - state.lastTriggerTime > cooldownMs
    ) {
      triggered = true;
      state.lastTriggerTime = now;
      state.armed = false;
    }

    if (!state.armed) {
      if (absOffsetFromRest <= rearmDelta) {
        state.armed = true;
        state.restValue = currentValue;
      }
    } else if (absOffsetFromRest <= rearmDelta) {
      state.restValue = lerp(restValue, currentValue, 0.18);
    }
  }

  state.lastValue = currentValue;
  state.lastSampleTime = now;
  return triggered;
}

export function gestureRange(gestureId, width, height) {
  const ranges = {
    mouthOpen: { min: 0, max: 45 },
    smile: { min: 10, max: 90 },
    leftWink: { min: 5, max: 70 },
    rightWink: { min: 5, max: 70 },
    noseX: { min: 0, max: width },
    noseY: { min: 0, max: height },
    accent: { min: 0, max: 100 },
  };
  return ranges[gestureId] || { min: 0, max: 200 };
}

export function resolveGridPad(nose, { mirrored = true } = {}) {
  if (!nose || !Number.isFinite(nose.x) || !Number.isFinite(nose.y)) return -1;
  const x = Math.max(0, Math.min(0.999999, mirrored ? 1 - nose.x : nose.x));
  const y = Math.max(0, Math.min(0.999999, nose.y));
  return Math.floor(y * GRID_ROWS) * GRID_COLS + Math.floor(x * GRID_COLS);
}

// ------- session class -------
export class ParticipantSession {
  constructor({ relayOrigin, token, session, onStatus, onGestures, onTrigger }) {
    this.relayOrigin   = relayOrigin;
    this.token         = token;
    this.session       = session;
    this.onStatus      = onStatus || (() => {});
    this.onGestures    = onGestures || (() => {});
    this.onTrigger     = onTrigger || (() => {});
    this.running       = false;
    this._lmCache      = {};
    this._lastGestures = null;
    this._lastLandmarks = null;
    this._accentLandmarks = null;
    this._triggerCounts = Object.fromEntries(GESTURE_IDS.map((gestureId) => [gestureId, 0]));
    this._activePad = -1;
    this._mouthGateOpen = false;
    this._padFlashUntil = 0;
    this._hitEffects = [];
    this._peerParticipants = [];
    this._postTimer    = null;
    this._video        = null;
    this._canvas       = null;
    this._ctx          = null;
    this._stream       = null;
    this._faceMesh     = null;
    this._renderFrameHandle = 0;
    this._videoFrameHandle = 0;
    this._faceMeshBusy = false;
    this._lastProcessedVideoTime = -1;
    this._latestLandmarks = null;
    this._latestMouthOpen = 0;
    this._canvasMetrics = { cssWidth: 0, cssHeight: 0, dpr: 1 };
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
    this._ctx = this._canvas?.getContext('2d', { alpha: false, desynchronized: true }) || null;
    this._clearCanvas();

    this.onStatus({ phase: 'model', message: 'Loading face model…' });
    try {
      await this._loadFaceMesh();
    } catch (err) {
      this.onStatus({ phase: 'error', message: `Model failed: ${err.message}` });
      await this._stopRemote();
      this._stream?.getTracks().forEach((track) => track.stop());
      return;
    }

    this.onStatus({ phase: 'active', message: 'Point with your nose. Open your mouth to play.' });
    this._schedulePost();
    this._startRenderLoop();
    this._startProcessingLoop();
  }

  async stop({ notifyRelay = true } = {}) {
    this.running = false;
    clearTimeout(this._postTimer);
    if (this._renderFrameHandle) cancelAnimationFrame(this._renderFrameHandle);
    if (this._videoFrameHandle && typeof this._video?.cancelVideoFrameCallback === 'function') {
      this._video.cancelVideoFrameCallback(this._videoFrameHandle);
    }
    this._renderFrameHandle = 0;
    this._videoFrameHandle = 0;
    this._stream?.getTracks().forEach((t) => t.stop());
    this._faceMesh?.close?.();
    this._clearCanvas();
    if (notifyRelay) await this._stopRemote();
    this.onStatus({ phase: 'stopped', message: 'Session ended.' });
  }

  async _loadFaceMesh() {
    // Dynamic import of MediaPipe from CDN — no bundler needed
    await _loadScript(`${MEDIAPIPE_CDN}/face_mesh.js`);
    const FaceMesh = window.FaceMesh;
    if (typeof FaceMesh !== 'function') throw new Error('FaceMesh not available');

    this._faceMesh = new FaceMesh({ locateFile: (f) => `${MEDIAPIPE_CDN}/${f}` });
    this._faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    this._faceMesh.onResults((results) => this._onFaceResults(results));
    await this._faceMesh.initialize();
  }

  _onFaceResults(results) {
    if (!this.running) return;
    const lms = results?.multiFaceLandmarks?.[0];
    if (!lms || lms.length === 0) {
      this._latestLandmarks = null;
      this._latestMouthOpen = 0;
      return;
    }

    const smoothed = smoothLandmarks(lms, this._lmCache);
    const W = this._video.videoWidth  || 640;
    const H = this._video.videoHeight || 480;
    const gestures = extractGestures(smoothed, W, H);
    gestures.accent = this._computeAccent(smoothed, W, H);
    this._activePad = resolveGridPad(smoothed[LM.nose]);
    const shouldOpen = this._mouthGateOpen
      ? gestures.mouthOpen > MOUTH_GATE_CLOSE_PX
      : gestures.mouthOpen > MOUTH_GATE_OPEN_PX;
    if (shouldOpen && !this._mouthGateOpen && this._activePad >= 0) {
      const triggerId = GRID_TRIGGER_IDS[this._activePad];
      this._triggerCounts[triggerId] += 1;
      this._padFlashUntil = performance.now() + (GRID_VISUALS.FLASH_DURATION_MS || 240);
      this._hitEffects.push(GRID_VISUALS.createHitEffect(this._activePad, performance.now()));
      this.onTrigger(triggerId, this._activePad);
    }
    this._mouthGateOpen = shouldOpen;
    this._lastGestures = gestures;
    this._latestLandmarks = smoothed;
    this._lastLandmarks = smoothed;
    this._latestMouthOpen = gestures.mouthOpen;
    this.onGestures(gestures, smoothed);
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

  _drawLandmarks(landmarks, mouthOpen) {
    const ctx = this._ctx;
    if (!ctx) return;
    const { width, height } = this._resizeCanvasToDisplaySize();
    ctx.save();
    ctx.setTransform(this._canvasMetrics.dpr, 0, 0, this._canvasMetrics.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    for (const peer of this._peerParticipants) {
      if (!peer?.fresh || !Array.isArray(peer.landmarks)) continue;
      ctx.save();
      ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(peer.color || '') ? peer.color : '#8e6bff';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 5;
      for (const landmark of peer.landmarks) {
        if (!Number.isFinite(landmark?.x) || !Number.isFinite(landmark?.y)) continue;
        ctx.beginPath();
        ctx.arc((1 - landmark.x) * width, landmark.y * height, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      const anchor = peer.landmarks[10] || peer.landmarks[1];
      if (anchor) {
        ctx.shadowBlur = 8;
        ctx.font = `700 ${Math.max(10, width * 0.018)}px "Courier New", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(formatParticipantLabel(peer).slice(0, 22), (1 - anchor.x) * width, anchor.y * height - 12);
      }
      ctx.restore();
    }

    const ownColor = /^#[0-9a-f]{6}$/i.test(this.session?.color || '') ? this.session.color : '#67ff9e';
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ownColor;
    ctx.shadowColor = ownColor;
    ctx.shadowBlur = 2;
    const dotRadius = Math.max(0.75, Math.min(1.2, Math.min(width, height) * 0.0019));
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc((1 - lm.x) * width, lm.y * height, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();

    const cellW = width / GRID_COLS;
    const cellH = height / GRID_ROWS;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(22, Math.min(cellW, cellH) * 0.22)}px "Courier New", monospace`;
    const now = performance.now();
    for (let index = 0; index < GRID_COLS * GRID_ROWS; index += 1) {
      const col = index % GRID_COLS;
      const row = Math.floor(index / GRID_COLS);
      const visual = GRID_VISUALS.getCellVisual({
        index,
        activeCellIndex: this._activePad,
        gateOpen: this._mouthGateOpen,
        flashCellIndex: this._activePad,
        flashUntil: this._padFlashUntil,
        now,
      });
      ctx.fillStyle = rgba(visual.fill);
      ctx.strokeStyle = rgba(visual.stroke);
      ctx.lineWidth = visual.lineWidth;
      ctx.shadowColor = visual.shadow ? rgba(visual.shadow) : 'transparent';
      ctx.shadowBlur = visual.shadowBlur || 0;
      ctx.fillRect(col * cellW + 4, row * cellH + 4, cellW - 8, cellH - 8);
      ctx.strokeRect(col * cellW + 4, row * cellH + 4, cellW - 8, cellH - 8);
      ctx.fillStyle = rgba(visual.label);
      ctx.fillText(String(index + 1), col * cellW + cellW / 2, row * cellH + cellH / 2);
    }

    this._hitEffects = GRID_VISUALS.filterActiveHitEffects(this._hitEffects, now);
    for (const effect of this._hitEffects) {
      const progress = GRID_VISUALS.getHitEffectProgress(effect, now);
      const visual = GRID_VISUALS.getHitEffectStyle(progress);
      const col = effect.pad % GRID_COLS;
      const row = Math.floor(effect.pad / GRID_COLS);
      const cx = col * cellW + cellW / 2;
      const cy = row * cellH + cellH / 2;
      const radius = Math.min(cellW, cellH) * (0.12 + progress * 0.55);
      ctx.globalAlpha = visual.alpha;
      ctx.strokeStyle = rgba(visual.stroke);
      ctx.lineWidth = visual.lineWidth;
      ctx.shadowColor = rgba(visual.shadow);
      ctx.shadowBlur = visual.shadowBlur;
      ctx.strokeRect(cx - radius, cy - radius, radius * 2, radius * 2);
      for (let ray = 0; ray < 8; ray += 1) {
        const angle = (Math.PI * 2 * ray) / 8;
        const inner = radius * 0.72;
        const outer = radius * 1.12;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
        ctx.stroke();
      }
      ctx.fillStyle = rgba(visual.label);
      ctx.font = `700 ${Math.max(10, Math.min(cellW, cellH) * 0.09)}px "Courier New", monospace`;
      ctx.fillText('HIT!', cx, cy + radius * 0.72);
      ctx.globalAlpha = 1;
    }

    const nose = landmarks[LM.nose];
    if (nose) {
      const px = (1 - nose.x) * width;
      const py = nose.y * height;
      const pulse = GRID_VISUALS.getNosePulse(now);
      ctx.shadowColor = 'rgba(255,49,49,.72)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = 'rgba(255,70,70,.92)';
      ctx.beginPath();
      ctx.arc(px, py, 4.5 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,190,190,.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, 9 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    }

    const invitation = Math.max(0, Math.min(1, mouthOpen / MOUTH_GATE_OPEN_PX));
    ctx.fillStyle = this._mouthGateOpen ? '#ffffff' : '#c8c3ff';
    ctx.shadowColor = '#8e6bff';
    ctx.shadowBlur = 4 + invitation * 14;
    const mouthRadius = 1.25 + invitation * 1.45;
    for (const index of MOUTH_LANDMARKS) {
      const landmark = landmarks[index];
      if (!landmark) continue;
      ctx.beginPath();
      ctx.arc((1 - landmark.x) * width, landmark.y * height, mouthRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _resizeCanvasToDisplaySize() {
    if (!this._canvas || !this._ctx) {
      return { width: 640, height: 480 };
    }
    const rect = this._canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || this._video?.videoWidth || 640));
    const cssHeight = Math.max(1, Math.round(rect.height || this._video?.videoHeight || 480));
    const dprCap = cssWidth >= 700 ? 1.5 : 2;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, dprCap);
    if (
      this._canvasMetrics.cssWidth !== cssWidth
      || this._canvasMetrics.cssHeight !== cssHeight
      || this._canvasMetrics.dpr !== dpr
    ) {
      this._canvas.width = Math.max(1, Math.round(cssWidth * dpr));
      this._canvas.height = Math.max(1, Math.round(cssHeight * dpr));
      this._canvasMetrics = { cssWidth, cssHeight, dpr };
    }
    return { width: cssWidth, height: cssHeight };
  }

  _clearCanvas() {
    const ctx = this._ctx;
    if (!ctx || !this._canvas) return;
    const { width, height } = this._resizeCanvasToDisplaySize();
    ctx.save();
    ctx.setTransform(this._canvasMetrics.dpr, 0, 0, this._canvasMetrics.dpr, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  _startRenderLoop() {
    const render = () => {
      if (!this.running) return;
      if (this._latestLandmarks?.length) {
        this._drawLandmarks(this._latestLandmarks, this._latestMouthOpen);
      } else {
        this._clearCanvas();
      }
      this._renderFrameHandle = requestAnimationFrame(render);
    };
    this._renderFrameHandle = requestAnimationFrame(render);
  }

  _startProcessingLoop() {
    const step = async () => {
      if (!this.running) return;
      await this._processVideoFrame();
      if (!this.running) return;
      if (typeof this._video?.requestVideoFrameCallback === 'function') {
        this._videoFrameHandle = this._video.requestVideoFrameCallback(() => {
          step();
        });
      } else {
        this._renderFrameHandle = requestAnimationFrame(() => {
          step();
        });
      }
    };
    step();
  }

  async _processVideoFrame() {
    if (!this.running) return;
    if (!this._faceMesh || !this._video || this._video.readyState < 2 || this._faceMeshBusy) return;
    const currentTime = Number(this._video.currentTime || 0);
    if (currentTime === this._lastProcessedVideoTime) return;
    this._faceMeshBusy = true;
    this._lastProcessedVideoTime = currentTime;
    try {
      await this._faceMesh.send({ image: this._video });
    } catch (_e) {
      // Ignore transient frame errors and keep the loop alive.
    } finally {
      this._faceMeshBusy = false;
    }
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
      body: JSON.stringify({
        gestures,
        triggerCounts: this._triggerCounts,
        landmarks: Array.isArray(landmarks) ? landmarks.map((landmark) => ({ x: landmark.x, y: landmark.y })) : [],
        frameAspect: (this._video?.videoWidth || 640) / Math.max(1, this._video?.videoHeight || 480),
      }),
    });
    if (!response.ok) {
      const error = new Error(`gesture_post_${response.status}`);
      error.status = response.status;
      throw error;
    }
    const payload = await response.json().catch(() => ({}));
    this._peerParticipants = Array.isArray(payload.participants) ? payload.participants.slice(0, 2) : [];
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
