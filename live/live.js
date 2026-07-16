const DEFAULT_RELAY_ORIGIN = 'https://midimyface-relay.onrender.com';
const POLL_INTERVAL_MS = 30_000;
const GESTURE_BAR_MAX = { mouthOpen: 50, smile: 120, leftWink: 60, rightWink: 60, noseX: 640, noseY: 480, accent: 100 };
const COUNTRY_CODES = [
  'AR', 'AU', 'AT', 'BE', 'BO', 'BR', 'BG', 'CA', 'CL', 'CN', 'CO', 'CR', 'CU', 'CZ', 'DK', 'DO', 'EC', 'EG',
  'SV', 'FI', 'FR', 'DE', 'GR', 'GT', 'HN', 'HK', 'HU', 'IS', 'IN', 'ID', 'IE', 'IL', 'IT', 'JP', 'KE', 'KR', 'LV',
  'LT', 'LU', 'MY', 'MX', 'MA', 'NL', 'NZ', 'NI', 'NG', 'NO', 'PA', 'PY', 'PE', 'PH', 'PL', 'PT', 'PR', 'RO',
  'SG', 'SK', 'SI', 'ZA', 'ES', 'SE', 'CH', 'TW', 'TH', 'TN', 'TR', 'UA', 'AE', 'GB', 'US', 'UY', 'VE', 'VN'
];

const elements = {
  heroEyebrow: document.getElementById('heroEyebrow'),
  heroTitle: document.getElementById('heroTitle'),
  heroSubtitle: document.getElementById('heroSubtitle'),
  machineMode: document.getElementById('machineMode'),
  queuePolicy: document.getElementById('queuePolicy'),
  lastUpdateLabel: document.getElementById('lastUpdateLabel'),
  watchLiveButton: document.getElementById('watchLiveButton'),
  visitChannelButton: document.getElementById('visitChannelButton'),
  statusCard: document.getElementById('statusCard'),
  machineStatusLabel: document.getElementById('machineStatusLabel'),
  machineStatusMessage: document.getElementById('machineStatusMessage'),
  venueLabel: document.getElementById('venueLabel'),
  scheduleLabel: document.getElementById('scheduleLabel'),
  locationTitle: document.getElementById('locationTitle'),
  locationDetails: document.getElementById('locationDetails'),
  liveAccessTitle: document.getElementById('liveAccessTitle'),
  liveAccessMessage: document.getElementById('liveAccessMessage'),
  policyMessage: document.getElementById('policyMessage'),
  streamTitle: document.getElementById('streamTitle'),
  streamDescription: document.getElementById('streamDescription'),
  streamEmbedWrap: document.getElementById('streamEmbedWrap'),
  youtubeEmbed: document.getElementById('youtubeEmbed'),
  streamFallback: document.getElementById('streamFallback'),
  channelButton: document.getElementById('channelButton'),
  videosButton: document.getElementById('videosButton'),
  instagramButton: document.getElementById('instagramButton'),
  donationButtons: document.getElementById('donationButtons'),
  authUnavailable: document.getElementById('authUnavailable'),
  authReady: document.getElementById('authReady'),
  authDescription: document.getElementById('authDescription'),
  googleSignInButton: document.getElementById('googleSignInButton'),
  googleSignOutButton: document.getElementById('googleSignOutButton'),
  signedInNotice: document.getElementById('signedInNotice'),
  profileForm: document.getElementById('profileForm'),
  nicknameInput: document.getElementById('nicknameInput'),
  countrySelect: document.getElementById('countrySelect'),
  notifyCheckbox: document.getElementById('notifyCheckbox'),
  saveProfileButton: document.getElementById('saveProfileButton'),
  profileMessage: document.getElementById('profileMessage'),
};

const state = {
  relayOrigin: resolveRelayOrigin(),
  bootstrap: null,
  status: null,
  firebase: null,
  auth: null,
  db: null,
  currentUser: null,
  wasLive: false,
  notifyEnabled: window.localStorage.getItem('mmf_live_notify_enabled') === '1',
  minimalLayout: false,
};

