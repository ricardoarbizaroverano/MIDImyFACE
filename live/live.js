const DEFAULT_RELAY_ORIGIN = 'https://midimyface-relay.onrender.com';
const STATUS_POLL_MS = 10_000;
const DEFAULT_PAYPAL_URL = 'https://www.paypal.com/qrcodes/managed/ebc92ae1-6b2e-4d36-93f0-ce2e0b4fbd2d?utm_source=consapp_download';
const DEFAULT_VENMO_URL = 'https://venmo.com/code?user_id=2982237150642176372&created=1784274093';
const DEFAULT_YOUTUBE_EMBED_URL = 'https://www.youtube.com/embed/live_stream?channel=UCequCs51HuUdCYC-RQL-b9g&autoplay=1';
const DEFAULT_YOUTUBE_CHANNEL_URL = 'https://www.youtube.com/channel/UCequCs51HuUdCYC-RQL-b9g';
const DEFAULT_YOUTUBE_VIDEOS_URL = `${DEFAULT_YOUTUBE_CHANNEL_URL}/videos`;
const DEFAULT_INSTAGRAM_URL = 'https://www.instagram.com/midimyface/';
const TERMS_ACCEPTED_STORAGE_KEY = 'mmf_live_terms_accepted_v1';
const COUNTRY_CODES = [
  'AR','AU','AT','BE','BO','BR','BG','CA','CL','CN','CO','CR','CU','CZ','DK','DO','EC','EG','SV','FI','FR','DE','GR','GT','HN','HK','HU','IS','IN','ID','IE','IL','IT','JP','KE','KR','LV','LT','LU','MY','MX','MA','NL','NZ','NI','NG','NO','PA','PY','PE','PH','PL','PT','PR','RO','SG','SK','SI','ZA','ES','SE','CH','TW','TH','TN','TR','UA','AE','GB','US','UY','VE','VN',
];

const elements = Object.fromEntries([
  'statusDot','machineStatus','machineMessage','participantBadge','sessionCountdown','sessionIntro','identityForm',
  'nicknameInput','countrySelect','startSessionBtn','formMessage','sessionVideo','sessionCanvas','sessionStatus',
  'closeSessionBtn','gestureTriggers','stopSessionBtn','paypalDonateLink','instagramProjectLink',
  'youtubeLivePanel','youtubeLiveFrame','youtubeSoundBtn','donationModal','donationAmounts','dismissDonationBtn',
  'venmoDonateLink','modalPaypalLink','modalVenmoLink','youtubeChannelLink','lastJamLink','youtubeFallback',
  'termsConsent','googleAuthBtn','googleAuthLabel','authMessage','queueCard','queuePosition','queueEstimate',
  'authPanel',
].map((id) => [id, document.getElementById(id)]));

const state = {
  relayOrigin: resolveRelayOrigin(),
  bootstrap: null,
  status: null,
  session: null,
  participantSession: null,
  countdownTimer: null,
  paypalUrl: DEFAULT_PAYPAL_URL,
  youtubePlayer: null,
  youtubeProbeTimer: null,
  youtubeLiveDetected: false,
  queueToken: null,
  queuePollTimer: null,
  deviceId: null,
  authUser: null,
  authToken: null,
  firebaseAuth: null,
  authReady: false,
};

function resolveRelayOrigin() {
  const params = new URLSearchParams(window.location.search);
  const queryValue = (params.get('relay') || '').trim();
  return String(queryValue || DEFAULT_RELAY_ORIGIN).replace(/\/+$/, '');
}

