import { mkdir, readFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const dist = path.join(root, 'dist');
await mkdir(dist, { recursive: true });
for (const file of ['manifest.json', 'offscreen.html', 'popup.html', 'popup.css']) await cp(path.join(root, file), path.join(dist, file));
await cp(path.join(root, 'vendor/mediapipe'), path.join(dist, 'vendor/mediapipe'), { recursive: true });
await mkdir(path.join(dist, 'licenses'), { recursive: true });
await cp(path.join(root, 'LICENSE.md'), path.join(dist, 'LICENSE.md'));
await cp(path.join(root, 'licenses/Apache-2.0.txt'), path.join(dist, 'licenses/Apache-2.0.txt'));
await cp(path.join(root, 'NOTICE'), path.join(dist, 'NOTICE'));

for (const entry of ['content', 'background', 'offscreen', 'popup']) {
  await build({ entryPoints: [path.join(root, `src/${entry}.js`)], outfile: path.join(dist, `${entry}.js`), bundle: true,
    format: entry === 'content' ? 'iife' : 'esm', target: 'chrome116', minify: true, legalComments: 'inline',
    external: ['./vendor/mediapipe/vision_bundle.mjs'],
    banner: { js: '/*! Wireface Chrome | Copyright 2026 Compsmart | https://wireface.dev | See LICENSE.md and NOTICE. */' },
  });
}

await cp(path.join(root, 'assets/icons'), path.join(dist, 'icons'), { recursive: true });
const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json')));
console.log(`Built ${manifest.name} ${manifest.version}\nLoad unpacked: ${dist}`);