function resolveRelayOrigin() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = (params.get('relay') || '').trim();
  if (fromQuery) return stripTrailingSlash(fromQuery);
  const stored = (window.localStorage.getItem('mmf_live_relay_origin') || '').trim();
  if (stored) return stripTrailingSlash(stored);
  return DEFAULT_RELAY_ORIGIN;
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function buildApiUrl(pathname) {
  return `${state.relayOrigin}${pathname}`;
}

async function fetchJson(pathname) {
  const response = await fetch(buildApiUrl(pathname), { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.error || `http_${response.status}`);
  }
  return data;
}

function setText(node, value) {
  if (!node) return;
  node.textContent = value || '';
}

function show(node, visible) {
  if (!node) return;
  node.classList.toggle('hidden', !visible);
}

function hideElement(node) {
  if (!node) return;
  node.classList.add('hidden');
}

function isPriorityParticipantEmail(email, bootstrap) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  const priorityEmails = (bootstrap?.auth?.priorityEmails || []).map((value) => String(value || '').trim().toLowerCase());
  return priorityEmails.includes(normalized);
}

function applyMinimalLayout(bootstrap) {
  state.minimalLayout = true;
  hideElement(document.querySelector('.status-grid'));
  hideElement(elements.authUnavailable);
  hideElement(elements.authReady);
  hideElement(elements.authDescription);
  hideElement(elements.signedInNotice);
  hideElement(elements.profileForm);
  hideElement(elements.locationTitle);
  hideElement(elements.locationDetails);
  hideElement(elements.liveAccessTitle);
  hideElement(elements.liveAccessMessage);
  hideElement(elements.policyMessage);
  hideElement(elements.machineMode?.parentElement);
  hideElement(elements.queuePolicy?.parentElement);
  hideElement(elements.lastUpdateLabel?.parentElement);

  const supportPanel = document.querySelector('.panel-grid > .span-4');
  if (supportPanel) {
    const heading = supportPanel.querySelector('h2');
    const bodyCopy = supportPanel.querySelector('p');
    hideElement(heading);
    hideElement(bodyCopy);
  }

  setText(elements.heroSubtitle, 'Percussion · landmarks');
  setText(elements.machineMode, 'Percussion');
  setText(elements.queuePolicy, '7 solenoids');
  setText(elements.lastUpdateLabel, 'live');
  setText(elements.liveAccessMessage, '');

  elements.watchLiveButton.innerHTML = '<span class="glyph">⏺</span><span class="glyph-label">Past</span>';
  elements.visitChannelButton.innerHTML = '<span class="glyph">↗</span><span class="glyph-label">Channel</span>';
  elements.watchLiveButton.href = bootstrap?.links?.youtubeVideosUrl || '#';
  elements.visitChannelButton.href = bootstrap?.links?.youtubeChannelUrl || '#';

  const donorRow = elements.donationButtons;
  donorRow.innerHTML = '';

  const notifyButton = document.createElement('button');
  notifyButton.className = 'glyph-button glyph-primary';
  notifyButton.type = 'button';
  notifyButton.innerHTML = '<span class="glyph">✉</span><span class="glyph-label">Notify</span>';
  notifyButton.addEventListener('click', requestNotificationPermission);

  const previousButton = document.createElement('a');
  previousButton.className = 'glyph-link';
  previousButton.href = bootstrap?.links?.youtubeVideosUrl || '#';
  previousButton.target = '_blank';
  previousButton.rel = 'noreferrer';
  previousButton.innerHTML = '<span class="glyph">⌁</span><span class="glyph-label">Past</span>';

  const youtubeButton = document.createElement('a');
  youtubeButton.className = 'glyph-link';
  youtubeButton.href = bootstrap?.links?.youtubeChannelUrl || '#';
  youtubeButton.target = '_blank';
  youtubeButton.rel = 'noreferrer';
  youtubeButton.innerHTML = '<span class="glyph">▶</span><span class="glyph-label">YouTube</span>';

  const instagramButton = document.createElement('a');
  instagramButton.className = 'glyph-link';
  instagramButton.href = bootstrap?.links?.instagramUrl || '#';
  instagramButton.target = '_blank';
  instagramButton.rel = 'noreferrer';
  instagramButton.innerHTML = '<span class="glyph">◎</span><span class="glyph-label">Instagram</span>';

  donorRow.appendChild(notifyButton);
  donorRow.appendChild(previousButton);
  donorRow.appendChild(youtubeButton);
  donorRow.appendChild(instagramButton);
}

