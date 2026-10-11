import test from 'node:test';
import assert from 'node:assert/strict';
import { imagePlacement, backgroundPlacement, intersect } from '../src/geometry.js';
import { normalizeSettings, enabledFor, validImageURL, siteKey } from '../src/settings.js';
import { FittedFace } from '../src/renderer.js';
import { readFile } from 'node:fs/promises';

test('object-fit maps the original photo into contain, cover, fill and scale-down boxes', () => {
  assert.deepEqual(imagePlacement(200, 100, 100, 100, 'contain'), { x: 50, y: 0, width: 100, height: 100 });
  assert.deepEqual(imagePlacement(200, 100, 100, 100, 'cover'), { x: 0, y: -50, width: 200, height: 200 });
  assert.deepEqual(imagePlacement(200, 100, 100, 100, 'cover', 'center top'), { x: 0, y: 0, width: 200, height: 200 });
  assert.deepEqual(imagePlacement(200, 100, 100, 100, 'fill'), { x: 0, y: 0, width: 200, height: 100 });
  assert.deepEqual(imagePlacement(200, 200, 100, 100, 'scale-down'), { x: 50, y: 50, width: 100, height: 100 });
  assert.deepEqual(imagePlacement(200, 100, 100, 100, 'none', 'right 10px bottom 5px'), { x: 90, y: -5, width: 100, height: 100 });
});

test('CSS backgrounds retain their aspect ratio and explicit sizes', () => {
  assert.deepEqual(backgroundPlacement(300, 200, 100, 100, 'cover', '50% 50%'), { x: 0, y: -50, width: 300, height: 300 });
  assert.deepEqual(backgroundPlacement(300, 200, 100, 100, '50% auto', 'left top'), { x: 0, y: 0, width: 150, height: 150 });
  assert.deepEqual(backgroundPlacement(300, 200, 100, 50, 'auto 100px', 'center'), { x: 50, y: 50, width: 200, height: 100 });
});

test('overflow clips never produce negative drawable dimensions', () => {
  assert.deepEqual(intersect({ left: 0, top: 0, right: 100, bottom: 100 }, { left: 20, top: 50, right: 80, bottom: 120 }), { left: 20, top: 50, right: 80, bottom: 100, width: 60, height: 50 });
  assert.equal(intersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 50, top: 50, right: 80, bottom: 80 }).width, 0);
});

test('settings are bounded and site pauses do not turn off other sites', () => {
  const s = normalizeSettings({ intensity: 5, maxActive: 999, minSize: -2, disabledSites: ['a.test', 'a.test', null] });
  assert.equal(s.intensity, 1); assert.equal(s.maxActive, 24); assert.equal(s.minSize, 40);
  assert.equal(enabledFor(s, 'a.test'), false); assert.equal(enabledFor(s, 'b.test'), true);
  assert.equal(siteKey('https://a.test/x?q=1'), 'a.test');
  for (const url of ['javascript:alert(1)', 'chrome://settings', 'https://', 'data:text/html;base64,abcd', 'blob:https://example.org/123']) assert.equal(validImageURL(url), false);
  for (const url of ['https://example.org/portrait.jpg', 'file:///tmp/face.png', 'data:image/png;base64,abcd']) assert.equal(validImageURL(url), true);
});

test('photo fitting preserves the neutral image and produces finite animated geometry', async () => {
  const points = JSON.parse(await readFile(new URL('./fixtures/amara.json', import.meta.url)));
  const face = new FittedFace(points, 1);
  const neutral = face.step(0, 0);
  for (let i = 0; i < neutral.length; i++) assert.ok(Math.abs(neutral[i] - face.uvs[i]) < 1e-6);
  let changed = false;
  for (let t = 0; t < 20; t += .05) {
    const positions = face.step(t, .8);
    assert.ok(positions.every(Number.isFinite));
    if (positions.some((p, i) => Math.abs(p - face.uvs[i]) > .002)) changed = true;
  }
  assert.ok(changed, 'The fitted face must actually move the image');
});
