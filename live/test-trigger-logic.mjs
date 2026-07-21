import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ParticipantSession, PEER_LANDMARK_DOT_RADIUS, WINK_HOLD_MS, cameraAccessMessage, compactTelemetryLandmarks, createGestureTriggerState, evaluateGestureTrigger, gestureRange, participantLandmarkDotRadius, resolveGridPad, GRID_TRIGGER_IDS } from './live_session.js';

const previewClientSource = await readFile(new URL('./broadcast/preview_client.js', import.meta.url), 'utf8');
assert.match(previewClientSource, /offerToReceiveAudio:\s*true/, 'participant WebRTC offers must request Pi audio');
assert.doesNotMatch(previewClientSource, /offerToReceiveAudio:\s*false/, 'participant WebRTC offers must not disable Pi audio');
assert.match(previewClientSource, /if \(!this\.stream\) this\.stream = new MediaStream\(\)/, 'streamless aiortc tracks must be collected into a playable MediaStream');
assert.match(previewClientSource, /this\.stream\.addTrack\(track\)/, 'each received audio/video track must be attached to the participant stream');
assert.match(previewClientSource, /this\._disconnectRemote\(this\.connectionId, this\.token\)/, 'reconnect must close its prior relay peer instead of leaking stale sessions');
assert.match(previewClientSource, /_scheduleDisconnectedReconnect\(\)/, 'transient WebRTC disconnects must receive a grace period before teardown');
assert.match(previewClientSource, /const localOffer = this\.pc\.localDescription \|\| offer/, 'the signaled offer must include the current gathered local description');
const livePageSource = await readFile(new URL('./live.js', import.meta.url), 'utf8');
assert.match(livePageSource, /cameraFeedEnabled:\s*false/, 'Pi camera feed must default off in the participant client');
assert.match(livePageSource, /if \(!state\.cameraFeedEnabled\) return null;/, 'disabled media must not create a WebRTC client');
assert.match(livePageSource, /reconcileMediaState\(state\.status\)/, 'relay media state must control WebRTC independently');
assert.match(livePageSource, /Live protocol mismatch/, 'build/protocol mismatches must have a clear diagnostic');
assert.doesNotMatch(livePageSource, /await ensurePreviewClient\(\);\s*updateProgramFeedVisibility\(\);\s*updateWebRtcUi\(\);\s*await refreshStatus\(\)/, 'WebRTC must not start before camera-feed status is known');
assert.match(livePageSource, /preview_client\.js\?v=\d{8}-media-\d+/, 'live page must cache-bust the WebRTC preview client');
assert.match(livePageSource, /state\.previewFeedAvailable = state\.previewHasVideo;/, 'the program background must follow the live video track state');
assert.match(livePageSource, /onMediaState\([\s\S]*?updateProgramFeedVisibility\(\);/, 'track state changes must immediately refresh program-feed visibility');
assert.match(livePageSource, /live_session\.js\?v=\d{8}-media-\d+/, 'live page must cache-bust participant gesture transport');
assert.match(livePageSource, /shouldPlayJoinAudio = shouldPlayAudio && !state\.session/, 'the visible join preview must own the join-stage sound preference');
assert.match(livePageSource, /registeredUserProfileExists\(user\)/, 'returning sign-in must verify the existing Firestore registration profile');
assert.match(livePageSource, /googleSignInBtn\.disabled = user \? true : !state\.authReady;/, 'returning sign-in must not depend on incognito local terms storage');
assert.match(livePageSource, /googleSignInBtn\.addEventListener\('click', signInWithGoogle\)/, 'the sign-in action must use its returning-account path');
assert.match(livePageSource, /showMobileOrientationGuidance\(\)/, 'mobile participants must receive landscape guidance before session entry');
assert.match(livePageSource, /phase === 'searching-face'[\s\S]*?scheduleFaceSearch\(\)/, 'lost face tracking must show guidance after a grace period');
assert.match(livePageSource, /phase === 'face-found'[\s\S]*?hideFaceSearch\(\)/, 'face guidance must close as soon as landmarks return');
const participantSource = await readFile(new URL('./live_session.js', import.meta.url), 'utf8');
assert.match(participantSource, /new WebSocket\(socketUrl\.toString\(\)\)/, 'participant telemetry must use a persistent WebSocket');
assert.match(participantSource, /type: 'live\/participant-auth'/, 'participant WebSocket must authenticate its live session');
assert.match(participantSource, /this\._gestureSocket\.send\(JSON\.stringify\(\{ type: 'live\/gesture'/, 'landmarks and triggers must use the live socket once ready');
assert.match(participantSource, /_handleSessionExpired\(\)\s*\{[\s\S]*?this\._stopLocal\(\)/, 'session expiry must use the same local cleanup as an explicit stop');
const liveHtmlSource = await readFile(new URL('./index.html', import.meta.url), 'utf8');
assert.match(liveHtmlSource, /id="webrtcConnectionLabel" class="hidden"/, 'disabled media must not show a reconnect status placeholder');
assert.match(liveHtmlSource, /id="webrtcSoundBtn" class="hidden"/, 'disabled media must not show sound controls');
assert.match(liveHtmlSource, /body:not\(\.session-active\) #videoContainer\s*\{[\s\S]*?min-height:0;[\s\S]*?overflow:visible;[\s\S]*?border:0;/, 'the pre-session join form must not be trapped inside the outer stage box');
assert.match(liveHtmlSource, /body:not\(\.session-active\) \.session-intro\s*\{[\s\S]*?position:relative;[\s\S]*?overflow:visible;/, 'the join form must use natural page flow instead of an inner scroll viewport');
assert.match(liveHtmlSource, /id="miniProgramPreview"[\s\S]*?id="miniPreviewVideo"[\s\S]*?id="webrtcSoundBtn"/, 'join sound control must sit directly under the program video preview');
assert.match(liveHtmlSource, /id="faceLoadingOverlay"[\s\S]*?Looking for your face/, 'the live stage must reuse the face-search guidance overlay');
assert.match(liveHtmlSource, /id="mobileOrientationModal"[\s\S]*?TURN YOUR PHONE/, 'mobile session entry must include landscape guidance');

assert.equal(GRID_TRIGGER_IDS.length, 8, 'the live grid exposes eight playable pads');
assert.equal(new Set(GRID_TRIGGER_IDS).size, 8, 'the live grid trigger mapping must be eight unique IDs');
assert.ok(GRID_TRIGGER_IDS.includes('grid8'), 'the live grid includes the dedicated eighth trigger id');
const syntheticLandmarks = Array.from({ length: 478 }, (_, index) => ({ x: index / 477, y: 1 - index / 477 }));
const compact = compactTelemetryLandmarks(syntheticLandmarks);
assert.equal(compact.length, syntheticLandmarks.length, 'telemetry carries all 478 face points to the Pi');
assert.ok(compact.every((point) => Array.isArray(point) && point.length === 2), 'telemetry uses compact coordinate arrays');
assert.equal(PEER_LANDMARK_DOT_RADIUS, 2.3, 'peer landmarks gain exactly one CSS pixel of radius');
assert.equal(participantLandmarkDotRadius(100, 100), 2.25, 'small-screen landmarks gain exactly one CSS pixel of radius');
assert.equal(participantLandmarkDotRadius(1000, 1000), 2.7, 'large-screen landmarks gain exactly one CSS pixel of radius');

const canvasContext = {
  save() {},
  setTransform() {},
  clearRect() {},
  restore() {},
};
const expiryPhases = [];
const expirySession = new ParticipantSession({
  relayOrigin: 'https://example.invalid',
  token: 'test-token',
  session: {},
  onStatus: ({ phase }) => expiryPhases.push(phase),
});
expirySession.running = true;
expirySession._ctx = canvasContext;
expirySession._canvas = {
  width: 640,
  height: 480,
  getBoundingClientRect: () => ({ width: 640, height: 480 }),
};
expirySession._video = { srcObject: {} };
expirySession._latestLandmarks = [{ x: 0.5, y: 0.5 }];
expirySession._handleSessionExpired();
assert.equal(expirySession.running, false, 'expired sessions stop all rendering');
assert.equal(expirySession._canvas.width, 1, 'expiry resets the canvas backing bitmap');
assert.equal(expirySession._canvas.height, 1, 'expiry resets the canvas backing bitmap height');
assert.equal(expirySession._latestLandmarks, null, 'expiry removes the final landmark frame');
assert.equal(expirySession._video.srcObject, null, 'expiry detaches the participant camera stream');
assert.deepEqual(expiryPhases, ['expired'], 'expiry reports completion after local cleanup');
assert.equal(
  cameraAccessMessage({ name: 'NotAllowedError' }),
  'Camera access is blocked. Allow camera access in your browser settings, then press START again.',
  'camera permission denial must explain how to recover',
);
const facePhases = [];
const faceSession = new ParticipantSession({
  relayOrigin: 'https://example.invalid',
  token: 'test-token',
  session: {},
  onStatus: ({ phase }) => facePhases.push(phase),
});
faceSession.running = true;
faceSession._video = { videoWidth: 640, videoHeight: 480 };
faceSession._lastGestures = { mouthOpen: 50 };
faceSession._lastLandmarks = [{ x: 0.5, y: 0.5 }];
faceSession._onFaceResults({ multiFaceLandmarks: [] });
assert.equal(faceSession._lastGestures, null, 'lost face tracking must stop posting stale gesture values');
assert.equal(faceSession._lastLandmarks, null, 'lost face tracking must stop posting stale landmark frames');
faceSession._onFaceResults({ multiFaceLandmarks: [] });
faceSession._onFaceResults({ multiFaceLandmarks: [Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))] });
assert.deepEqual(facePhases, ['searching-face', 'face-found'], 'face presence changes must emit once without per-frame UI flicker');
assert.equal(resolveGridPad({ x: 0.99, y: 0.01 }), 0, 'mirrored top-left nose position selects pad 1');
assert.equal(resolveGridPad({ x: 0.01, y: 0.01 }), 3, 'mirrored top-right nose position selects pad 4');
assert.equal(resolveGridPad({ x: 0.99, y: 0.99 }), 4, 'mirrored bottom-left nose position selects pad 5');
assert.equal(resolveGridPad({ x: 0.01, y: 0.99 }), 7, 'mirrored bottom-right nose position selects pad 8');

function feed(gestureId, samples, range) {
  const state = createGestureTriggerState();
  return samples.map(({ value, now }) => evaluateGestureTrigger(gestureId, value, state, { ...range, now }));
}

assert.deepEqual(
  feed('mouthOpen', [
    { value: 0, now: 1_000 },
    { value: 0.2, now: 1_100 },
    { value: 0.4, now: 1_200 },
    { value: 0.6, now: 1_300 },
  ], gestureRange('mouthOpen', 640, 480)),
  [false, false, false, false],
  'slow distance changes must not trigger percussion',
);

assert.deepEqual(
  feed('mouthOpen', [
    { value: 0, now: 2_000 },
    { value: 12, now: 2_016 },
    { value: 13, now: 2_050 },
    { value: 0, now: 2_300 },
    { value: 12, now: 2_316 },
  ], gestureRange('mouthOpen', 640, 480)),
  [false, true, false, false, true],
  'a sudden movement should trigger once, rearm at rest, then trigger again',
);

assert.deepEqual(
  feed('leftWink', [
    { value: 20, now: 3_000 },
    { value: 8, now: 3_016 },
    { value: 20, now: 3_120 },
  ], gestureRange('leftWink', 640, 480)),
  [false, false, false],
  'a regular short blink must not trigger',
);

assert.deepEqual(
  feed('leftWink', [
    { value: 20, now: 4_000 },
    { value: 8, now: 4_016 },
    { value: 8, now: 4_016 + WINK_HOLD_MS - 1 },
    { value: 8, now: 4_016 + WINK_HOLD_MS },
    { value: 8, now: 4_400 },
    { value: 20, now: 4_500 },
    { value: 8, now: 4_516 },
    { value: 8, now: 4_516 + WINK_HOLD_MS },
  ], gestureRange('leftWink', 640, 480)),
  [false, false, false, true, false, false, false, true],
  'a wink must stay closed for 250 ms and can fire only once per closure',
);

console.log('live percussion trigger logic passed');