function requestNotificationPermission() {
  if (!('Notification' in window)) {
    setProfileMessage('Notifications not supported in this browser.', 'error');
    return;
  }
  Notification.requestPermission().then((result) => {
    state.notifyEnabled = result === 'granted';
    window.localStorage.setItem('mmf_live_notify_enabled', state.notifyEnabled ? '1' : '0');
    setProfileMessage(state.notifyEnabled ? 'Live notifications enabled.' : 'Notifications not enabled.', state.notifyEnabled ? 'success' : 'error');
  });
}

function maybeNotifyLiveTransition(status, bootstrap) {
  const nowLive = Boolean(status?.stream?.isLive);
  if (nowLive && !state.wasLive && state.notifyEnabled && 'Notification' in window && Notification.permission === 'granted') {
    const title = status?.content?.heroTitle || 'MIDImyFACE Live';
    const body = status?.content?.heroSubtitle || 'The installation is live now.';
    const notification = new Notification(title, { body });
    notification.onclick = () => {
      window.focus();
      if (bootstrap?.links?.youtubeLiveEmbedUrl) {
        window.open(bootstrap.links.youtubeChannelUrl, '_blank', 'noreferrer');
      }
    };
  }
  state.wasLive = nowLive;
}

function intlDateFormatter(timeZone) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timeZone || undefined,
    });
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
}

function formatTimestamp(value, timeZone) {
  if (!value) return 'Not scheduled yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return intlDateFormatter(timeZone).format(date);
}

function relativeTime(value) {
  if (!value) return 'Waiting for data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const deltaMs = Date.now() - date.getTime();
  const deltaMinutes = Math.round(deltaMs / 60000);
  if (Math.abs(deltaMinutes) < 1) return 'Updated just now';
  if (deltaMinutes < 60) return `Updated ${deltaMinutes}m ago`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) return `Updated ${deltaHours}h ago`;
  return `Updated ${Math.round(deltaHours / 24)}d ago`;
}

function buildVenueLabel(status) {
  const parts = [status?.venue?.name, status?.venue?.city, status?.venue?.country].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Not announced yet';
}

function buildScheduleLabel(status) {
  const schedule = status?.schedule || {};
  const timeZone = status?.venue?.timezone || '';
  const windows = [];
  if (schedule.startsAt) windows.push(`Starts ${formatTimestamp(schedule.startsAt, timeZone)}`);
  if (schedule.endsAt) windows.push(`Ends ${formatTimestamp(schedule.endsAt, timeZone)}`);
  if (schedule.nextStartsAt) windows.push(`Next session ${formatTimestamp(schedule.nextStartsAt, timeZone)}`);
  if (schedule.note) windows.push(schedule.note);
  return windows.length ? windows.join(' · ') : 'If no data appears, check the channel and social links.';
}

function statusClass(status) {
  if (status?.stream?.isLive) return 'status-live';
  if (status?.machine?.alive) return 'status-online';
  return 'status-offline';
}

function normalizeMachineMode(status) {
  return status?.machine?.mode ? String(status.machine.mode).replace(/[-_]/g, ' ') : 'offline';
}

function renderDonations(status, bootstrap) {
  if (state.minimalLayout) {
    return;
  }
  const donationUrl = status?.donations?.paypalUrl || bootstrap?.links?.paypalDonationUrl || '#';
  const suggestedAmounts = status?.donations?.suggestedAmounts || [1, 2, 5];
  elements.donationButtons.innerHTML = '';
  suggestedAmounts.forEach((amount) => {
    const anchor = document.createElement('a');
    anchor.className = 'button primary';
    anchor.href = donationUrl;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    anchor.textContent = `$${amount}`;
    elements.donationButtons.appendChild(anchor);
  });
}

