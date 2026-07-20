import assert from 'node:assert/strict';
import { WINK_HOLD_MS, compactTelemetryLandmarks, createGestureTriggerState, evaluateGestureTrigger, gestureRange, resolveGridPad, GRID_TRIGGER_IDS } from './live_session.js';

assert.equal(GRID_TRIGGER_IDS.length, 8, 'the live grid exposes eight playable pads');
assert.equal(new Set(GRID_TRIGGER_IDS).size, 8, 'the live grid trigger mapping must be eight unique IDs');
assert.ok(GRID_TRIGGER_IDS.includes('grid8'), 'the live grid includes the dedicated eighth trigger id');
const syntheticLandmarks = Array.from({ length: 478 }, (_, index) => ({ x: index / 477, y: 1 - index / 477 }));
const compact = compactTelemetryLandmarks(syntheticLandmarks);
assert.ok(compact.length >= 100 && compact.length < syntheticLandmarks.length, 'telemetry keeps key face features without all 478 points');
assert.ok(compact.every((point) => Array.isArray(point) && point.length === 2), 'telemetry uses compact coordinate arrays');
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
