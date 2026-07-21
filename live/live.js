import { BUILD_COMMIT as LIVE_BUILD_COMMIT } from './build-info.js?v=20260721-media-9';

const DEFAULT_RELAY_ORIGIN = 'https://midimyface-relay.onrender.com';
const STATUS_POLL_MS = 10_000;
const DEFAULT_PAYPAL_URL = 'https://www.paypal.com/qrcodes/managed/ebc92ae1-6b2e-4d36-93f0-ce2e0b4fbd2d?utm_source=consapp_download';
const DEFAULT_VENMO_URL = 'https://venmo.com/code?user_id=2982237150642176372&created=1784274093';
const DEFAULT_YOUTUBE_CHANNEL_URL = 'https://www.youtube.com/channel/UCequCs51HuUdCYC-RQL-b9g';
const DEFAULT_YOUTUBE_VIDEOS_URL = `${DEFAULT_YOUTUBE_CHANNEL_URL}/videos`;
const DEFAULT_INSTAGRAM_URL = 'https://www.instagram.com/midimyface/';
const WEBRTC_SOUND_PREF_KEY = 'mmf_live_webrtc_sound_on';
const LIVE_PROTOCOL_VERSION = 'midimyface-live-v2';
const TERMS_ACCEPTED_STORAGE_KEY = 'mmf_live_terms_accepted_v1';
const INSTALLATION_STATUS_COLLECTION = 'installation';
const INSTALLATION_STATUS_DOCUMENT = 'status';
const USER_PROFILE_COLLECTION = 'users';
const NICKNAME_MIN_LENGTH = 2;
const NICKNAME_MAX_LENGTH = 10;
const FACE_MISSING_GRACE_MS = 1_400;
const FACE_TIP_ROTATE_MS = 3_000;
const FACE_SEARCH_TIPS = [
  'Allow camera access in the browser.',
  'Keep your face clearly visible.',
  'Avoid strong backlight.',
  'Stay at a comfortable distance.',
  'Try changing your position.',
];
const BLOCKED_NICKNAME_TERMS = [
  'asshole','bastard','beaner','bitch','chink','coon','cunt','dick','faggot',
  'fuck','gook','hitler','jerkoff','kike','kkk','nazi','nigga','nigger',
  'penis','pussy','raghead','rape','rapist','shit','slut','vagina','wetback','whore',
];
const BLOCKED_NICKNAME_TERM_SET = new Set(BLOCKED_NICKNAME_TERMS);
const COUNTRY_CODES = [
  'AR','AU','AT','BE','BO','BR','BG','CA','CL','CN','CO','CR','CU','CZ','DK','DO','EC','EG','SV','FI','FR','DE','GR','GT','HN','HK','HU','IS','IN','ID','IE','IL','IT','JP','KE','KR','LV','LT','LU','MY','MX','MA','NL','NZ','NI','NG','NO','PA','PY','PE','PH','PL','PT','PR','RO','SG','SK','SI','ZA','ES','SE','CH','TW','TH','TN','TR','UA','AE','GB','US','UY','VE','VN',
];

const elements = Object.fromEntries([
  'statusDot','machineStatus','machineMessage','participantBadge','sessionCountdown','sessionIntro','identityForm',
  'nicknameInput','countrySelect','startSessionBtn','formMessage','sessionVideo','sessionCanvas','sessionStatus',
  'closeSessionBtn','gestureTriggers','stopSessionBtn','paypalDonateLink','instagramProjectLink',
  'webrtcSoundBtn','webrtcConnectionLabel','donationModal','donationAmounts','dismissDonationBtn',
  'venmoDonateLink','modalPaypalLink','modalVenmoLink','youtubeChannelLink','lastJamLink',
  'termsConsent','googleAuthBtn','googleAuthLabel','googleSignInBtn','authMessage','queueCard','queuePosition','queueEstimate',
  'authPanel','registrationTitle','registrationLead','availabilityPanel','availabilityTitle','availabilityText',
  'availabilityActions','notifyBellBtn','notifyBellLabel','availabilityRetryBtn','joinPanel','notificationModal',
  'notificationMessage','notificationConfirmBtn','notificationCancelBtn',
  'miniProgramPreview','miniPreviewVideo','previewVideo','faceLoadingOverlay','faceLoadingTitle','faceLoadingTip',
  'mobileOrientationModal','mobileOrientationTitle','mobileOrientationText','mobileOrientationContinueBtn',
].map((id) => [id, document.getElementById(id)]));