function renderStatus(status, bootstrap) {
  state.status = status;
  const heroTitle = status?.content?.heroTitle || 'MIDImyFACE';
  const heroSubtitle = status?.content?.heroSubtitle || 'Percussion · landmarks';
  const machineMode = normalizeMachineMode(status);
  const queue = status?.queue || {};
  const stream = status?.stream || {};
  const machine = status?.machine || {};
  const message = String(machine?.message || status?.queue?.message || status?.content?.fallbackMessage || '').trim();
  const venueLabel = buildVenueLabel(status);
  const scheduleLabel = buildScheduleLabel(status);

  elements.statusCard.classList.remove('status-offline', 'status-online', 'status-live');
  elements.statusCard.classList.add(statusClass(status));
  setText(elements.heroTitle, heroTitle);
  setText(elements.heroSubtitle, heroSubtitle);
  setText(elements.machineMode, machineMode);
  setText(elements.queuePolicy, `${queue.turnDurationSeconds || 30}s / ${queue.cooldownMinutes || 15}m`);
  setText(elements.lastUpdateLabel, relativeTime(status?.updatedAt || machine?.heartbeatAt));
  setText(elements.machineStatusLabel, machine.alive ? (stream.isLive ? 'Live' : 'Online') : 'Offline');
  setText(elements.machineStatusMessage, message || (stream.isLive ? 'Available' : (machine.alive ? 'Not available' : 'Offline')));
  setText(elements.venueLabel, '');
  setText(elements.scheduleLabel, '');
  setText(elements.locationTitle, '');
  setText(elements.locationDetails, '');

  if (stream.isLive) {
    setText(elements.liveAccessTitle, '');
    setText(elements.liveAccessMessage, '');
  } else if (machine.alive) {
    setText(elements.liveAccessTitle, '');
    setText(elements.liveAccessMessage, '');
  } else {
    setText(elements.liveAccessTitle, '');
    setText(elements.liveAccessMessage, '');
  }

  setText(elements.policyMessage, '');
  setText(elements.streamTitle, stream.isLive ? 'Live feed' : 'Signal idle');
  setText(elements.streamDescription, stream.isLive
    ? 'Broadcast online.'
    : (message || (machine.alive ? 'Installation online.' : 'Installation offline.')));

  const channelUrl = stream.channelUrl || bootstrap?.links?.youtubeChannelUrl || '#';
  const videosUrl = stream.videosUrl || bootstrap?.links?.youtubeVideosUrl || channelUrl;
  const instagramUrl = status?.social?.instagramUrl || bootstrap?.links?.instagramUrl || '#';
  const embedUrl = stream.embedUrl || bootstrap?.links?.youtubeLiveEmbedUrl || '';
  elements.visitChannelButton.href = channelUrl;
  elements.channelButton.href = channelUrl;
  elements.videosButton.href = videosUrl;
  elements.instagramButton.href = instagramUrl;

  show(elements.streamEmbedWrap, Boolean(stream.isLive && embedUrl));
  show(elements.streamFallback, !(stream.isLive && embedUrl));
  if (stream.isLive && embedUrl) {
    elements.youtubeEmbed.src = embedUrl;
  } else {
    elements.youtubeEmbed.removeAttribute('src');
    elements.streamFallback.textContent = message || (machine.alive ? 'Installation online · no stream.' : 'Installation offline.');
  }

  renderDonations(status, bootstrap);
  maybeNotifyLiveTransition(status, bootstrap);
}

function buildCountryOptions() {
  const displayNames = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' })
    : null;
  const entries = COUNTRY_CODES.map((code) => ({
    code,
    label: displayNames?.of(code) || code,
  })).sort((a, b) => a.label.localeCompare(b.label));

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select your country';
  elements.countrySelect.appendChild(placeholder);

  entries.forEach(({ code, label }) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = label;
    elements.countrySelect.appendChild(option);
  });
}

