const DEFAULT_SCENES = {
  waiting: { type: 'camera', showCamera: true, showParticipant: false, showGrid: false, showQR: true, showLogo: true },
  intro: { type: 'video', showQR: true, showLogo: true },
  performance: { type: 'camera', showCamera: true, showParticipant: true, showGrid: true, showQR: true, showLogo: true },
  intermission: { type: 'video', showQR: true, showLogo: true },
  outro: { type: 'video', showQR: true, showLogo: true },
};

const DEFAULT_THEME = {
  qr: { size: 96, margin: 12, corner: 'bottom_right', url: 'https://midimyface.com/live' },
  grid: { rows: 2, cols: 4 },
};

const DEFAULT_LOWER_THIRDS = {
  participant: { line1: '{nickname}', line2: '{country}', durationSeconds: 5 },
  installation: { line1: 'MIDImyFACE', line2: '{place}', durationSeconds: 6 },
};

async function loadJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) return structuredClone(fallback);
    const json = await response.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) return structuredClone(fallback);
    return { ...fallback, ...json };
  } catch {
    return structuredClone(fallback);
  }
}

export async function loadBroadcastConfig() {
  const [scenes, theme, lowerThirds] = await Promise.all([
    loadJson('../broadcast/config/scenes.json', DEFAULT_SCENES),
    loadJson('../broadcast/config/theme.json', DEFAULT_THEME),
    loadJson('../broadcast/config/lower_thirds.json', DEFAULT_LOWER_THIRDS),
  ]);
  return { scenes, theme, lowerThirds };
}