const state = {
  relayOrigin: resolveRelayOrigin(),
  bootstrap: null,
  status: null,
  availabilityState: 'checking',
  availabilityReason: '',
  installationStatusUnsubscribe: null,
  userPreferenceUnsubscribe: null,
  session: null,
  participantSession: null,
  countdownTimer: null,
  paypalUrl: DEFAULT_PAYPAL_URL,
  queueToken: null,
  queuePollTimer: null,
  deviceId: null,
  authUser: null,
  authToken: null,
  firebaseAuth: null,
  firestore: null,
  firestoreSdk: null,
  authReady: false,
  notifyInstallationOnline: false,
  previewClient: null,
  previewStartPromise: null,
  cameraFeedEnabled: false,
  mediaState: 'DISABLED',
  previewFeedAvailable: false,
  previewConnectionState: 'disabled',
  previewHasVideo: false,
  previewHasAudio: false,
  webrtcSoundEnabled: sessionStorage.getItem(WEBRTC_SOUND_PREF_KEY) === 'true',
  previewStats: { fps: 0, receiveFps: 0, framesDecoded: 0, framesReceived: 0, jitter: 0, frameAgeMs: 0 },
  faceTipIndex: 0,
  faceTipTimer: null,
  faceMissingTimer: null,
  mobileOrientationShown: false,
  mobileOrientationPromise: null,
  mobileOrientationResolve: null,
  startPending: false,
  authNotice: '',
  formMessageLockUntil: 0,
};

function attachPreviewStream(videoEl, stream, { muted = true } = {}) {
  if (!videoEl) return;
  const sameStream = videoEl.srcObject === stream;
  videoEl.srcObject = stream;
  videoEl.muted = muted;
  if (!sameStream) {
    videoEl.play().catch(() => {});
  }
}

function updateWebRtcUi() {
  const stateLabel = elements.webrtcConnectionLabel;
  const mediaEnabled = state.cameraFeedEnabled;
  setHidden(stateLabel, !mediaEnabled);
  setHidden(elements.webrtcSoundBtn, !mediaEnabled);
  if (!mediaEnabled) return;
  if (stateLabel) {
    let label = 'Connecting';
    if (state.previewConnectionState === 'reconnecting') label = 'Reconnecting';
    else if (state.previewConnectionState === 'connected' && !state.previewHasVideo) label = 'Video unavailable';
    else if (state.previewConnectionState === 'connected' && !state.previewHasAudio) label = 'Audio unavailable';
    else if (state.previewConnectionState === 'connected') label = 'Connected';
    stateLabel.textContent = label;
  }

  const button = elements.webrtcSoundBtn;
  if (!button) return;
  const audioAvailable = state.previewHasAudio && state.previewFeedAvailable;
  if (!audioAvailable) {
    button.textContent = 'Audio unavailable';
    button.disabled = true;
    button.setAttribute('aria-pressed', 'false');
    return;
  }
  button.disabled = false;
  button.textContent = state.webrtcSoundEnabled ? 'Sound On' : 'Sound Off';
  button.setAttribute('aria-pressed', state.webrtcSoundEnabled ? 'true' : 'false');
}

function applyWebRtcAudioPreference() {
  const shouldPlayAudio = Boolean(state.webrtcSoundEnabled && state.previewHasAudio && state.previewFeedAvailable);
  if (elements.previewVideo) {
    const shouldPlaySessionAudio = shouldPlayAudio && Boolean(state.session);
    elements.previewVideo.muted = !shouldPlaySessionAudio;
    if (state.session && state.previewFeedAvailable) {
      elements.previewVideo.play().catch(() => {
        // Mobile browsers may reject an unmuted autoplay after async session setup.
        // Keep the video background reliable and fall back to muted playback.
        elements.previewVideo.muted = true;
        elements.previewVideo.play().catch(() => {});
      });
    }
  }
  if (elements.miniPreviewVideo) {
    const shouldPlayJoinAudio = shouldPlayAudio && !state.session;
    elements.miniPreviewVideo.muted = !shouldPlayJoinAudio;
    if (!state.session && state.previewFeedAvailable) {
      elements.miniPreviewVideo.play().catch(() => {
        elements.miniPreviewVideo.muted = true;
        elements.miniPreviewVideo.play().catch(() => {});
      });
    }
  }
  updateWebRtcUi();
}

async function ensurePreviewClient() {
  if (!state.cameraFeedEnabled) return null;
  if (state.previewClient) {
    return state.previewClient;
  }
  if (state.previewStartPromise) return state.previewStartPromise;
  state.previewStartPromise = (async () => {
  try {
    const { PreviewClient } = await import('./broadcast/preview_client.js?v=20260721-media-9');
    state.previewClient = new PreviewClient({
      relayOrigin: state.relayOrigin,
      role: 'waiting_viewer',
      sessionId: '',
      onStream(stream) {
        state.previewHasVideo = Boolean(stream?.getVideoTracks?.().some((track) => track.readyState === 'live'));
        state.previewHasAudio = Boolean(stream?.getAudioTracks?.().some((track) => track.readyState === 'live'));
        state.previewFeedAvailable = state.previewHasVideo;
        updateProgramFeedVisibility();
        attachPreviewStream(elements.previewVideo, stream, { muted: true });
        attachPreviewStream(elements.miniPreviewVideo, stream, { muted: true });
        applyWebRtcAudioPreference();
      },
      onConnectionState(nextState) {
        state.previewConnectionState = String(nextState || 'connecting');
        updateWebRtcUi();
      },
      onMediaState({ hasVideo, hasAudio }) {
        state.previewHasVideo = Boolean(hasVideo);
        state.previewHasAudio = Boolean(hasAudio);
        state.previewFeedAvailable = state.previewHasVideo;
        updateProgramFeedVisibility();
        applyWebRtcAudioPreference();
      },
      onStats(stats) {
        state.previewStats = stats;
      },
    });
    await state.previewClient.start();
  } catch {
    state.previewClient = null;
    state.previewFeedAvailable = false;
    state.previewHasVideo = false;
    state.previewHasAudio = false;
    state.previewConnectionState = 'reconnecting';
    updateProgramFeedVisibility();
    updateWebRtcUi();
  }
  return state.previewClient;
  })();
  try {
    return await state.previewStartPromise;
  } finally {
    state.previewStartPromise = null;
  }
}

