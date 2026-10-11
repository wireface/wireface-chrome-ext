import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const { build } = require('esbuild');
await build({ entryPoints: [path.join(root, 'test/expressions.js')], outfile: path.join(artifacts, 'expressions.js'), bundle: true, format: 'esm', target: 'chrome116' });
let executablePath = process.env.WIREFACE_CHROMIUM || chromium.executablePath();
try { await access(executablePath); } catch {
  const cache = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  const dirs = (await readdir(cache)).filter(x => /^chromium-\d+$/.test(x)).sort((a, b) => parseInt(b.split('-')[1]) - parseInt(a.split('-')[1]));
  for (const dir of dirs) {
    const candidate = path.join(cache, dir, 'chrome-win64', 'chrome.exe');
    try { await access(candidate); executablePath = candidate; break; } catch {}
  }
}
let port;
const requests = [];
const html = () => `<!doctype html><html><head><meta charset="utf-8"><title>Wireface browser checks</title><style>
body{margin:32px;background:#121b17;color:#e6f5e9;font:16px system-ui}h1{font-size:28px;margin-bottom:6px}p{color:#9eafa2}.grid{display:flex;gap:24px;align-items:start}figure{margin:12px 0}img{display:block;width:260px;height:290px;object-fit:cover;border-radius:16px}figcaption{margin-top:10px}.blank{background:#243b30}.spacer{height:1000px}#dynamic{display:flex;gap:20px}#dynamic img{width:360px;height:230px;object-fit:contain}#blocker{display:none;position:fixed;inset:0;background:#26382b;z-index:999999}
</style></head><body><h1>Images, alive.</h1><p>Wireface extension verification · local face detection · silent idle motion</p><div class="grid">
<figure><a id="link" href="#clicked"><img id="same" src="/amara.jpg"></a><figcaption>Same origin / cover crop</figcaption></figure>
<figure><img id="cross" src="http://localhost:${port}/arjun.jpg" style="object-fit:contain;object-position:center top"><figcaption>Cross origin / contain</figcaption></figure>
<figure><img id="empty" class="blank" alt="No face"><figcaption>Non-face stays untouched</figcaption></figure></div><div id="dynamic"></div><div class="spacer"></div><img id="lazy" loading="lazy" src="/sarah.jpg"><div id="blocker">A modal must cover the faces</div></body></html>`;
const server = createServer(async (req, res) => {
  requests.push(req.url);
  if (req.url === '/fixture') {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' http://localhost:* data: blob:; connect-src 'none'");
    res.end(html()); return;
  }
  if (req.url === '/expressions') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><meta charset="utf-8"><title>Wireface expression check</title><style>body{background:#121b17;color:#ddd;font:16px system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(3,280px);gap:20px}figure{margin:0}figcaption{padding-top:6px;color:#aad4b5}canvas{display:block;border-radius:12px}</style><h1>Wireface · silent expressions</h1><main></main><script type="module" src="/expressions.js"></script></html>'); return;
  }
  if (req.url === '/expressions.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(path.join(artifacts, 'expressions.js'))); return; }
  if (req.url === '/amara.json') { res.setHeader('Content-Type', 'application/json'); res.end(await readFile(path.join(root, 'test/fixtures/amara.json'))); return; }
  if (/^\/(amara|arjun|sarah)\.jpg$/.test(req.url)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.end(await readFile(path.join(root, 'test/fixtures', req.url.slice(1)))); return;
  }
  res.statusCode = 404; res.end();
});
await new Promise(resolve => server.listen(0, resolve)); port = server.address().port;
let context;
const errors = [], network = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  context = await chromium.launchPersistentContext('', {
    executablePath, channel: 'chromium', headless: true, viewport: { width: 1080, height: 840 },
    args: [`--disable-extensions-except=${path.join(root, 'dist')}`, `--load-extension=${path.join(root, 'dist')}`, '--enable-unsafe-swiftshader'],
  });
  context.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
  context.on('request', req => network.push(req.url()));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
  worker.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  const extensionId = new URL(worker.url()).host;
  const page = context.pages()[0] || await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/fixture`);
  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 200;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#345442'; ctx.fillRect(0, 0, 200, 200);
    document.querySelector('#empty').src = c.toDataURL();
  });
  async function status() {
    return worker.evaluate(async url => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url?.startsWith(url));
      return chrome.tabs.sendMessage(tab.id, { target: 'wireface-content', type: 'status' }, { frameId: 0 });
    }, `http://127.0.0.1:${port}/fixture`);
  }
  async function until(check, description, timeout = 60000) {
    const start = Date.now(); let current;
    while (Date.now() - start < timeout) {
      try { current = await status(); if (check(current)) { const { faceStates, ...summary } = current; console.log(`PASS ${description}`, JSON.stringify(summary)); return current; } } catch {}
      await delay(250);
    }
    throw new Error(`${description}: ${JSON.stringify(current)}\n${errors.join('\n')}`);
  }
  const first = await until(s => s.scanned >= 3 && s.detected >= 2 && s.active >= 2, 'real local detection, including cross-origin image');
  assert.equal(first.skipped, 0);
  assert.equal(requests.filter(x => x === '/arjun.jpg').length, 2, 'Cross-origin pixels are fetched by the extension once');
  const rectBefore = await page.locator('#same').boundingBox();
  await page.screenshot({ path: path.join(artifacts, 'gallery.png') });
  const before = await page.locator('#same').screenshot();
  let moved = false;
  for (let i = 0; i < 30; i++) {
    await delay(200);
    const after = await page.locator('#same').screenshot();
    if (!before.equals(after)) { moved = true; break; }
  }
  assert.ok(moved, 'Pixels change during idle animation'); console.log('PASS visible animation changes pixels');
  await page.locator('#link').click(); assert.equal(new URL(page.url()).hash, '#clicked');
  assert.deepEqual(await page.locator('#same').boundingBox(), rectBefore); console.log('PASS layout and image links preserved');
  // Pause should restore the original photo without changing the DOM image.
  const set = patch => worker.evaluate(async patch => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, ...patch } });
  }, patch);
  await page.mouse.move(1040, 600);
  await until(s => s.faceStates.every(f => f.gaze[0] > .7 && f.gaze[1] > .7), 'eyes track cursor to the right and down');
  await page.mouse.move(5, 5);
  await until(s => s.faceStates.every(f => f.gaze[0] < -.55 && f.gaze[1] < -.7), 'eyes track cursor to the left and up');
  await set({ eyeTracking: false });
  await until(s => s.faceStates.every(f => Math.abs(f.gaze[0]) < .02 && Math.abs(f.gaze[1]) < .02), 'eye tracking toggle returns eyes to rest');
  const hoverBefore = (await status()).faceStates[0].hovers;
  await page.mouse.move(rectBefore.x + rectBefore.width / 2, rectBefore.y + rectBefore.height / 2);
  await until(s => s.faceStates[0].hovers === hoverBefore + 1 && !!s.faceStates[0].expression, 'hover immediately triggers a random expression');
  for (let i = 0; i < 5; i++) await page.mouse.move(rectBefore.x + rectBefore.width / 2 + i, rectBefore.y + rectBefore.height / 2);
  assert.equal((await status()).faceStates[0].hovers, hoverBefore + 1, 'Moving within a face must not restart its reaction');
  await set({ hoverExpressions: false, mood: 'grumpy' });
  const selected = await until(s => s.faceStates.every(f => f.mood === 'grumpy'), 'chosen mood applies to existing faces');
  await page.mouse.move(5, 5); await delay(2300); await page.mouse.move(rectBefore.x + rectBefore.width / 2, rectBefore.y + rectBefore.height / 2);
  assert.equal((await status()).faceStates[0].hovers, hoverBefore + 1, 'Hover toggle disables new reactions');
  await set({ mood: 'random', moodSeed: 100 });
  const random = await until(s => s.faceStates.every(f => f.mood !== 'neutral') && s.faceStates.some(f => f.mood !== 'grumpy'), 'random per-face moods');
  await set({ moodSeed: 101 });
  await until(s => s.faceStates.some((f, i) => f.mood !== random.faceStates[i].mood), 'shuffle moods updates faces without rescanning');
  assert.equal((await status()).scanned, selected.scanned);
  await set({ intensity: 0 });
  await delay(150);
  const still = await page.locator('#same').screenshot(); await delay(350);
  assert.ok(still.equals(await page.locator('#same').screenshot()), 'Still mode stops moods, gaze, blinks and expressions');
  await set({ intensity: .65, eyeTracking: true, hoverExpressions: true });
  await set({ enabled: false }); await until(s => !s.enabled && s.active === 0, 'global pause');
  const paused = await page.locator('#same').screenshot(); await delay(350);
  assert.ok(paused.equals(await page.locator('#same').screenshot()));
  await set({ enabled: true, showMesh: true }); await until(s => s.active >= 2, 'resume with mesh');
  await page.screenshot({ path: path.join(artifacts, 'gallery-mesh.png') });
  await set({ disabledSites: ['127.0.0.1'] }); await until(s => !s.enabled && s.active === 0, 'site pause');
  await set({ disabledSites: [], showMesh: false }); await until(s => s.active >= 2, 'site resume');
  // A two-person photo is assembled from fixture photos; detection still runs on
  // actual pixels, with no landmark mocks or detector substitution.
  await page.evaluate(async () => {
    const base = document.querySelector('#same');
    const c = document.createElement('canvas'); c.width = 800; c.height = 500;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, 800, 500);
    ctx.drawImage(base, 0, 0, 400, 500); ctx.drawImage(base, 400, 0, 400, 500);
    const img = new Image(); img.id = 'group'; img.src = c.toDataURL(); document.querySelector('#dynamic').append(img);
  });
  await until(s => s.detected >= 4 && s.active >= 4, 'dynamic image with multiple faces');
  // An opaque modal must occlude all animated faces.
  await page.locator('#blocker').evaluate(el => el.style.display = 'block');
  await until(s => s.active === 0, 'modal occlusion');
  await page.locator('#blocker').evaluate(el => el.style.display = 'none');
  await until(s => s.active >= 4, 'resume after modal');
  await page.locator('#group').evaluate(el => el.remove());
  await until(s => s.detected === 2, 'removed image cleanup');
  await page.evaluate(() => {
    const div = document.createElement('div'); div.id = 'background-photo';
    div.style.cssText = 'width:230px;height:260px;background:url(/amara.jpg) center / cover no-repeat;border-radius:20px';
    document.querySelector('#dynamic').append(div);
  });
  await until(s => s.detected === 3 && s.active === 3, 'CSS background face detection');
  await page.locator('#background-photo').evaluate(el => el.style.backgroundImage = 'none');
  await until(s => s.detected === 2 && s.active === 2, 'background replacement clears the old face');
  await page.locator('#background-photo').evaluate(el => el.remove());
  await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'shadow-photo';
    const shadow = host.attachShadow({ mode: 'open' });
    const img = new Image(); img.style.cssText = 'width:220px;height:260px;object-fit:cover'; img.src = '/amara.jpg';
    shadow.append(img); document.querySelector('#dynamic').append(host);
  });
  await until(s => s.detected === 3 && s.active === 3, 'image in open shadow DOM');
  await page.locator('#shadow-photo').evaluate(el => el.remove());
  await until(s => s.detected === 2, 'shadow DOM cleanup');
  await page.locator('#same').evaluate(el => el.src = document.querySelector('#empty').src);
  await until(s => s.detected === 1, 'source replacement removes stale face');
  await page.locator('#lazy').scrollIntoViewIfNeeded();
  await until(s => s.active === 1 && s.detected >= 2, 'lazy image scans and offscreen images stop');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.setViewportSize({ width: 350, height: 600 });
  await popup.waitForFunction(() => document.querySelector('#enabled').checked);
  await popup.locator('#mood').selectOption('happy');
  await popup.waitForFunction(() => document.querySelector('#shuffleMoods').disabled);
  await popup.locator('#eyeTracking').uncheck();
  await popup.locator('#hoverExpressions').uncheck();
  const preferences = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  assert.equal(preferences.mood, 'happy'); assert.equal(preferences.eyeTracking, false); assert.equal(preferences.hoverExpressions, false);
  await popup.locator('#mood').selectOption('random');
  await popup.locator('#shuffleMoods').click();
  await popup.locator('#eyeTracking').check(); await popup.locator('#hoverExpressions').check();
  await popup.screenshot({ path: path.join(artifacts, 'popup.png') });
  const popupHeight = await popup.evaluate(() => document.body.getBoundingClientRect().height);
  assert.ok(popupHeight <= 600, `Popup is ${popupHeight}px high; must fit Chrome's 600px limit`);
  await popup.locator('#enabled').uncheck();
  const saved = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  assert.equal(saved.enabled, false); console.log('PASS popup saves settings');
  await page.goto(`http://127.0.0.1:${port}/expressions`);
  await page.waitForSelector('body[data-ready="true"]');
  await page.screenshot({ path: path.join(artifacts, 'expressions.png'), fullPage: true });
  const pixels = JSON.parse(await page.locator('body').getAttribute('data-pixel-checks'));
  for (const name of ['smile', 'smirk', 'pout', 'brows', 'gaze']) assert.ok(pixels[name] > 1000, `Rendered ${name} must visibly alter its own region: ${pixels[name]}`);
  assert.equal(pixels.gazeMouth, 0, 'Eye tracking must not move the mouth');
  console.log('PASS rendered mouth, brow and eye pixel checks', JSON.stringify(pixels));
  const external = network.filter(url => /^https?:/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(url));
  assert.deepEqual(external, [], 'No third-party requests or uploads');
  const meaningfulErrors = errors.filter(e => !e.includes('GPU stall') && !e.includes('XNNPACK'));
  assert.deepEqual(meaningfulErrors, [], 'No uncaught errors or CSP violations');
  console.log('PASS no external requests, no audio, no CSP violations');
  await import('node:fs/promises').then(fs => fs.writeFile(path.join(artifacts, 'browser-result.json'), JSON.stringify({ ok: true, chromium: executablePath, first, pixels, popupHeight, requests, external, errors: meaningfulErrors }, null, 2)));
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
}
