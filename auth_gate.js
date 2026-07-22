(function attachMidimyfaceAuthGate(globalScope) {
  'use strict';

  const FIREBASE_VERSION = '10.12.5';
  const FIREBASE_AUTH_DOMAIN = 'auth.midimyface.com';
  const USER_PROFILE_COLLECTION = 'users';
  const ANONYMOUS_TRIAL_DURATION_MS = 60_000;
  const ANONYMOUS_TRIAL_STORAGE_KEY = 'mmf_homepage_anonymous_trial_v1';
  let firebaseContextPromise = null;
  let currentUser = null;

  function hasValidFirebaseConfig(publicConfig) {
    const firebase = publicConfig?.firebase || {};
    return ['apiKey', 'authDomain', 'projectId', 'appId']
      .every((key) => typeof firebase[key] === 'string' && firebase[key].trim());
  }

  function getFirebaseConfigForInitialization(publicConfig) {
    return { ...(publicConfig?.firebase || {}), authDomain: FIREBASE_AUTH_DOMAIN };
  }

  async function getFirebaseContext(publicConfig) {
    if (!hasValidFirebaseConfig(publicConfig)) throw new Error('auth_config_incomplete');
    if (firebaseContextPromise) return firebaseContextPromise;

    firebaseContextPromise = (async () => {
      const [appSdk, authSdk, firestoreSdk] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
      ]);
      const firebaseConfig = getFirebaseConfigForInitialization(publicConfig);
      const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
      const auth = authSdk.getAuth(app);
      await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
      const context = { app, auth, authSdk, firestore: firestoreSdk.getFirestore(app), firestoreSdk };
      authSdk.onAuthStateChanged(auth, (user) => { currentUser = user || null; });
      return context;
    })();

    try {
      return await firebaseContextPromise;
    } catch (error) {
      firebaseContextPromise = null;
      throw error;
    }
  }

  function observe(context, callback) {
    return context.authSdk.onAuthStateChanged(context.auth, (user) => {
      currentUser = user || null;
      callback(currentUser);
    });
  }

  async function readUserProfile(context, user) {
    if (!context?.firestore || !user?.uid) return null;
    try {
      const snapshot = await context.firestoreSdk.getDoc(
        context.firestoreSdk.doc(context.firestore, USER_PROFILE_COLLECTION, user.uid),
      );
      return {
        exists: snapshot.exists(),
        data: snapshot.exists() ? (snapshot.data() || {}) : null,
      };
    } catch {
      return null;
    }
  }

  async function profileExists(context, user) {
    const profile = await readUserProfile(context, user);
    return profile ? profile.exists : null;
  }

  function getAccessLevel(profile) {
    const trustedValue = String(profile?.accessLevel || profile?.entitlement?.accessLevel || '').trim().toLowerCase();
    return trustedValue === 'premium' ? 'premium' : 'regular';
  }

  function createAnonymousTrialController(options = {}) {
    const durationMs = Number(options.durationMs) > 0 ? Number(options.durationMs) : ANONYMOUS_TRIAL_DURATION_MS;
    const storage = options.storage || globalScope.sessionStorage;
    const documentLike = options.documentLike || globalScope.document;
    const windowLike = options.windowLike || globalScope;
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const setTimer = options.setTimeoutFn || globalScope.setTimeout?.bind(globalScope);
    const clearTimer = options.clearTimeoutFn || globalScope.clearTimeout?.bind(globalScope);
    const onExpire = typeof options.onExpire === 'function' ? options.onExpire : () => {};
    const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};

    let stored = {};
    try { stored = JSON.parse(storage?.getItem?.(ANONYMOUS_TRIAL_STORAGE_KEY) || '{}') || {}; } catch {}
    let elapsedMs = Math.max(0, Math.min(durationMs, Number(stored.elapsedMs) || 0));
    let expired = stored.expired === true || elapsedMs >= durationMs;
    let interactive = false;
    let authenticated = false;
    let authenticationInProgress = false;
    let frozen = false;
    let activeStartedAt = null;
    let timerId = null;
    let destroyed = false;

    function persist() {
      try {
        storage?.setItem?.(ANONYMOUS_TRIAL_STORAGE_KEY, JSON.stringify({ elapsedMs, expired }));
      } catch {}
    }

    function clearActiveTimer() {
      if (timerId !== null) clearTimer?.(timerId);
      timerId = null;
    }

    function commitActiveTime() {
      if (activeStartedAt === null) return;
      elapsedMs = Math.min(durationMs, elapsedMs + Math.max(0, now() - activeStartedAt));
      activeStartedAt = null;
      persist();
    }

    function snapshot() {
      const activeDelta = activeStartedAt === null ? 0 : Math.max(0, now() - activeStartedAt);
      const currentElapsed = Math.min(durationMs, elapsedMs + activeDelta);
      return Object.freeze({
        durationMs,
        elapsedMs: currentElapsed,
        remainingMs: Math.max(0, durationMs - currentElapsed),
        expired,
        interactive,
        authenticated,
        active: activeStartedAt !== null,
      });
    }

    function expire() {
      if (destroyed || expired || authenticated) return;
      commitActiveTime();
      elapsedMs = durationMs;
      expired = true;
      clearActiveTimer();
      persist();
      onExpire(snapshot());
      onStateChange(snapshot());
    }

    function shouldCountTime() {
      return interactive
        && !authenticated
        && !authenticationInProgress
        && !frozen
        && !expired
        && documentLike?.visibilityState !== 'hidden';
    }

    function synchronize() {
      if (destroyed) return;
      clearActiveTimer();
      if (!shouldCountTime()) {
        commitActiveTime();
        onStateChange(snapshot());
        return;
      }
      commitActiveTime();
      if (activeStartedAt === null) activeStartedAt = now();
      const remainingMs = Math.max(0, durationMs - elapsedMs);
      if (remainingMs <= 0) {
        expire();
        return;
      }
      timerId = setTimer?.(expire, remainingMs) ?? null;
      onStateChange(snapshot());
    }

    function start() {
      interactive = true;
      if (expired && !authenticated) onExpire(snapshot());
      synchronize();
      return snapshot();
    }

    function setAuthenticated(user) {
      commitActiveTime();
      authenticated = Boolean(user);
      authenticationInProgress = false;
      synchronize();
      return snapshot();
    }

    function setAuthenticationInProgress(inProgress) {
      commitActiveTime();
      authenticationInProgress = Boolean(inProgress);
      synchronize();
      return snapshot();
    }

    function handlePageHide() {
      frozen = true;
      synchronize();
    }

    function handlePageShow() {
      frozen = false;
      synchronize();
    }

    documentLike?.addEventListener?.('visibilitychange', synchronize);
    documentLike?.addEventListener?.('freeze', handlePageHide);
    documentLike?.addEventListener?.('resume', handlePageShow);
    windowLike?.addEventListener?.('pagehide', handlePageHide);
    windowLike?.addEventListener?.('pageshow', handlePageShow);

    return Object.freeze({
      start,
      setAuthenticated,
      setAuthenticationInProgress,
      getState: snapshot,
      destroy() {
        commitActiveTime();
        clearActiveTimer();
        destroyed = true;
        documentLike?.removeEventListener?.('visibilitychange', synchronize);
        documentLike?.removeEventListener?.('freeze', handlePageHide);
        documentLike?.removeEventListener?.('resume', handlePageShow);
        windowLike?.removeEventListener?.('pagehide', handlePageHide);
        windowLike?.removeEventListener?.('pageshow', handlePageShow);
      },
    });
  }

  async function ensureUserProfile(context, user) {
    if (!context?.firestore || !user?.uid) return;
    const { doc, getDoc, serverTimestamp, setDoc } = context.firestoreSdk;
    const reference = doc(context.firestore, USER_PROFILE_COLLECTION, user.uid);
    const snapshot = await getDoc(reference).catch(() => null);
    const payload = { email: user.email || '', displayName: user.displayName || null };
    if (!snapshot?.exists?.() || typeof snapshot.data()?.notifyInstallationOnline !== 'boolean') {
      payload.notifyInstallationOnline = false;
      payload.notificationPreferenceUpdatedAt = serverTimestamp();
    }
    await setDoc(reference, payload, { merge: true });
  }

  async function signInWithGoogle(context) {
    const provider = new context.authSdk.GoogleAuthProvider();
    return context.authSdk.signInWithPopup(context.auth, provider);
  }

  async function signOut(context) {
    currentUser = null;
    return context.authSdk.signOut(context.auth);
  }

  async function getCurrentIdToken(forceRefresh = false) {
    const user = currentUser;
    return user?.getIdToken ? user.getIdToken(forceRefresh) : null;
  }

  function validateReturnDestination(candidate, locationLike = globalScope.location) {
    const origin = String(locationLike?.origin || 'https://midimyface.com');
    const fallback = `${locationLike?.pathname || '/'}${locationLike?.search || ''}${locationLike?.hash || ''}`;
    if (!candidate) return fallback;
    try {
      const parsed = new URL(String(candidate), origin);
      if (parsed.origin !== origin) return fallback;
      const approved = parsed.pathname === '/'
        || parsed.pathname === '/index.html'
        || parsed.pathname === '/console'
        || parsed.pathname.startsWith('/console/')
        || parsed.pathname === '/live'
        || parsed.pathname.startsWith('/live/');
      return approved ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
    } catch {
      return fallback;
    }
  }

  globalScope.MMFAuthGate = Object.freeze({
    ANONYMOUS_TRIAL_DURATION_MS,
    FIREBASE_AUTH_DOMAIN,
    createAnonymousTrialController,
    ensureUserProfile,
    getAccessLevel,
    getCurrentIdToken,
    getFirebaseConfigForInitialization,
    getFirebaseContext,
    hasValidFirebaseConfig,
    observe,
    profileExists,
    readUserProfile,
    signInWithGoogle,
    signOut,
    validateReturnDestination,
  });
})(window);
