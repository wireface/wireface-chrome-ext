import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EyeGaze, gazeTarget, eyeBasis } from '../src/gaze.js';
import { randomMoodFor, RANDOM_MOODS } from '../src/moods.js';
import { normalizeSettings } from '../src/settings.js';
import { FittedFace } from '../src/renderer.js';
import { GESTURES } from '../src/idle.js';

test('gaze follows the cursor in viewport coordinates, eases and returns to rest', () => {
  const box = { x: 200, y: 150, width: 120, height: 160 };
  assert.deepEqual(gazeTarget({ x: 200, y: 150 }, box), [0, 0]);
  assert.deepEqual(gazeTarget({ x: 2000, y: -1000 }, box), [1, -1]);
  const gaze = new EyeGaze();
  gaze.sample(.03, [1, -1]); assert.ok(gaze.value[0] > 0 && gaze.value[0] < .5);
  for (let t = .06; t < 1; t += .03) gaze.sample(t, [1, -1]);
  assert.ok(gaze.value[0] > .99 && gaze.value[1] < -.99);
  for (let t = 1; t < 2; t += .03) gaze.sample(t, null);
  assert.ok(Math.abs(gaze.value[0]) < .001);
  assert.deepEqual(gaze.sample(2, [1, 1], 0), [0, 0]);
});

test('random moods are stable per face and shuffle across seeds', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const id = `photo-${i}#face-${i % 8}`;
    assert.equal(randomMoodFor(id, 42), randomMoodFor(id, 42));
    seen.add(randomMoodFor(id, 42));
  }
  assert.deepEqual(seen, new Set(RANDOM_MOODS));
  assert.ok(new Set(Array.from({ length: 20 }, (_, seed) => randomMoodFor('photo#face-0', seed))).size > 3);
  const settings = normalizeSettings({ mood: 'unknown', eyeTracking: false, hoverExpressions: false });
  assert.equal(settings.mood, 'random'); assert.equal(settings.eyeTracking, false); assert.equal(settings.hoverExpressions, false);
});

test('non-blink expressions visibly move the fitted photograph at default strength', async () => {
  const points = JSON.parse(await readFile(new URL('./fixtures/amara.json', import.meta.url)));
  const result = {};
  for (const name of ['smile', 'smirk-left', 'smirk-right', 'brow-raise', 'pout', 'nose-twitch']) {
    const face = new FittedFace(points, 1); face.idle.nextBlink = face.idle.nextGesture = Infinity;
    face.idle.gesture = { spec: GESTURES.find(g => g.name === name), start: 0, duration: 1, strength: .95 };
    const positions = face.step(.4, .65);
    const ids = name === 'brow-raise' ? [70, 63, 105, 66, 107, 336, 296, 334, 293, 300]
      : name === 'nose-twitch' ? [1, 4, 129, 358] : [61, 291, 13, 14, 17, 0];
    result[name] = Math.max(...ids.map(i => Math.hypot(positions[2 * i] - face.uvs[2 * i], positions[2 * i + 1] - face.uvs[2 * i + 1]) * 260));
    assert.ok(result[name] > (name === 'nose-twitch' ? 1 : 2.5), `${name} was only ${result[name]} px`);
  }
  console.log('Default expression displacement (260px fixture):', result);
  const extended = [...points, ...Array.from({ length: 10 }, () => [.5, .4])];
  const face = new FittedFace(extended, 1); assert.equal(face.uvs.length, 936);
  assert.ok(face.step(0, 0).every(Number.isFinite));
  const eye = eyeBasis(points, 'R', 1);
  assert.ok(eye.axisX[0] * eye.axisY[1] - eye.axisX[1] * eye.axisY[0] > 0);
});