async function initFirebaseAuth(bootstrap) {
  if (!bootstrap?.auth?.firebaseConfigured) return;

  const [appModule, authModule, firestoreModule] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'),
  ]);

  const firebaseApp = appModule.initializeApp(bootstrap.auth.firebase);
  const auth = authModule.getAuth(firebaseApp);
  const provider = new authModule.GoogleAuthProvider();
  const db = firestoreModule.getFirestore(firebaseApp);

  state.firebase = { authModule, firestoreModule, provider };
  state.auth = auth;
  state.db = db;

  authModule.onAuthStateChanged(auth, (user) => {
    state.currentUser = user || null;
    renderAuthState(bootstrap);
  });

  elements.googleSignInButton.addEventListener('click', async () => {
    setProfileMessage('');
    try {
      await authModule.signInWithPopup(auth, provider);
    } catch (error) {
      setProfileMessage(`Google sign-in failed: ${error?.message || 'Unknown error'}`, 'error');
    }
  });

  elements.googleSignOutButton.addEventListener('click', async () => {
    try {
      await authModule.signOut(auth);
    } catch (error) {
      setProfileMessage(`Sign-out failed: ${error?.message || 'Unknown error'}`, 'error');
    }
  });

  elements.profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.currentUser || !state.db || !state.firebase) {
      setProfileMessage('Google sign-in is required before saving your details.', 'error');
      return;
    }

    const nickname = elements.nicknameInput.value.trim();
    const country = elements.countrySelect.value.trim();
    const notify = elements.notifyCheckbox.checked;

    if (!nickname || !country) {
      setProfileMessage('Please choose a nickname and country.', 'error');
      return;
    }

    elements.saveProfileButton.disabled = true;
    setProfileMessage('Saving your profile…');

    try {
      const { addDoc, collection, serverTimestamp } = state.firebase.firestoreModule;
      await addDoc(collection(state.db, bootstrap.auth.collectionNames.participants), {
        uid: state.currentUser.uid,
        email: state.currentUser.email || '',
        displayName: state.currentUser.displayName || '',
        photoURL: state.currentUser.photoURL || '',
        nickname,
        country,
        notify,
        createdAt: serverTimestamp(),
        source: 'midimyface.com/live',
      });
      setProfileMessage('Saved. Your details are ready for future live queue access.', 'success');
    } catch (error) {
      setProfileMessage(`Could not save your details: ${error?.message || 'Unknown error'}`, 'error');
    } finally {
      elements.saveProfileButton.disabled = false;
    }
  });

  renderAuthState(bootstrap);
}

function renderAuthState(bootstrap) {
  const enabled = Boolean(bootstrap?.auth?.firebaseConfigured && state.auth);
  show(elements.authUnavailable, !enabled);
  show(elements.authReady, enabled);

  if (!enabled) {
    return;
  }

  const user = state.currentUser;
  show(elements.googleSignInButton, !user);
  show(elements.googleSignOutButton, Boolean(user));
  show(elements.profileForm, Boolean(user));
  show(elements.signedInNotice, Boolean(user));

  if (user) {
    const email = user.email || 'No email returned';
    const priorityBadge = isPriorityParticipantEmail(email, bootstrap) ? ' · Priority tester enabled' : '';
    setText(elements.signedInNotice, `Signed in as ${user.displayName || 'MIDImyFACE guest'} · ${email}${priorityBadge}`);
    elements.signedInNotice.className = 'notice success';
    if (!elements.nicknameInput.value) {
      elements.nicknameInput.value = (user.displayName || '').slice(0, 40);
    }
  }
}

function setProfileMessage(message, type = '') {
  if (!message) {
    elements.profileMessage.className = 'notice hidden';
    elements.profileMessage.textContent = '';
    return;
  }
  elements.profileMessage.className = `notice ${type}`.trim();
  elements.profileMessage.textContent = message;
}

async function refreshStatus() {
  try {
    const payload = await fetchJson('/api/live/status');
    renderStatus(payload.status, state.bootstrap);
  } catch (error) {
    setText(elements.machineStatusLabel, 'Unavailable');
    setText(elements.machineStatusMessage, `Relay status unavailable: ${error?.message || 'Unknown error'}`);
    elements.statusCard.classList.remove('status-live', 'status-online');
    elements.statusCard.classList.add('status-offline');
  }
}