async function api(pathname, options = {}) {
  const response = await fetch(`${state.relayOrigin}${pathname}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `http_${response.status}`);
    error.code = payload.error || `http_${response.status}`;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function setHidden(node, hidden) {
  node?.classList.toggle('hidden', hidden);
}

function safeExternalUrl(value, allowedDomains, fallback) {
  try {
    const parsed = new URL(String(value || ''));
    const allowed = parsed.protocol === 'https:' && allowedDomains.some(
      (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
    );
    return allowed ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

function configurePublicLinks(bootstrap) {
  const links = bootstrap?.links || {};
  state.paypalUrl = safeExternalUrl(links.paypalDonationUrl, ['paypal.com'], DEFAULT_PAYPAL_URL);
  const venmoUrl = safeExternalUrl(links.venmoDonationUrl, ['venmo.com'], DEFAULT_VENMO_URL);
  const instagramUrl = safeExternalUrl(links.instagramUrl, ['instagram.com'], DEFAULT_INSTAGRAM_URL);
  elements.paypalDonateLink.href = state.paypalUrl;
  elements.modalPaypalLink.href = state.paypalUrl;
  elements.venmoDonateLink.href = venmoUrl;
  elements.modalVenmoLink.href = venmoUrl;
  elements.instagramProjectLink.href = instagramUrl;
  elements.youtubeChannelLink.href = safeExternalUrl(links.youtubeChannelUrl, ['youtube.com'], DEFAULT_YOUTUBE_CHANNEL_URL);
  elements.lastJamLink.href = safeExternalUrl(links.youtubeVideosUrl, ['youtube.com'], DEFAULT_YOUTUBE_VIDEOS_URL);
  renderDonationAmounts(state.status?.donations?.suggestedAmounts);
  setupYouTubeLiveProbe(safeExternalUrl(
    links.youtubeLiveEmbedUrl,
    ['youtube.com', 'youtube-nocookie.com'],
    DEFAULT_YOUTUBE_EMBED_URL,
  ));
}

function renderDonationAmounts(rawAmounts) {
  const amounts = Array.isArray(rawAmounts)
    ? rawAmounts.map(Number).filter((amount) => Number.isFinite(amount) && amount > 0).slice(0, 3)
    : [1, 2, 5];
  const normalized = amounts.length ? amounts : [1, 2, 5];
  elements.donationAmounts.replaceChildren();
  for (const amount of [...normalized, 'tip']) {
    const link = document.createElement('a');
    link.className = 'donation-amount';
    link.href = state.paypalUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = amount === 'tip' ? 'TIP' : `$${amount}`;
    link.setAttribute('aria-label', amount === 'tip' ? 'Choose a PayPal tip' : `Support MIDImyFACE with ${amount} dollars through PayPal`);
    elements.donationAmounts.appendChild(link);
  }
}

function showDonationPrompt() {
  renderDonationAmounts(state.status?.donations?.suggestedAmounts);
  setHidden(elements.donationModal, false);
  elements.dismissDonationBtn.focus();
}

function hideDonationPrompt() {
  setHidden(elements.donationModal, true);
}

function loadYouTubePlayerApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve, reject) => {
    let script = document.querySelector('script[data-mmf-youtube-api]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.mmfYoutubeApi = 'true';
      script.onerror = () => reject(new Error('youtube_api_unavailable'));
      document.head.appendChild(script);
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (window.YT?.Player) {
        clearInterval(timer);
        resolve(window.YT);
      } else if (Date.now() - startedAt > 12_000) {
        clearInterval(timer);
        reject(new Error('youtube_api_timeout'));
      }
    }, 100);
  });
}

function setYouTubeLiveVisible(visible) {
  state.youtubeLiveDetected = Boolean(visible);
  setHidden(elements.youtubeLivePanel, !visible);
  setHidden(elements.youtubeFallback, visible);
}

function inspectYouTubePlayer(attemptPlayback = true) {
  if (!state.youtubePlayer) return false;
  try {
    const videoId = String(state.youtubePlayer.getVideoData?.()?.video_id || '');
    if (!videoId) return false;
    setYouTubeLiveVisible(true);
    if (attemptPlayback) {
      state.youtubePlayer.unMute?.();
      state.youtubePlayer.setVolume?.(80);
      state.youtubePlayer.playVideo?.();
    }
    return true;
  } catch {
    return false;
  }
}

async function setupYouTubeLiveProbe(rawEmbedUrl) {
  try {
    const embedUrl = new URL(rawEmbedUrl);
    embedUrl.searchParams.set('autoplay', '1');
    embedUrl.searchParams.set('enablejsapi', '1');
    embedUrl.searchParams.set('playsinline', '1');
    embedUrl.searchParams.set('origin', window.location.origin);
    elements.youtubeLiveFrame.src = embedUrl.toString();
    const YT = await loadYouTubePlayerApi();
    state.youtubePlayer = new YT.Player(elements.youtubeLiveFrame, {
      events: {
        onReady: () => inspectYouTubePlayer(),
        onStateChange: (event) => {
          if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.BUFFERING || event.data === YT.PlayerState.CUED) {
            inspectYouTubePlayer();
          }
        },
        onError: () => setYouTubeLiveVisible(false),
        onAutoplayBlocked: () => {
          if (inspectYouTubePlayer(false)) setHidden(elements.youtubeSoundBtn, false);
        },
      },
    });
    clearInterval(state.youtubeProbeTimer);
    state.youtubeProbeTimer = window.setInterval(inspectYouTubePlayer, 3_000);
  } catch {
    setYouTubeLiveVisible(false);
  }
}

function setFormMessage(message, error = false) {
  elements.formMessage.textContent = message;
  elements.formMessage.classList.toggle('error', error);
}

function buildCountryOptions() {
  const displayNames = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' })
    : null;
  const countries = COUNTRY_CODES
    .map((code) => ({ code, label: displayNames?.of(code) || code }))
    .sort((a, b) => a.label.localeCompare(b.label));
  for (const { code, label } of countries) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = `${countryFlag(code)} ${label}`;
    elements.countrySelect.appendChild(option);
  }
  elements.nicknameInput.value = (localStorage.getItem('mmf_live_nickname') || '').slice(0, 40);
  const savedCountry = localStorage.getItem('mmf_live_country') || '';
  if (COUNTRY_CODES.includes(savedCountry)) elements.countrySelect.value = savedCountry;
}

function countryFlag(code) {
  return String(code || '').toUpperCase().replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

function resolveDeviceId() {
  const saved = localStorage.getItem('mmf_live_device_id') || '';
  if (/^[a-zA-Z0-9_-]{16,80}$/.test(saved)) return saved;
  const generated = crypto.randomUUID?.().replaceAll('-', '') || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  localStorage.setItem('mmf_live_device_id', generated);
  return generated;
}

function formatWait(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  if (safeSeconds < 60) return `about ${Math.max(1, Math.ceil(safeSeconds))} sec`;
  return `about ${Math.ceil(safeSeconds / 60)} min`;
}

function renderQueue(queue) {
  if (!queue || !state.queueToken) {
    setHidden(elements.queueCard, true);
    return;
  }
  setHidden(elements.queueCard, false);
  elements.queuePosition.textContent = `Position ${queue.position} of ${queue.totalWaiting}`;
  elements.queueEstimate.textContent = `Estimated wait ${formatWait(queue.estimatedWaitSeconds)}`;
  setFormMessage('Keep this page open. Your camera starts when your turn is ready.');
}

function clearQueue() {
  clearTimeout(state.queuePollTimer);
  state.queuePollTimer = null;
  state.queueToken = null;
  setHidden(elements.queueCard, true);
}

function setRegistrationGate(user = null) {
  const registered = Boolean(user);
  document.body.classList.toggle('auth-required', !registered);
  setHidden(elements.authPanel, registered);
  if (!registered) elements.startSessionBtn.disabled = true;
}

async function setupGoogleRegistration(publicConfig) {
  const authConfig = publicConfig?.auth || {};
  const firebaseConfig = publicConfig?.firebase || {};
  const requiredConfig = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const validConfig = requiredConfig.every((key) => typeof firebaseConfig[key] === 'string' && firebaseConfig[key].trim());
  if (!authConfig.enabled || !authConfig.firebaseConfigured || !validConfig) {
    state.authReady = false;
    elements.googleAuthBtn.disabled = true;
    elements.authMessage.textContent = 'Registration is required, but Firebase is not configured on Render yet.';
    setRegistrationGate(null);
    return;
  }
  try {
    const [{ initializeApp }, authSdk] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
    ]);
    const app = initializeApp(firebaseConfig);
    state.firebaseAuth = { auth: authSdk.getAuth(app), authSdk };
    state.authReady = true;
    authSdk.onAuthStateChanged(state.firebaseAuth.auth, async (user) => {
      if (user && localStorage.getItem(TERMS_ACCEPTED_STORAGE_KEY) !== 'true') {
        await authSdk.signOut(state.firebaseAuth.auth);
        elements.authMessage.textContent = 'Accept the terms and privacy policy before signing in.';
        setRegistrationGate(null);
        return;
      }
      state.authUser = user || null;
      state.authToken = user ? await user.getIdToken() : null;
      elements.googleAuthLabel.textContent = user ? `SIGN OUT · ${user.displayName || user.email}` : 'REGISTER FREE';
      elements.googleAuthBtn.disabled = user ? false : !state.authReady || !elements.termsConsent.checked;
      elements.authMessage.textContent = user
        ? 'Account recognized on this device.'
        : 'Create an account to save your place and future sessions.';
      setRegistrationGate(user);
    });
  } catch {
    state.authReady = false;
    elements.googleAuthBtn.disabled = true;
    elements.authMessage.textContent = 'Secure registration is temporarily unavailable. Please try again later.';
    setRegistrationGate(null);
  }
}

async function registerWithGoogle() {
  if (state.authUser && state.firebaseAuth) {
    await state.firebaseAuth.authSdk.signOut(state.firebaseAuth.auth);
    state.authUser = null;
    state.authToken = null;
    return;
  }
  if (!elements.termsConsent.checked) return;
  if (!state.firebaseAuth) {
    elements.authMessage.textContent = 'Firebase is not connected yet. Ask the project owner to finish the free setup.';
    return;
  }
  try {
    elements.googleAuthBtn.disabled = true;
    const provider = new state.firebaseAuth.authSdk.GoogleAuthProvider();
    const result = await state.firebaseAuth.authSdk.signInWithPopup(state.firebaseAuth.auth, provider);
    state.authUser = result.user;
    state.authToken = await result.user.getIdToken();
    setRegistrationGate(result.user);
  } catch (error) {
    if (error?.code !== 'auth/popup-closed-by-user') elements.authMessage.textContent = 'Google sign-in did not complete. Please try again.';
  } finally {
    elements.googleAuthBtn.disabled = !state.authReady || !elements.termsConsent.checked;
  }
}

async function activateReservation(reservation) {
  clearQueue();
  state.session = { ...reservation.session, token: reservation.token };
  const { ParticipantSession } = await import('./live_session.js');
  state.participantSession = new ParticipantSession({
    relayOrigin: state.relayOrigin,
    token: reservation.token,
    session: reservation.session,
    onStatus({ phase, message }) {
      elements.sessionStatus.textContent = message;
      if (phase === 'active') enterActiveUi(reservation.session);
      if (phase === 'expired') resetUi('Your turn is complete. Thank you for playing.', true);
      if (phase === 'error') resetUi(message || 'The camera session could not start.');
    },
    onTrigger: flashGestureTrigger,
  });
  await state.participantSession.start(elements.sessionVideo, elements.sessionCanvas);
}

async function pollQueue() {
  if (!state.queueToken) return;
  try {
    const result = await api('/api/live/queue/status', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.queueToken}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (result.ready) {
      await activateReservation(result);
      return;
    }
    renderQueue(result.queue);
  } catch (error) {
    if (error.code === 'queue_ticket_expired') {
      clearQueue();
      elements.startSessionBtn.disabled = false;
      setFormMessage('Your queue ticket expired. Press START to join again.', true);
      return;
    }
    if (error.code === 'participant_cooldown') {
      clearQueue();
      setFormMessage(`Your next turn opens in ${formatWait((error.payload?.retryAfterMs || 0) / 1000)}.`, true);
      return;
    }
  }
  state.queuePollTimer = window.setTimeout(pollQueue, 3_000);
}

function renderStatus(payload) {
  state.status = payload.status || null;
  const machine = payload.status?.machine || {};
  const accepting = Boolean(machine.alive && machine.acceptingParticipants);
  elements.statusDot.classList.toggle('online', Boolean(machine.alive));
  elements.machineStatus.textContent = machine.alive ? (accepting ? 'Installation ready' : 'Installation online') : 'Installation offline — come back later.';
  elements.machineMessage.textContent = machine.message ? `· ${machine.message}` : '';
  renderDonationAmounts(payload.status?.donations?.suggestedAmounts);

  if (!state.session && !state.queueToken) {
    if (payload.session) {
      elements.participantBadge.textContent = `${payload.session.nickname} ${countryFlag(payload.session.countryCode)} is playing`;
      elements.startSessionBtn.disabled = true;
      const waiting = Number(payload.queue?.waiting || 0);
      setFormMessage(waiting ? `${waiting} participant${waiting === 1 ? '' : 's'} waiting. Press START to join the queue.` : 'Another participant is playing. Press START to join the queue.');
      elements.startSessionBtn.disabled = !accepting || !state.authUser;
    } else {
      elements.participantBadge.textContent = '';
      elements.startSessionBtn.disabled = !accepting || !state.authUser;
      setFormMessage(accepting ? 'Ready for a 30-second turn.' : 'Come back later.', !accepting);
    }
  }
}

function flashGestureTrigger() {
  // The selected canvas pad owns the trigger flash so it stays aligned with the nose pointer.
}

function enterActiveUi(session) {
  document.body.classList.add('session-active');
  setHidden(elements.sessionIntro, true);
  setHidden(elements.sessionStatus, false);
  setHidden(elements.closeSessionBtn, false);
  setHidden(elements.gestureTriggers, false);
  setHidden(elements.stopSessionBtn, false);
  elements.participantBadge.textContent = `${session.nickname} ${countryFlag(session.countryCode)}`;
  startCountdown();
}

function resetUi(message = 'Session ended. You can start another turn when the installation is ready.', offerDonation = false) {
  document.body.classList.remove('session-active');
  setHidden(elements.sessionIntro, false);
  setHidden(elements.sessionStatus, true);
  setHidden(elements.closeSessionBtn, true);
  setHidden(elements.gestureTriggers, true);
  setHidden(elements.stopSessionBtn, true);
  elements.startSessionBtn.disabled = false;
  elements.startSessionBtn.textContent = 'START';
  elements.sessionCountdown.textContent = '';
  elements.participantBadge.textContent = '';
  clearInterval(state.countdownTimer);
  state.countdownTimer = null;
  state.session = null;
  state.participantSession = null;
  setFormMessage(message);
  refreshStatus();
  if (offerDonation) showDonationPrompt();
}

function startCountdown() {
  clearInterval(state.countdownTimer);
  const update = () => {
    if (!state.session?.expiresAt) return;
    const remaining = Math.max(0, Date.parse(state.session.expiresAt) - Date.now());
    elements.sessionCountdown.textContent = `${Math.ceil(remaining / 1000)}s`;
    if (remaining <= 0) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
      endSession(true, 'Your turn is complete. Thank you for playing.', true);
    }
  };
  update();
  state.countdownTimer = window.setInterval(update, 250);
}

function friendlyStartError(error) {
  if (error.code === 'installation_busy') return 'Another participant is playing. Join the queue.';
  if (error.code === 'installation_not_accepting') return 'The installation is online but not accepting participants.';
  if (error.code === 'start_rate_limited') return 'Please wait a few seconds before trying again.';
  if (error.code === 'invalid_firebase_token') return 'Your Google session could not be verified. Sign out, sign in, and try again.';
  if (error.code === 'firebase_admin_unconfigured') return 'Google registration is temporarily unavailable. Please try again later.';
  if (error.code === 'registration_required') return 'Register with Google before joining the instrument.';
  if (error.code === 'participant_cooldown') return `Your next turn opens in ${formatWait((error.payload?.retryAfterMs || 0) / 1000)}.`;
  if (error.code === 'nickname_required') return 'Enter a nickname with at least two characters.';
  if (error.code === 'country_required') return 'Choose your country.';
  return 'Could not start the session. Check the connection and try again.';
}

async function startSession(event) {
  event.preventDefault();
  if (state.participantSession) return;
  if (!state.authUser || !state.authToken) {
    setRegistrationGate(null);
    elements.authMessage.textContent = 'Register with Google before joining the instrument.';
    return;
  }
  hideDonationPrompt();
  const nickname = elements.nicknameInput.value.trim().slice(0, 40);
  const countryCode = elements.countrySelect.value.trim().toUpperCase();
  if (nickname.length < 2 || !COUNTRY_CODES.includes(countryCode)) {
    setFormMessage('Enter a nickname and choose your country.', true);
    return;
  }

  elements.startSessionBtn.disabled = true;
  elements.startSessionBtn.textContent = 'WAIT…';
  setFormMessage('Reserving your turn…');
  localStorage.setItem('mmf_live_nickname', nickname);
  localStorage.setItem('mmf_live_country', countryCode);

  try {
    if (state.authUser) state.authToken = await state.authUser.getIdToken();
    const requestHeaders = { 'Content-Type': 'application/json' };
    if (state.authToken) requestHeaders.Authorization = `Bearer ${state.authToken}`;
    const reservation = await api('/api/live/session/start', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ nickname, countryCode, deviceId: state.deviceId }),
    });
    if (reservation.queued) {
      state.queueToken = reservation.queueToken;
      elements.startSessionBtn.textContent = 'IN QUEUE';
      renderQueue(reservation.queue);
      state.queuePollTimer = window.setTimeout(pollQueue, 3_000);
      return;
    }
    await activateReservation(reservation);
  } catch (error) {
    if (state.session?.token) {
      fetch(`${state.relayOrigin}/api/live/session/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.session.token}`, 'Content-Type': 'application/json' },
        body: '{}',
        keepalive: true,
      }).catch(() => {});
    }
    resetUi(friendlyStartError(error));
    setFormMessage(friendlyStartError(error), true);
  }
}

async function endSession(notifyRelay = true, message, offerDonation = true) {
  const participantSession = state.participantSession;
  state.participantSession = null;
  if (participantSession) await participantSession.stop({ notifyRelay });
  resetUi(message || 'Session ended safely. The solenoids have been released.', offerDonation);
}

async function refreshStatus() {
  try {
    renderStatus(await api('/api/live/status'));
  } catch {
    elements.statusDot.classList.remove('online');
    elements.machineStatus.textContent = 'Installation offline — come back later.';
    elements.machineMessage.textContent = '';
    if (!state.session) elements.startSessionBtn.disabled = true;
  }
}

async function initialize() {
  state.deviceId = resolveDeviceId();
  setRegistrationGate(null);
  elements.termsConsent.checked = localStorage.getItem(TERMS_ACCEPTED_STORAGE_KEY) === 'true';
  buildCountryOptions();
  renderDonationAmounts([1, 2, 5]);
  elements.identityForm.addEventListener('submit', startSession);
  elements.stopSessionBtn.addEventListener('click', () => endSession(true, undefined, true));
  elements.closeSessionBtn.addEventListener('click', () => endSession(true, undefined, true));
  elements.dismissDonationBtn.addEventListener('click', hideDonationPrompt);
  elements.termsConsent.addEventListener('change', async () => {
    if (elements.termsConsent.checked) localStorage.setItem(TERMS_ACCEPTED_STORAGE_KEY, 'true');
    else {
      localStorage.removeItem(TERMS_ACCEPTED_STORAGE_KEY);
      if (state.authUser && state.firebaseAuth) await state.firebaseAuth.authSdk.signOut(state.firebaseAuth.auth);
    }
    elements.googleAuthBtn.disabled = state.authUser ? false : !state.authReady || !elements.termsConsent.checked;
  });
  elements.googleAuthBtn.addEventListener('click', registerWithGoogle);
  elements.donationModal.addEventListener('click', (event) => {
    if (event.target === elements.donationModal) hideDonationPrompt();
  });
  elements.youtubeSoundBtn.addEventListener('click', () => {
    state.youtubePlayer?.unMute?.();
    state.youtubePlayer?.setVolume?.(80);
    state.youtubePlayer?.playVideo?.();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.donationModal.classList.contains('hidden')) hideDonationPrompt();
    else if (event.key === 'Escape' && state.participantSession) endSession(true, undefined, true);
  });
  window.addEventListener('pagehide', () => state.participantSession?.stop({ notifyRelay: true }));

  try {
    state.bootstrap = await api('/api/live/bootstrap');
    configurePublicLinks(state.bootstrap);
  } catch {
    configurePublicLinks({});
  }
  try {
    await setupGoogleRegistration(await api('/api/live/config'));
  } catch {
    await setupGoogleRegistration({});
  }
  await refreshStatus();
  window.setInterval(refreshStatus, STATUS_POLL_MS);
}

initialize();