function disablePreviewClient() {
  state.previewClient?.stop?.();
  state.previewClient = null;
  state.previewFeedAvailable = false;
  state.previewHasVideo = false;
  state.previewHasAudio = false;
  state.previewConnectionState = 'disabled';
  state.mediaState = 'DISABLED';
  if (elements.previewVideo) elements.previewVideo.srcObject = null;
  if (elements.miniPreviewVideo) elements.miniPreviewVideo.srcObject = null;
}

function reconcileMediaState(status) {
  const enabled = status?.media?.cameraFeedEnabled === true;
  state.cameraFeedEnabled = enabled;
  state.mediaState = enabled ? String(status?.media?.state || 'CONNECTING').toUpperCase() : 'DISABLED';
  if (!enabled) {
    disablePreviewClient();
  } else {
    ensurePreviewClient();
  }
  updateProgramFeedVisibility();
  updateWebRtcUi();
}

function updateProgramFeedVisibility() {
  const hasFeed = Boolean(state.cameraFeedEnabled && state.previewFeedAvailable);
  document.body.classList.toggle('no-program-feed', !hasFeed);
  setHidden(elements.previewVideo, !hasFeed || !state.session);
  setHidden(elements.miniProgramPreview, !hasFeed || Boolean(state.session));
  applyWebRtcAudioPreference();
}

function setFaceSearchVisible(visible) {
  elements.faceLoadingOverlay?.classList.toggle('visible', visible);
  elements.faceLoadingOverlay?.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (!visible) {
    clearInterval(state.faceTipTimer);
    state.faceTipTimer = null;
    elements.faceLoadingTip?.classList.remove('tip-swap');
  }
}

function rotateFaceSearchTip() {
  if (!elements.faceLoadingTip) return;
  elements.faceLoadingTip.classList.add('tip-swap');
  window.setTimeout(() => {
    state.faceTipIndex = (state.faceTipIndex + 1) % FACE_SEARCH_TIPS.length;
    elements.faceLoadingTip.textContent = FACE_SEARCH_TIPS[state.faceTipIndex];
    elements.faceLoadingTip.classList.remove('tip-swap');
  }, 220);
}

function showFaceSearch() {
  clearTimeout(state.faceMissingTimer);
  state.faceMissingTimer = null;
  state.faceTipIndex = 0;
  if (elements.faceLoadingTitle) elements.faceLoadingTitle.textContent = 'Looking for your face…';
  if (elements.faceLoadingTip) elements.faceLoadingTip.textContent = FACE_SEARCH_TIPS[0];
  setFaceSearchVisible(true);
  if (!state.faceTipTimer) state.faceTipTimer = window.setInterval(rotateFaceSearchTip, FACE_TIP_ROTATE_MS);
}

function hideFaceSearch() {
  clearTimeout(state.faceMissingTimer);
  state.faceMissingTimer = null;
  setFaceSearchVisible(false);
}

function scheduleFaceSearch() {
  clearTimeout(state.faceMissingTimer);
  state.faceMissingTimer = window.setTimeout(showFaceSearch, FACE_MISSING_GRACE_MS);
}

function isMobileBrowser() {
  if (navigator.userAgentData?.mobile === true) return true;
  if (/Android|iPhone|iPod|Mobile/i.test(navigator.userAgent || '')) return true;
  return window.matchMedia?.('(max-width: 900px) and (pointer: coarse)').matches === true;
}

function updateMobileOrientationCopy() {
  const landscape = window.innerWidth > window.innerHeight;
  if (elements.mobileOrientationTitle) {
    elements.mobileOrientationTitle.textContent = landscape ? 'LANDSCAPE READY' : 'TURN YOUR PHONE';
  }
  if (elements.mobileOrientationText) {
    elements.mobileOrientationText.textContent = landscape
      ? 'Your phone is ready for the full-screen camera experience.'
      : 'Please rotate your phone to landscape for the best full-screen camera experience.';
  }
}

function showMobileOrientationGuidance() {
  if (!isMobileBrowser() || state.mobileOrientationShown) return Promise.resolve();
  if (state.mobileOrientationPromise) return state.mobileOrientationPromise;
  updateMobileOrientationCopy();
  setHidden(elements.mobileOrientationModal, false);
  state.mobileOrientationPromise = new Promise((resolve) => {
    state.mobileOrientationResolve = resolve;
  });
  return state.mobileOrientationPromise;
}

