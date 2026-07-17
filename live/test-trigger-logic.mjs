import assert from 'node:assert/strict';
import { WINK_HOLD_MS, createGestureTriggerState, evaluateGestureTrigger, gestureRange } from './live_session.js';

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
