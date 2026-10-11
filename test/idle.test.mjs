import test from 'node:test';
import assert from 'node:assert/strict';
import { IdleMotion, GESTURES, envelope } from '../src/idle.js';
import { C } from '../vendor/wireface/core/rig.js';

function random(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

test('random idle motion reaches every requested expression, blinks, and never talks', () => {
  const idle = new IdleMotion(random(847)), seen = new Set();
  let blinks = 0, twitches = 0;
  for (let time = 0; time < 900; time += 1 / 30) {
    const sample = idle.sample(time);
    if (idle.gesture) seen.add(idle.gesture.spec.name);
    if (sample.weights[C.blinkL] > .9) blinks++;
    if (Math.abs(sample.twitch) > .1) twitches++;
    assert.equal(sample.jaw, 0);
    for (const name of ['wide', 'round', 'upperUp', 'lowerDown', 'bite']) assert.equal(sample.weights[C[name]], 0);
    assert.ok(sample.weights.every(value => Number.isFinite(value) && value >= 0 && value <= 1.15001));
  }
  assert.deepEqual(seen, new Set(GESTURES.map(g => g.name)));
  assert.ok(blinks > 50); assert.ok(twitches > 10);
});

test('faces have independent timing; zero motion is completely still', () => {
  const one = new IdleMotion(random(13)), two = new IdleMotion(random(26));
  assert.notEqual(one.nextBlink, two.nextBlink);
  for (let time = 0; time < 30; time += .1) assert.ok(one.sample(time, 0).weights.every(value => value === 0));
});

test('expressions ease in and return exactly to the source pose', () => {
  assert.equal(envelope(0), 0); assert.equal(envelope(1), 0); assert.equal(envelope(2), 0);
  assert.equal(envelope(.4), 1); assert.ok(envelope(.01) < .01); assert.ok(envelope(.99) < .01);
});

test('all micro expressions appear in the first 50 seconds without waiting for chance', () => {
  for (let seed = 1; seed < 30; seed++) {
    const idle = new IdleMotion(random(seed)), seen = new Set();
    for (let t = 0; t < 50; t += 1 / 30) {
      idle.sample(t);
      if (idle.gesture) seen.add(idle.gesture.spec.name);
    }
    assert.deepEqual(seen, new Set(GESTURES.map(g => g.name)));
    assert.ok(idle.gestureCount >= GESTURES.length);
  }
});

test('hover reactions are immediate, debounced, and do not break the idle sequence', () => {
  const idle = new IdleMotion(random(37));
  assert.equal(idle.react(.1), true);
  assert.equal(idle.gesture.start, .1); assert.equal(idle.gesture.source, 'hover');
  const name = idle.gesture.spec.name;
  for (let t = .2; t < 2; t += .1) assert.equal(idle.react(t), false);
  assert.equal(idle.react(3), true); assert.notEqual(idle.gesture.spec.name, name);
  assert.equal(idle.hoverCount, 2);
  idle.sample(idle.nextGesture + .1);
  assert.equal(idle.gesture.source, 'idle');
});

test('selected moods persist between expressions and change smoothly', () => {
  const idle = new IdleMotion(random(1)); idle.nextBlink = idle.nextGesture = Infinity;
  for (let t = 0; t < 2; t += .03) idle.sample(t, .65, 'happy');
  const happy = idle.weights[C.smileL]; assert.ok(happy > .4);
  const transition = idle.sample(2, .65, 'grumpy'); assert.ok(transition.weights[C.smileL] > .3);
  for (let t = 2.03; t < 4; t += .03) idle.sample(t, .65, 'grumpy');
  assert.ok(idle.weights[C.smileL] < .01); assert.ok(idle.weights[C.browDown] > .4);
  assert.ok(idle.sample(4, 0, 'happy').weights.every(x => x === 0));
});
