import { FaceLandmarker } from './vendor/mediapipe/vision_bundle.mjs';
import { validImageURL } from './settings.js';

let detectorPromise;
const cache = new Map();
const pending = new Map();
let cacheBytes = 0;
let queue = Promise.resolve();

function detector() {
  if (!detectorPromise) {
    detectorPromise = FaceLandmarker.createFromOptions({
      wasmLoaderPath: chrome.runtime.getURL('vendor/mediapipe/wasm/vision_wasm_internal.js'),
      wasmBinaryPath: chrome.runtime.getURL('vendor/mediapipe/wasm/vision_wasm_internal.wasm'),
    }, {
      baseOptions: { modelAssetPath: chrome.runtime.getURL('vendor/mediapipe/face_landmarker.task'), delegate: 'CPU' },
      runningMode: 'IMAGE', numFaces: 8,
      minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5,
      outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
    }).catch(error => { detectorPromise = null; throw error; });
  }
  return detectorPromise;
}

async function readImage(url) {
  const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Image unavailable (${response.status}).`);
  const type = response.headers.get('content-type')?.split(';')[0].trim() || '';
  if (!type.startsWith('image/')) throw new Error('This URL did not return an image.');
  if (type === 'image/svg+xml') throw new Error('SVG images are not supported.');
  const max = 20 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > max) throw new Error('Image exceeds 20 MB.');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new Error('Image exceeds 20 MB.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Blob(chunks, { type });
}

async function detect(url) {
  const blob = await readImage(url);
  const bitmap = await createImageBitmap(blob);
  const naturalWidth = bitmap.width, naturalHeight = bitmap.height;
  if (naturalWidth * naturalHeight > 40_000_000) { bitmap.close(); throw new Error('Image exceeds 40 megapixels.'); }
  // Cap both dimensions without distorting portrait images.
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const result = (await detector()).detect(canvas);
  const faces = (result.faceLandmarks || []).filter(f => f.length >= 468)
    .map(f => f.slice(0, 478).map(p => [p.x, p.y]));
  return {
    faces, width: canvas.width, height: canvas.height, naturalWidth, naturalHeight,
    // The original pixels never leave the machine; the content script receives a
    // resized texture only when there is a face, not arbitrary network content.
    image: faces.length ? canvas.toDataURL('image/png') : null,
  };
}

function inspect(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60_000) {
    cache.delete(url); cache.set(url, hit); return Promise.resolve(hit.result);
  }
  if (hit) { cacheBytes -= hit.bytes; cache.delete(url); }
  if (pending.has(url)) return pending.get(url);
  if (pending.size >= 48) return Promise.resolve({ error: 'Detector busy. Try scanning again.' });
  const job = queue.then(() => detect(url));
  queue = job.catch(() => {});
  pending.set(url, job);
  job.then(result => {
    const bytes = (result.image?.length || 0) * 2 + url.length * 2 + result.faces.length * 7500;
    cache.set(url, { result, bytes, at: Date.now() }); cacheBytes += bytes;
    while (cache.size > 32 || cacheBytes > 32 * 1024 * 1024) {
      const key = cache.keys().next().value;
      cacheBytes -= cache.get(key).bytes; cache.delete(key);
    }
  }, () => {}).finally(() => pending.delete(url));
  return job;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== 'wireface-detector' || sender.id !== chrome.runtime.id || sender.tab || !validImageURL(message.url)) return;
  inspect(message.url).then(respond, error => respond({ error: error.message || 'Face detection failed.' }));
  return true;
});
