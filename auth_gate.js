(function attachMidimyfaceAuthGate(globalScope) {
  'use strict';

  const FIREBASE_VERSION = '10.12.5';
  const USER_PROFILE_COLLECTION = 'users';
  let firebaseContextPromise = null;
  let currentUser = null;

  function hasValidFirebaseConfig(publicConfig) {
    const firebase = publicConfig?.firebase || {};
    return ['apiKey', 'authDomain', 'projectId', 'appId']
      .every((key) => typeof firebase[key] === 'string' && firebase[key].trim());
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
      const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(publicConfig.firebase);
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

  async function profileExists(context, user) {
    if (!context?.firestore || !user?.uid) return null;
    try {
      const snapshot = await context.firestoreSdk.getDoc(
        context.firestoreSdk.doc(context.firestore, USER_PROFILE_COLLECTION, user.uid),
      );
      return snapshot.exists();
    } catch {
      return null;
    }
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
        || parsed.pathname === '/live'
        || parsed.pathname.startsWith('/live/');
      return approved ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
    } catch {
      return fallback;
    }
  }

  globalScope.MMFAuthGate = Object.freeze({
    ensureUserProfile,
    getCurrentIdToken,
    getFirebaseContext,
    hasValidFirebaseConfig,
    observe,
    profileExists,
    signInWithGoogle,
    signOut,
    validateReturnDestination,
  });
})(window);