function finishMobileOrientationGuidance() {
  setHidden(elements.mobileOrientationModal, true);
  state.mobileOrientationShown = true;
  const resolve = state.mobileOrientationResolve;
  state.mobileOrientationResolve = null;
  state.mobileOrientationPromise = null;
  resolve?.();
}

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

function normalizeNickname(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function nicknameModerationForms(value) {
  const leetMap = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i' };
  const spaced = normalizeNickname(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0134578@$!]/g, (char) => leetMap[char] || char)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const compact = spaced.replace(/\s+/g, '');
  return { compact, tokens: spaced ? spaced.split(' ') : [] };
}

function nicknameContainsBlockedTerm(value) {
  const { compact, tokens } = nicknameModerationForms(value);
  return tokens.some((token) => BLOCKED_NICKNAME_TERM_SET.has(token))
    || BLOCKED_NICKNAME_TERMS.some((term) => compact.includes(term));
}

function validateNickname(value) {
  const nickname = normalizeNickname(value);
  if (nickname.length < NICKNAME_MIN_LENGTH) return { ok: false, errorCode: 'nickname_required' };
  if (nickname.length > NICKNAME_MAX_LENGTH) return { ok: false, errorCode: 'nickname_too_long' };
  if (nicknameContainsBlockedTerm(nickname)) return { ok: false, errorCode: 'nickname_inappropriate' };
  return { ok: true, nickname };
}

function friendlyNicknameError(errorCode) {
  if (errorCode === 'nickname_required') return 'Enter a nickname with at least two characters.';
  if (errorCode === 'nickname_too_long') return 'Nicknames can be up to 10 characters.';
  if (errorCode === 'nickname_inappropriate') return 'Choose a respectful nickname to join the live session.';
  return 'Enter a valid nickname.';
}

function updateNicknameFieldState() {
  const value = elements.nicknameInput?.value || '';
  const validation = value.trim() ? validateNickname(value) : { ok: true };
  elements.nicknameInput?.setCustomValidity(validation.ok ? '' : friendlyNicknameError(validation.errorCode));
}

