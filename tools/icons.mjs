// Reuse the desktop app's original vector artwork, with an opaque black backing.
// Run only when updating the logo; ordinary builds copy the generated assets.
import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const root = fileURLToPath(new URL('../', import.meta.url));
let executablePath = process.env.WIREFACE_CHROMIUM || chromium.executablePath();
try { await access(executablePath); } catch {
  if (!process.env.LOCALAPPDATA) throw new Error('Install Playwright Chromium or set WIREFACE_CHROMIUM.');
  const cache = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  const dirs = (await readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const dir of dirs) {
    const candidate = path.join(cache, dir, 'chrome-win64/chrome.exe');
    try { await access(candidate); executablePath = candidate; break; } catch {}
  }
}
const svg = await readFile(path.join(root, 'assets/icons/logo.svg'), 'utf8');
const destination = path.join(root, 'assets/icons');
await mkdir(destination, { recursive: true });
await writeFile(path.join(destination, 'logo.svg'), svg);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128, 256]) {
    const base64 = await page.evaluate(async ({ svg, size }) => {
      const picture = new Image();
      picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await picture.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const context = canvas.getContext('2d'); context.drawImage(picture, 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size).data;
      if (pixels[0] || pixels[1] || pixels[2] || pixels[3] !== 255) throw new Error('Logo backing must be opaque black.');
      return canvas.toDataURL('image/png').split(',')[1];
    }, { svg, size });
    await writeFile(path.join(destination, `${size}.png`), Buffer.from(base64, 'base64'));
  }
} finally { await browser.close(); }
console.log('Generated desktop Wireface logo on black at 16, 32, 48, 128 and 256 pixels.');
