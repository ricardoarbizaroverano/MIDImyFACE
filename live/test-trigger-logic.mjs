import assert from 'node:assert/strict';
import { createGestureTriggerState, evaluateGestureTrigger, gestureRange } from './live_session.js';

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

assert.equal(
  feed('leftWink', [
    { value: 20, now: 3_000 },
    { value: 8, now: 3_016 },
  ], gestureRange('leftWink', 640, 480))[1],
  true,
  'a sudden wink closure should trigger',
);

console.log('live percussion trigger logic passed');