function setHidden(node, hidden) {
  node?.classList.toggle('hidden', hidden);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function setAvailabilityState(nextState, reason = '') {
  state.availabilityState = nextState;
  state.availabilityReason = reason;
  document.body.classList.toggle('availability-online', nextState === 'online');
  setHidden(elements.joinPanel, nextState !== 'online');
  setHidden(elements.availabilityPanel, nextState === 'online');
  setHidden(elements.availabilityRetryBtn, nextState !== 'error');

  if (nextState === 'checking') {
    elements.statusDot.classList.remove('online');
    elements.machineStatus.textContent = 'Checking installation…';
    elements.machineMessage.textContent = '';
    elements.availabilityTitle.textContent = 'Checking installation…';
    elements.availabilityText.textContent = '';
  } else if (nextState === 'offline') {
    elements.statusDot.classList.remove('online');
    elements.machineStatus.textContent = 'Installation Offline';
    elements.machineMessage.textContent = '';
    elements.availabilityTitle.textContent = 'Installation Offline';
    elements.availabilityText.textContent = 'Come back later.';
  } else if (nextState === 'error') {
    elements.statusDot.classList.remove('online');
    elements.machineStatus.textContent = 'Connection error';
    elements.machineMessage.textContent = '';
    elements.availabilityTitle.textContent = 'Connection error';
    elements.availabilityText.textContent = reason || 'Please try again.';
  } else {
    elements.statusDot.classList.add('online');
    elements.machineStatus.textContent = 'Installation Ready';
    elements.machineMessage.textContent = '';
  }

  renderNotificationUi();
  setRegistrationGate(state.authUser);
}

function updateAuthPanelCopy() {
  if (state.availabilityState === 'offline') {
    elements.registrationTitle.textContent = 'INSTALLATION OFFLINE';
    elements.registrationLead.textContent = 'Come back later.';
    return;
  }
  if (state.availabilityState === 'checking') {
    elements.registrationTitle.textContent = 'CHECKING INSTALLATION…';
    elements.registrationLead.textContent = 'Please wait.';
    return;
  }
  if (state.availabilityState === 'error') {
    elements.registrationTitle.textContent = 'CONNECTION ERROR';
    elements.registrationLead.textContent = 'Please try again.';
    return;
  }
  elements.registrationTitle.textContent = 'REGISTER TO JOIN';
  elements.registrationLead.textContent = 'Create a free account before entering the instrument queue.';
}

function renderNotificationUi() {
  const showBell = state.availabilityState === 'offline' && Boolean(state.authUser);
  setHidden(elements.notifyBellBtn, !showBell);
  setHidden(elements.notifyBellLabel, !showBell);
  if (!showBell) {
    elements.notifyBellBtn.classList.remove('active');
    elements.notifyBellBtn.setAttribute('aria-pressed', 'false');
    return;
  }
  elements.notifyBellBtn.classList.toggle('active', state.notifyInstallationOnline);
  elements.notifyBellBtn.setAttribute('aria-pressed', state.notifyInstallationOnline ? 'true' : 'false');
}

function closeNotificationPrompt() {
  setHidden(elements.notificationModal, true);
}

function openNotificationPrompt() {
  setHidden(elements.notificationModal, false);
}

async function setNotificationPreference(enabled) {
  if (!state.authUser || !state.firestore || !state.firestoreSdk) return;
  const { doc, setDoc, serverTimestamp } = state.firestoreSdk;
  await setDoc(doc(state.firestore, USER_PROFILE_COLLECTION, state.authUser.uid), {
    email: state.authUser.email || '',
    displayName: state.authUser.displayName || null,
    notifyInstallationOnline: enabled === true,
    notificationPreferenceUpdatedAt: serverTimestamp(),
  }, { merge: true });
}

async function ensureUserDocument(user) {
  return window.MMFAuthGate.ensureUserProfile({ firestore: state.firestore, firestoreSdk: state.firestoreSdk }, user);
}

async function registeredUserProfileExists(user) {
  return window.MMFAuthGate.profileExists({ firestore: state.firestore, firestoreSdk: state.firestoreSdk }, user);
}

function subscribeUserPreference(user) {
  state.userPreferenceUnsubscribe?.();
  state.userPreferenceUnsubscribe = null;
  state.notifyInstallationOnline = false;
  renderNotificationUi();
  if (!user || !state.firestore || !state.firestoreSdk) return;
  const { doc, onSnapshot } = state.firestoreSdk;
  state.userPreferenceUnsubscribe = onSnapshot(doc(state.firestore, USER_PROFILE_COLLECTION, user.uid), (snapshot) => {
    const data = snapshot.data();
    state.notifyInstallationOnline = data?.notifyInstallationOnline === true;
    renderNotificationUi();
  }, () => {
    state.notifyInstallationOnline = false;
    renderNotificationUi();
  });
}

function applyInstallationStatusSnapshot(snapshot) {
  if (!snapshot?.exists?.()) {
    setAvailabilityState('offline');
    return;
  }
  const data = snapshot.data();
  if (!isPlainObject(data) || data.online !== true) {
    setAvailabilityState('offline');
    return;
  }
  setAvailabilityState('online');
}

function restartInstallationStatusListener() {
  state.installationStatusUnsubscribe?.();
  state.installationStatusUnsubscribe = null;
  if (!state.firestore || !state.firestoreSdk) {
    setAvailabilityState('error', 'Please try again.');
    return;
  }
  const { doc, onSnapshot } = state.firestoreSdk;
  setAvailabilityState('checking');
  state.installationStatusUnsubscribe = onSnapshot(
    doc(state.firestore, INSTALLATION_STATUS_COLLECTION, INSTALLATION_STATUS_DOCUMENT),
    applyInstallationStatusSnapshot,
    () => setAvailabilityState('error', 'Please try again.'),
  );
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

function setFormMessage(message, error = false, lockMs = 0) {
  elements.formMessage.textContent = message;
  elements.formMessage.classList.toggle('error', error);
  if (lockMs > 0) state.formMessageLockUntil = Date.now() + lockMs;
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
  elements.nicknameInput.value = normalizeNickname(localStorage.getItem('mmf_live_nickname') || '').slice(0, NICKNAME_MAX_LENGTH);
  updateNicknameFieldState();
  const savedCountry = localStorage.getItem('mmf_live_country') || '';
  if (COUNTRY_CODES.includes(savedCountry)) elements.countrySelect.value = savedCountry;
}

function countryFlag(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '';
  return normalized.replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

function liveTurnDurationSeconds(source = state.bootstrap) {
  const bootstrapDuration = Number(source?.queuePolicy?.turnDurationSeconds);
  if (Number.isFinite(bootstrapDuration) && bootstrapDuration > 0) return bootstrapDuration;
  const statusDuration = Number(state.status?.queue?.turnDurationSeconds);
  if (Number.isFinite(statusDuration) && statusDuration > 0) return statusDuration;
  return 60;
}

function formatTurnDuration(seconds) {
  const safeSeconds = Math.max(1, Math.round(Number(seconds) || 0));
  if (safeSeconds < 60) return `${safeSeconds}-second`;
  const minutes = safeSeconds / 60;
  return Number.isInteger(minutes) && minutes !== 1 ? `${minutes}-minute` : `${safeSeconds}-second`;
}

function formatSessionCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
  const showGate = !registered && (state.availabilityState === 'online' || state.availabilityState === 'offline');
  document.body.classList.toggle('auth-required', showGate);
  setHidden(elements.authPanel, !showGate);
  updateAuthPanelCopy();
  if (state.availabilityState !== 'online') elements.startSessionBtn.disabled = true;
}

async function setupGoogleRegistration(publicConfig) {
  const authConfig = publicConfig?.auth || {};
  const firebaseConfig = publicConfig?.firebase || {};
  const requiredConfig = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const validConfig = requiredConfig.every((key) => typeof firebaseConfig[key] === 'string' && firebaseConfig[key].trim());
  if (!validConfig) {
    state.authReady = false;
    elements.googleAuthBtn.disabled = true;
    elements.googleSignInBtn.disabled = true;
    elements.authMessage.textContent = 'Secure registration is temporarily unavailable. Please try again later.';
    setRegistrationGate(null);
    setAvailabilityState('error', 'Please try again.');
    return;
  }
  try {
    const firebaseContext = await window.MMFAuthGate.getFirebaseContext(publicConfig);
    const { authSdk, firestoreSdk } = firebaseContext;
    state.firebaseAuth = { auth: firebaseContext.auth, authSdk };
    state.firestore = firebaseContext.firestore;
    state.firestoreSdk = firestoreSdk;
    state.authReady = Boolean(authConfig.enabled && authConfig.firebaseConfigured);
    restartInstallationStatusListener();
    authSdk.onAuthStateChanged(state.firebaseAuth.auth, async (user) => {
      if (user) {
        const termsAcceptedHere = localStorage.getItem(TERMS_ACCEPTED_STORAGE_KEY) === 'true';
        const registeredProfile = await registeredUserProfileExists(user);
        if (!termsAcceptedHere && registeredProfile !== true) {
          state.authNotice = registeredProfile === false
            ? 'This Google account is not registered yet. Accept the terms and use REGISTER FREE.'
            : 'Your registration could not be verified. Check the connection and try SIGN IN again.';
          await authSdk.signOut(state.firebaseAuth.auth);
          return;
        }
        if (registeredProfile === true && !termsAcceptedHere) {
          // A profile is written only after the registration terms were accepted.
          // Restore that acknowledgement in private/incognito browser storage.
          localStorage.setItem(TERMS_ACCEPTED_STORAGE_KEY, 'true');
          elements.termsConsent.checked = true;
        }
      }
      state.authUser = user || null;
      state.authToken = user ? await user.getIdToken() : null;
      if (user) {
        await ensureUserDocument(user).catch(() => {});
        subscribeUserPreference(user);
      } else {
        subscribeUserPreference(null);
      }
      elements.googleAuthLabel.textContent = user ? `SIGN OUT · ${user.displayName || user.email}` : 'REGISTER FREE';
      elements.googleAuthBtn.disabled = user ? false : !state.authReady || !elements.termsConsent.checked;
      elements.googleSignInBtn.disabled = user ? true : !state.authReady;
      elements.authMessage.textContent = user
        ? 'Account recognized on this device.'
        : (state.authNotice || 'Create an account to save your place and future sessions.');
      state.authNotice = '';
      setRegistrationGate(user);
    });
  } catch {
    state.authReady = false;
    elements.googleAuthBtn.disabled = true;
    elements.googleSignInBtn.disabled = true;
    elements.authMessage.textContent = 'Secure registration is temporarily unavailable. Please try again later.';
    setRegistrationGate(null);
    setAvailabilityState('error', 'Please try again.');
  }
}

async function authenticateWithGoogle({ existingOnly = false } = {}) {
  if (state.authUser && state.firebaseAuth) {
    await state.firebaseAuth.authSdk.signOut(state.firebaseAuth.auth);
    state.authUser = null;
    state.authToken = null;
    return;
  }
  if (!existingOnly && !elements.termsConsent.checked) {
    elements.authMessage.textContent = 'Accept the Terms and Conditions before registering.';
    return;
  }
  if (!state.firebaseAuth) {
    elements.authMessage.textContent = 'Firebase is not connected yet. Ask the project owner to finish the free setup.';
    return;
  }
  try {
    elements.googleAuthBtn.disabled = true;
    elements.googleSignInBtn.disabled = true;
    const provider = new state.firebaseAuth.authSdk.GoogleAuthProvider();
    await state.firebaseAuth.authSdk.signInWithPopup(state.firebaseAuth.auth, provider);
  } catch (error) {
    if (error?.code !== 'auth/popup-closed-by-user') elements.authMessage.textContent = 'Google sign-in did not complete. Please try again.';
  } finally {
    elements.googleAuthBtn.disabled = state.authUser ? false : !state.authReady || !elements.termsConsent.checked;
    elements.googleSignInBtn.disabled = Boolean(state.authUser) || !state.authReady;
  }
}

function registerWithGoogle() {
  return authenticateWithGoogle({ existingOnly: false });
}

function signInWithGoogle() {
  return authenticateWithGoogle({ existingOnly: true });
}

async function activateReservation(reservation) {
  clearQueue();
  await ensurePreviewClient();
  state.session = { ...reservation.session, token: reservation.token };
  const { ParticipantSession } = await import('./live_session.js?v=20260721-media-9');
  state.participantSession = new ParticipantSession({
    relayOrigin: state.relayOrigin,
    token: reservation.token,
    session: reservation.session,
    onStatus({ phase, message }) {
      elements.sessionStatus.textContent = message;
      if (phase === 'active') {
        enterActiveUi(reservation.session);
        showFaceSearch();
      }
      if (phase === 'face-found') hideFaceSearch();
      if (phase === 'searching-face') scheduleFaceSearch();
      if (phase === 'expired') resetUi('Your turn is complete. Thank you for playing.', true);
      if (phase === 'error') {
        const cameraMessage = message || 'The camera session could not start.';
        resetUi(cameraMessage);
        setFormMessage(cameraMessage, true, 15_000);
      }
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
  reconcileMediaState(state.status);
  const remoteProtocol = String(payload.status?.protocolVersion || state.bootstrap?.protocolVersion || 'unknown');
  if (remoteProtocol !== LIVE_PROTOCOL_VERSION) {
    console.error('[MIDImyFACE] Live protocol mismatch', {
      liveBuildCommit: LIVE_BUILD_COMMIT,
      liveProtocolVersion: LIVE_PROTOCOL_VERSION,
      relayProtocolVersion: remoteProtocol,
      relayBuildCommit: state.bootstrap?.builds?.relayCommit || 'unknown',
      piBuildCommit: payload.status?.builds?.piCommit || 'unknown',
    });
  }
  const machine = payload.status?.machine || {};
  const accepting = Boolean(machine.alive && machine.acceptingParticipants);
  renderDonationAmounts(payload.status?.donations?.suggestedAmounts);

  if (state.availabilityState !== 'online') {
    elements.startSessionBtn.disabled = true;
    return;
  }

  elements.statusDot.classList.toggle('online', Boolean(machine.alive));
  elements.machineStatus.textContent = machine.alive ? (accepting ? 'Installation Ready' : 'Installation Online') : 'Installation Offline';
  elements.machineMessage.textContent = machine.message ? `· ${machine.message}` : '';

  if (!state.session && !state.queueToken) {
    const activeSessions = Array.isArray(payload.sessions) ? payload.sessions : (payload.session ? [payload.session] : []);
    const available = Number.isFinite(payload.capacity?.available) ? payload.capacity.available : Math.max(0, 3 - activeSessions.length);
    const canReplaceFormMessage = Date.now() >= state.formMessageLockUntil;
    if (activeSessions.length) {
      elements.participantBadge.textContent = `${activeSessions.length}/3 playing`;
      const waiting = Number(payload.queue?.waiting || 0);
      if (canReplaceFormMessage) {
        setFormMessage(waiting
          ? `${waiting} participant${waiting === 1 ? '' : 's'} waiting. Press START to join the queue.`
          : available > 0 ? `${available} live place${available === 1 ? '' : 's'} available.` : 'All three live places are active. Press START to join the queue.');
      }
      elements.startSessionBtn.disabled = !accepting || !state.authUser;
    } else {
      elements.participantBadge.textContent = '';
      elements.startSessionBtn.disabled = !accepting || !state.authUser;
      if (canReplaceFormMessage) {
        setFormMessage(accepting ? `Ready for a ${formatTurnDuration(liveTurnDurationSeconds())} turn.` : 'Come back later.', !accepting);
      }
    }
  }

  updateProgramFeedVisibility();
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
  const flag = countryFlag(session.countryCode);
  elements.participantBadge.textContent = flag ? `${session.nickname} ${flag}` : session.nickname;
  setHidden(elements.miniProgramPreview, true);
  updateProgramFeedVisibility();
  startCountdown();
}

function resetUi(message = 'Session ended. You can start another turn when the installation is ready.', offerDonation = false) {
  document.body.classList.remove('session-active');
  hideFaceSearch();
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
  updateProgramFeedVisibility();
  ensurePreviewClient().catch(() => {});
  refreshStatus();
  if (offerDonation) showDonationPrompt();
}

function startCountdown() {
  clearInterval(state.countdownTimer);
  const update = () => {
    if (!state.session?.expiresAt) return;
    const remaining = Math.max(0, Date.parse(state.session.expiresAt) - Date.now());
    elements.sessionCountdown.textContent = formatSessionCountdown(remaining);
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
  if (error.code === 'installation_control_unreachable') return 'The installation control link is offline. Please wait for it to reconnect.';
  if (error.code === 'installation_not_accepting') return 'The installation is online but not accepting participants.';
  if (error.code === 'start_rate_limited') return 'Please wait a few seconds before trying again.';
  if (error.code === 'invalid_firebase_token') return 'Your Google session could not be verified. Sign out, sign in, and try again.';
  if (error.code === 'firebase_admin_unconfigured') return 'Google registration is temporarily unavailable. Please try again later.';
  if (error.code === 'registration_required') return 'Register with Google before joining the instrument.';
  if (error.code === 'participant_cooldown') return `Your next turn opens in ${formatWait((error.payload?.retryAfterMs || 0) / 1000)}.`;
  if (error.code === 'nickname_required' || error.code === 'nickname_too_long' || error.code === 'nickname_inappropriate') return friendlyNicknameError(error.code);
  if (error.code === 'country_required') return 'Choose your country.';
  return 'Could not start the session. Check the connection and try again.';
}

async function startSession(event) {
  event.preventDefault();
  if (state.participantSession || state.startPending) return;
  if (state.availabilityState !== 'online') {
    setAvailabilityState('offline');
    return;
  }
  if (!state.authUser || !state.authToken) {
    setRegistrationGate(null);
    elements.authMessage.textContent = 'Register with Google before joining the instrument.';
    return;
  }
  state.formMessageLockUntil = 0;
  hideDonationPrompt();
  const nicknameValidation = validateNickname(elements.nicknameInput.value);
  const countryCode = elements.countrySelect.value.trim().toUpperCase();
  if (!nicknameValidation.ok) {
    const message = friendlyNicknameError(nicknameValidation.errorCode);
    elements.nicknameInput.setCustomValidity(message);
    elements.nicknameInput.reportValidity();
    setFormMessage(message, true);
    return;
  }
  if (!COUNTRY_CODES.includes(countryCode)) {
    setFormMessage('Choose your country.', true);
    return;
  }
  const nickname = nicknameValidation.nickname;
  elements.nicknameInput.value = nickname;
  elements.nicknameInput.setCustomValidity('');

  state.startPending = true;
  elements.startSessionBtn.disabled = true;
  await showMobileOrientationGuidance();
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
  } finally {
    state.startPending = false;
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
    if (state.availabilityState === 'online' && !state.session) {
      elements.startSessionBtn.disabled = true;
      setFormMessage('Could not refresh live status. Please try again.', true);
    }
  }
}

async function initialize() {
  state.deviceId = resolveDeviceId();
  setAvailabilityState('checking');
  setRegistrationGate(null);
  elements.termsConsent.checked = localStorage.getItem(TERMS_ACCEPTED_STORAGE_KEY) === 'true';
  buildCountryOptions();
  renderDonationAmounts([1, 2, 5]);
  elements.identityForm.addEventListener('submit', startSession);
  elements.nicknameInput.addEventListener('input', updateNicknameFieldState);
  elements.nicknameInput.addEventListener('blur', updateNicknameFieldState);
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
    elements.googleSignInBtn.disabled = Boolean(state.authUser) || !state.authReady;
  });
  elements.googleAuthBtn.addEventListener('click', registerWithGoogle);
  elements.googleSignInBtn.addEventListener('click', signInWithGoogle);
  elements.mobileOrientationContinueBtn.addEventListener('click', finishMobileOrientationGuidance);
  window.addEventListener('resize', updateMobileOrientationCopy);
  window.addEventListener('orientationchange', updateMobileOrientationCopy);
  elements.notifyBellBtn.addEventListener('click', async () => {
    if (!state.authUser) return;
    if (state.notifyInstallationOnline) {
      await setNotificationPreference(false);
      return;
    }
    openNotificationPrompt();
  });
  elements.notificationConfirmBtn.addEventListener('click', async () => {
    await setNotificationPreference(true);
    closeNotificationPrompt();
  });
  elements.notificationCancelBtn.addEventListener('click', closeNotificationPrompt);
  elements.availabilityRetryBtn.addEventListener('click', restartInstallationStatusListener);
  elements.donationModal.addEventListener('click', (event) => {
    if (event.target === elements.donationModal) hideDonationPrompt();
  });
  elements.notificationModal.addEventListener('click', (event) => {
    if (event.target === elements.notificationModal) closeNotificationPrompt();
  });
  elements.webrtcSoundBtn.addEventListener('click', () => {
    if (!state.previewHasAudio || !state.previewFeedAvailable) return;
    state.webrtcSoundEnabled = !state.webrtcSoundEnabled;
    sessionStorage.setItem(WEBRTC_SOUND_PREF_KEY, state.webrtcSoundEnabled ? 'true' : 'false');
    applyWebRtcAudioPreference();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.donationModal.classList.contains('hidden')) hideDonationPrompt();
    else if (event.key === 'Escape' && state.participantSession) endSession(true, undefined, true);
  });
  window.addEventListener('pagehide', () => {
    state.participantSession?.stop({ notifyRelay: true });
    state.previewClient?.stop?.();
  });

  try {
    state.bootstrap = await api('/api/live/bootstrap');
    configurePublicLinks(state.bootstrap);
    console.info('[MIDImyFACE] Build diagnostic', {
      liveBuildCommit: LIVE_BUILD_COMMIT,
      liveProtocolVersion: LIVE_PROTOCOL_VERSION,
      relayBuildCommit: state.bootstrap?.builds?.relayCommit || 'unknown',
      relayProtocolVersion: state.bootstrap?.protocolVersion || 'unknown',
    });
  } catch {
    configurePublicLinks({});
  }
  try {
    await setupGoogleRegistration(await api('/api/live/config'));
  } catch {
    await setupGoogleRegistration({});
  }
  await refreshStatus();
  updateProgramFeedVisibility();
  updateWebRtcUi();
  window.setInterval(refreshStatus, STATUS_POLL_MS);
}

initialize();
