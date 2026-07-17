const DEFAULT_RELAY_ORIGIN = 'https://midimyface-relay.onrender.com';
const STATUS_POLL_MS = 10_000;
const DEFAULT_PAYPAL_URL = 'https://www.paypal.com/qrcodes/managed/ebc92ae1-6b2e-4d36-93f0-ce2e0b4fbd2d?utm_source=consapp_download';
const DEFAULT_YOUTUBE_EMBED_URL = 'https://www.youtube.com/embed/live_stream?channel=UCequCs51HuUdCYC-RQL-b9g&autoplay=1';
const DEFAULT_INSTAGRAM_URL = 'https://www.instagram.com/midimyface/';
const COUNTRY_CODES = [
  'AR','AU','AT','BE','BO','BR','BG','CA','CL','CN','CO','CR','CU','CZ','DK','DO','EC','EG','SV','FI','FR','DE','GR','GT','HN','HK','HU','IS','IN','ID','IE','IL','IT','JP','KE','KR','LV','LT','LU','MY','MX','MA','NL','NZ','NI','NG','NO','PA','PY','PE','PH','PL','PT','PR','RO','SG','SK','SI','ZA','ES','SE','CH','TW','TH','TN','TR','UA','AE','GB','US','UY','VE','VN',
];

const elements = Object.fromEntries([
  'statusDot','machineStatus','machineMessage','participantBadge','sessionCountdown','sessionIntro','identityForm',
  'nicknameInput','countrySelect','startSessionBtn','formMessage','sessionVideo','sessionCanvas','sessionStatus',
  'closeSessionBtn','gestureTriggers','stopSessionBtn','paypalDonateLink','instagramProjectLink',
  'youtubeLivePanel','youtubeLiveFrame','youtubeSoundBtn','donationModal','donationAmounts','dismissDonationBtn',
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
  const instagramUrl = safeExternalUrl(links.instagramUrl, ['instagram.com'], DEFAULT_INSTAGRAM_URL);
  elements.paypalDonateLink.href = state.paypalUrl;
  elements.instagramProjectLink.href = instagramUrl;
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
  for (const amount of normalized) {
    const link = document.createElement('a');
    link.className = 'donation-amount';
    link.href = state.paypalUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = String(amount);
    link.setAttribute('aria-label', `Support MIDImyFACE with ${amount} through PayPal`);
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

function renderStatus(payload) {
  state.status = payload.status || null;
  const machine = payload.status?.machine || {};
  const accepting = Boolean(machine.alive && machine.acceptingParticipants);
  elements.statusDot.classList.toggle('online', Boolean(machine.alive));
  elements.machineStatus.textContent = machine.alive ? (accepting ? 'Installation ready' : 'Installation online') : 'Installation offline';
  elements.machineMessage.textContent = machine.message ? `· ${machine.message}` : '';
  renderDonationAmounts(payload.status?.donations?.suggestedAmounts);

  if (!state.session) {
    if (payload.session) {
      elements.participantBadge.textContent = `${payload.session.nickname} ${countryFlag(payload.session.countryCode)} is playing`;
      elements.startSessionBtn.disabled = true;
      setFormMessage('Another participant is playing. This page will reopen automatically.');
    } else {
      elements.participantBadge.textContent = '';
      elements.startSessionBtn.disabled = !accepting;
      setFormMessage(accepting ? 'No login required during testing.' : 'The installation is not accepting participants.', !accepting);
    }
  }
}

function flashGestureTrigger(gestureId) {
  const icon = document.querySelector(`[data-gesture="${gestureId}"]`);
  if (!icon) return;
  icon.classList.remove('triggered');
  void icon.offsetWidth;
  icon.classList.add('triggered');
  window.setTimeout(() => icon.classList.remove('triggered'), 190);
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
  elements.startSessionBtn.textContent = '▶ Start camera session';
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
  if (error.code === 'installation_busy') return 'Another participant is playing. Try again in a moment.';
  if (error.code === 'installation_not_accepting') return 'The installation is online but not accepting participants.';
  if (error.code === 'start_rate_limited') return 'Please wait a few seconds before trying again.';
  if (error.code === 'nickname_required') return 'Enter a nickname with at least two characters.';
  if (error.code === 'country_required') return 'Choose your country.';
  return 'Could not start the session. Check the connection and try again.';
}

async function startSession(event) {
  event.preventDefault();
  if (state.participantSession) return;
  hideDonationPrompt();
  const nickname = elements.nicknameInput.value.trim().slice(0, 40);
  const countryCode = elements.countrySelect.value.trim().toUpperCase();
  if (nickname.length < 2 || !COUNTRY_CODES.includes(countryCode)) {
    setFormMessage('Enter a nickname and choose your country.', true);
    return;
  }

  elements.startSessionBtn.disabled = true;
  elements.startSessionBtn.textContent = 'Starting…';
  setFormMessage('Reserving your turn…');
  localStorage.setItem('mmf_live_nickname', nickname);
  localStorage.setItem('mmf_live_country', countryCode);

  try {
    const reservation = await api('/api/live/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, countryCode }),
    });
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
    elements.machineStatus.textContent = 'Relay unavailable';
    elements.machineMessage.textContent = '';
    if (!state.session) elements.startSessionBtn.disabled = true;
  }
}

async function initialize() {
  buildCountryOptions();
  renderDonationAmounts([1, 2, 5]);
  elements.identityForm.addEventListener('submit', startSession);
  elements.stopSessionBtn.addEventListener('click', () => endSession(true, undefined, true));
  elements.closeSessionBtn.addEventListener('click', () => endSession(true, undefined, true));
  elements.dismissDonationBtn.addEventListener('click', hideDonationPrompt);
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
  await refreshStatus();
  window.setInterval(refreshStatus, STATUS_POLL_MS);
}

initialize();
