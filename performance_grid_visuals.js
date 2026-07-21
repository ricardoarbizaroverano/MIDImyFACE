(function attachPerformanceGridVisuals(globalScope) {
  const GRID_COLS = 4;
  const GRID_ROWS = 2;
  const FLASH_DURATION_MS = 240;
  const HIT_EFFECT_DURATION_MS = 620;
  const PERFORMER_TRIGGER_COOLDOWN_MS = 100;
  const PERFORMER_NOSE_INDEX = 1;
  const PERFORMER_MOUTH_INDICES = Object.freeze([
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
    308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78,
    191, 80, 81, 82, 13, 312, 311, 310, 415,
  ]);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeAlpha(value) {
    return Math.round(clamp(value, 0, 1) * 1000) / 1000;
  }

  function toColor(r, g, b, a = 1) {
    return [r, g, b, normalizeAlpha(a)];
  }

  function getCellVisual({ index, activeCellIndex = -1, gateOpen = false, flashCellIndex = -1, flashUntil = 0, now = 0 } = {}) {
    const selected = index === activeCellIndex;
    const firing = selected && flashCellIndex === index && now < flashUntil;
    if (firing) {
      return {
        firing,
        selected,
        fill: toColor(185, 255, 106, 0.34),
        stroke: toColor(255, 255, 255, 1),
        lineWidth: 4,
        shadow: toColor(185, 255, 106, 1),
        shadowBlur: 22,
        label: toColor(5, 7, 8, 1),
      };
    }
    if (selected) {
      return {
        firing,
        selected,
        fill: toColor(50, 255, 140, gateOpen ? 0.24 : 0.12),
        stroke: toColor(185, 255, 106, 0.88),
        lineWidth: 2.5,
        shadow: toColor(54, 246, 178, 1),
        shadowBlur: 8,
        label: toColor(255, 255, 255, gateOpen ? 1 : 0.88),
      };
    }
    return {
      firing,
      selected,
      fill: toColor(20, 140, 60, 0.055),
      stroke: toColor(124, 255, 79, 0.27),
      lineWidth: 1,
      shadow: null,
      shadowBlur: 0,
      label: toColor(185, 255, 106, 0.42),
    };
  }

  function createHitEffect(pad, startedAt = 0) {
    return { pad, startedAt };
  }

  function getHitEffectProgress(effect, now = 0) {
    return clamp((now - Number(effect?.startedAt || 0)) / HIT_EFFECT_DURATION_MS, 0, 1);
  }

  function isHitEffectActive(effect, now = 0) {
    return effect && (now - Number(effect.startedAt || 0)) < HIT_EFFECT_DURATION_MS;
  }

  function filterActiveHitEffects(effects, now = 0) {
    return Array.isArray(effects) ? effects.filter((effect) => isHitEffectActive(effect, now)) : [];
  }

  function getHitEffectStyle(progress) {
    const alpha = Math.max(0, 1 - progress);
    return {
      alpha,
      stroke: progress < 0.45 ? toColor(255, 255, 255, alpha) : toColor(185, 255, 106, alpha),
      lineWidth: Math.max(1, 5 * (1 - progress)),
      shadow: toColor(124, 255, 79, alpha),
      shadowBlur: 18 * (1 - progress),
      label: toColor(255, 255, 255, alpha),
    };
  }

  function getNosePulse(now = 0) {
    return 1 + Math.sin(now / 180) * 0.045;
  }

  function createPerformerCooldownTracker(cooldownMs = PERFORMER_TRIGGER_COOLDOWN_MS) {
    const lastTriggerByOutput = new Map();
    return {
      allow(output, now = Date.now()) {
        const key = String(output);
        const last = lastTriggerByOutput.get(key);
        if (Number.isFinite(last) && now - last < cooldownMs) return false;
        lastTriggerByOutput.set(key, now);
        return true;
      },
      reset() { lastTriggerByOutput.clear(); },
    };
  }

  function getPerformerFaceCue(landmarks, width, height, now = 0) {
    if (!Array.isArray(landmarks) || landmarks.length <= PERFORMER_NOSE_INDEX) {
      return null;
    }

    const stageWidth = Math.max(1, Number(width) || 1);
    const stageHeight = Math.max(1, Number(height) || 1);
    const stageScale = Math.min(stageWidth, stageHeight);
    const project = (landmark) => {
      if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null;
      return {
        x: stageWidth - (landmark.x * stageWidth),
        y: landmark.y * stageHeight,
      };
    };
    const nose = project(landmarks[PERFORMER_NOSE_INDEX]);
    if (!nose) return null;

    const mouthLeft = project(landmarks[61]);
    const mouthRight = project(landmarks[291]);
    const upperLip = project(landmarks[13]);
    const lowerLip = project(landmarks[14]);
    const mouthWidth = mouthLeft && mouthRight ? Math.hypot(mouthRight.x - mouthLeft.x, mouthRight.y - mouthLeft.y) : stageScale * 0.1;
    const mouthOpening = upperLip && lowerLip ? Math.hypot(lowerLip.x - upperLip.x, lowerLip.y - upperLip.y) : 0;
    const openness = clamp(mouthOpening / Math.max(1, mouthWidth * 0.42), 0, 1);
    const mouthCenter = mouthLeft && mouthRight
      ? { x: (mouthLeft.x + mouthRight.x) / 2, y: ((upperLip?.y || mouthLeft.y) + (lowerLip?.y || mouthRight.y)) / 2 }
      : null;

    return {
      nose: {
        ...nose,
        radiusX: Math.max(14, stageScale * 0.036 * getNosePulse(now)),
        radiusY: Math.max(12, stageScale * 0.032 * getNosePulse(now)),
        stops: [
          { offset: 0, color: toColor(255, 70, 86, 0.30) },
          { offset: 0.24, color: toColor(255, 38, 58, 0.18) },
          { offset: 0.62, color: toColor(255, 20, 45, 0.07) },
          { offset: 1, color: toColor(255, 20, 45, 0) },
        ],
      },
      mouth: mouthCenter ? {
        ...mouthCenter,
        openness,
        radiusX: Math.max(stageScale * 0.035, mouthWidth * (0.68 + openness * 0.08)),
        radiusY: Math.max(stageScale * 0.018, mouthWidth * (0.18 + openness * 0.16)),
        stops: [
          { offset: 0, color: toColor(255, 255, 255, 0.16 + openness * 0.07) },
          { offset: 0.30, color: toColor(255, 255, 255, 0.10 + openness * 0.04) },
          { offset: 0.72, color: toColor(235, 245, 255, 0.035) },
          { offset: 1, color: toColor(235, 245, 255, 0) },
        ],
      } : null,
    };
  }

  globalScope.MMFPerformanceGridVisuals = {
    GRID_COLS,
    GRID_ROWS,
    FLASH_DURATION_MS,
    HIT_EFFECT_DURATION_MS,
    PERFORMER_TRIGGER_COOLDOWN_MS,
    getCellVisual,
    createHitEffect,
    getHitEffectProgress,
    getHitEffectStyle,
    isHitEffectActive,
    filterActiveHitEffects,
    getNosePulse,
    createPerformerCooldownTracker,
    getPerformerFaceCue,
  };
})(window);
