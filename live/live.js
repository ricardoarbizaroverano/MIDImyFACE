const DEFAULT_RELAY_ORIGIN = 'https://midimyface-relay.onrender.com';
const POLL_INTERVAL_MS = 30_000;
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

function isPriorityParticipantEmail(email, bootstrap) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  const priorityEmails = (bootstrap?.auth?.priorityEmails || []).map((value) => String(value || '').trim().toLowerCase());
  return priorityEmails.includes(normalized);
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
  const heroTitle = status?.content?.heroTitle || 'MIDImyFACE Live';
  const heroSubtitle = status?.content?.heroSubtitle || 'A public installation you can watch online or visit in person.';
  const machineMode = normalizeMachineMode(status);
  const queue = status?.queue || {};
  const stream = status?.stream || {};
  const machine = status?.machine || {};
  const venueLabel = buildVenueLabel(status);
  const scheduleLabel = buildScheduleLabel(status);

  elements.statusCard.classList.remove('status-offline', 'status-online', 'status-live');
  elements.statusCard.classList.add(statusClass(status));
  setText(elements.heroTitle, heroTitle);
  setText(elements.heroSubtitle, heroSubtitle);
  setText(elements.machineMode, machineMode);
  setText(elements.queuePolicy, `${queue.turnDurationSeconds || 30}s turn · ${queue.cooldownMinutes || 15}m cooldown`);
  setText(elements.lastUpdateLabel, relativeTime(status?.updatedAt || machine?.heartbeatAt));
  setText(elements.machineStatusLabel, machine.statusLabel || machineMode || 'offline');
  setText(elements.machineStatusMessage, machine.message || machine.offlineReason || status?.content?.fallbackMessage || 'No live data yet.');
  setText(elements.venueLabel, venueLabel);
  setText(elements.scheduleLabel, scheduleLabel);
  setText(elements.locationTitle, venueLabel);
  setText(elements.locationDetails, status?.venue?.address || status?.venue?.note || 'Venue details will appear when the Raspberry Pi posts them.');

  if (stream.isLive) {
    setText(elements.liveAccessTitle, 'Broadcasting now');
    setText(elements.liveAccessMessage, machine.acceptingParticipants ? 'The machine is live and can announce queue openings here.' : 'The machine is broadcasting live right now.');
  } else if (machine.alive) {
    setText(elements.liveAccessTitle, 'Machine online');
    setText(elements.liveAccessMessage, 'The installation is awake. A live feed will load automatically when the broadcast starts.');
  } else {
    setText(elements.liveAccessTitle, 'Currently offline');
    setText(elements.liveAccessMessage, status?.content?.fallbackMessage || 'Come back later or check social channels for the next activation.');
  }

  setText(elements.policyMessage, queue.message || 'One free turn per visitor, then a 15-minute cooldown to keep the installation fair and avoid abuse.');
  setText(elements.streamTitle, stream.isLive ? 'YouTube feed' : 'Live feed');
  setText(elements.streamDescription, stream.isLive
    ? 'The broadcast is live — watch it here or open the full channel in a new tab.'
    : 'No broadcast is active right now. Explore the channel and social links while the installation is offline.');

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
  }

  renderDonations(status, bootstrap);
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
    setText(elements.authDescription, bootstrap.auth.firebaseConfigured
      ? 'Sign in with Google to save your email, nickname, country, and notification preference for future live sessions.'
      : `Google sign-in will be enabled after the Firebase web app for ${bootstrap.ownerEmail} is configured.`);
    await refreshStatus();
    if (bootstrap.auth.firebaseConfigured) {
      await initFirebaseAuth(bootstrap);
    }
  } catch (error) {
    setText(elements.machineStatusLabel, 'Relay unavailable');
    setText(elements.machineStatusMessage, `Could not load live bootstrap data: ${error?.message || 'Unknown error'}`);
  }

  window.setInterval(refreshStatus, POLL_INTERVAL_MS);
}

initialize();
