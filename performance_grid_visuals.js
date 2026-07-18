(function attachPerformanceGridVisuals(globalScope) {
  const GRID_COLS = 4;
  const GRID_ROWS = 2;
  const FLASH_DURATION_MS = 240;
  const HIT_EFFECT_DURATION_MS = 620;

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
    return 1 + Math.sin(now / 125) * 0.1;
  }

  globalScope.MMFPerformanceGridVisuals = {
    GRID_COLS,
    GRID_ROWS,
    FLASH_DURATION_MS,
    HIT_EFFECT_DURATION_MS,
    getCellVisual,
    createHitEffect,
    getHitEffectProgress,
    getHitEffectStyle,
    isHitEffectActive,
    filterActiveHitEffects,
    getNosePulse,
  };
})(window);