async function initialize() {
  buildCountryOptions();
  try {
    const bootstrap = await fetchJson('/api/live/bootstrap');
    state.bootstrap = bootstrap;
    window.localStorage.setItem('mmf_live_relay_origin', state.relayOrigin);
    elements.visitChannelButton.href = bootstrap.links.youtubeChannelUrl;
    elements.channelButton.href = bootstrap.links.youtubeChannelUrl;
    elements.videosButton.href = bootstrap.links.youtubeVideosUrl;
    elements.instagramButton.href = bootstrap.links.instagramUrl;
    applyMinimalLayout(bootstrap);
    await refreshStatus();
  } catch (error) {
    setText(elements.machineStatusLabel, 'Relay unavailable');
    setText(elements.machineStatusMessage, `Unavailable`);
  }

  initSession();
  window.setInterval(refreshStatus, POLL_INTERVAL_MS);
}

// ─── Participant session ───────────────────────────────────────────────────

let _session = null;

function initSession() {
  const startBtn  = document.getElementById('startSessionBtn');
  const stopBtn   = document.getElementById('stopSessionBtn');
  const closeBtn  = document.getElementById('closeSessionBtn');
  const statusEl  = document.getElementById('sessionStatus');
  const introEl   = document.getElementById('sessionIntro');
  const videoSec  = document.getElementById('sessionVideoSection');
  const videoEl   = document.getElementById('sessionVideo');
  const canvasEl  = document.getElementById('sessionCanvas');

  if (!startBtn) return;

  const resetBars = () => renderGestureBars({ mouthOpen: 0, smile: 0, leftWink: 0, rightWink: 0, noseX: 0, noseY: 0, accent: 0 });

  const setIdleUi = () => {
    document.body.classList.remove('session-active');
    introEl?.classList.remove('hidden');
    videoSec?.classList.add('hidden');
    startBtn.disabled = false;
    startBtn.classList.remove('hidden');
    startBtn.innerHTML = '<span class="glyph">▶</span><span class="glyph-label">Start</span>';
    stopBtn.classList.add('hidden');
    closeBtn?.classList.add('hidden');
    statusEl.textContent = 'Ready';
    statusEl.className = 'session-status';
    resetBars();
  };

  const setActiveUi = () => {
    document.body.classList.add('session-active');
    introEl?.classList.add('hidden');
    videoSec?.classList.remove('hidden');
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    stopBtn.disabled = false;
    closeBtn?.classList.remove('hidden');
  };

  const stopSession = () => {
    _session?.stop();
    _session = null;
    setIdleUi();
  };

  setIdleUi();

  startBtn.addEventListener('click', async () => {
    if (_session) return;
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="glyph">…</span><span class="glyph-label">Loading</span>';

    const { ParticipantSession } = await import('./live_session.js');
    _session = new ParticipantSession({
      relayOrigin: state.relayOrigin,
      nickname: 'Guest',
      countryCode: '',
      onStatus({ phase, message }) {
        statusEl.textContent = message;
        statusEl.className = 'session-status ' + (phase === 'active' ? 'active' : phase === 'error' ? 'error' : '');
        if (phase === 'active') {
          setActiveUi();
        }
        if (phase === 'error' || phase === 'stopped') {
          setIdleUi();
          if (phase === 'error') {
            statusEl.textContent = message;
            statusEl.className = 'session-status error';
          }
          _session = null;
        }
      },
      onGestures(gestures) {
        renderGestureBars(gestures);
      },
    });

    await _session.start(videoEl, canvasEl);
  });

  stopBtn.addEventListener('click', stopSession);
  closeBtn?.addEventListener('click', stopSession);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && _session) {
      stopSession();
    }
  });
}

function renderGestureBars(gestures) {
  for (const [name, value] of Object.entries(gestures)) {
    const bar = document.getElementById(`bar-${name}`);
    const val = document.getElementById(`val-${name}`);
    if (!bar || !val) continue;
    const max = GESTURE_BAR_MAX[name] || 100;
    const pct = Math.min(100, Math.round((value / max) * 100));
    bar.style.width = `${pct}%`;
    val.textContent = Math.round(value);
  }
}

initialize();
