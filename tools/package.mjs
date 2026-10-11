import './build.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { zipSync } = require('fflate');
const root = fileURLToPath(new URL('../', import.meta.url)), files = {};
async function collect(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await collect(path.join(dir, entry.name), `${prefix}${entry.name}/`);
    else files[`${prefix}${entry.name}`] = new Uint8Array(await readFile(path.join(dir, entry.name)));
  }
}
await collect(path.join(root, 'dist'));
await writeFile(path.join(root, 'wireface-chrome.zip'), zipSync(files, { level: 6 }));
console.log('Packaged extension/wireface-chrome.zip');
