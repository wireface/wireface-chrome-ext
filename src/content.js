import { normalizeSettings, enabledFor, siteKey } from './settings.js';
import { imagePlacement, backgroundPlacement, intersect } from './geometry.js';
import { PhotoRenderer, FittedFace } from './renderer.js';
import { gazeTarget } from './gaze.js';
import { randomMoodFor } from './moods.js';

if (!globalThis.__wirefaceImages) {
  globalThis.__wirefaceImages = true;
  start().catch(error => console.warn('Wireface:', error.message));
}

async function start() {
  let settings = normalizeSettings((await chrome.storage.local.get('settings')).settings);
  let site = siteKey(location.href);
  // The worker knows the top-level tab even for nested cross-origin frames.
  try { site = (await chrome.runtime.sendMessage({ target: 'wireface-background', type: 'site' }))?.site || site; } catch {}
  const records = new Map();
  const roots = new Set();
  let host, shadow, renderer, detecting = false, stopped = false, raf = 0, lastFrame = 0;
  let error = '', scanned = 0, skipped = 0, active = 0;
  const backgroundQueue = new Set();
  let backgroundTimer = 0;
  let pointer = null, hoveredFace = null, hoverPending = false;
  const running = () => !stopped && enabledFor(settings, site) && !document.hidden;

  function ensureLayer() {
    if (!host) {
      host = document.createElement('wireface-images');
      host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;display:block!important;pointer-events:none!important;z-index:2147483646!important;overflow:hidden!important;contain:strict!important;';
      host.setAttribute('aria-hidden', 'true');
      shadow = host.attachShadow({ mode: 'closed' });
    }
    if (!host.isConnected) document.documentElement.append(host);
    if (!renderer) renderer = new PhotoRenderer();
  }

  function dispose(record) {
    if (record.faces?.includes(hoveredFace)) { hoveredFace = null; hoverPending = false; }
    record.ticket++;
    record.canvas?.remove();
    if (record.texture) renderer?.release(record.texture);
    record.bitmap?.close();
    record.canvas = record.context = record.texture = record.bitmap = null;
    record.faces = null;
    record.active = 0;
    if (record.status === 'ready' || record.status === 'loading') record.status = 'idle';
  }

  function refresh(record) {
    const source = record.kind === 'background' ? backgroundSource(record.img) : record.img.currentSrc || record.img.src;
    if (source !== record.source) {
      dispose(record); record.source = source; record.status = 'idle'; record.time = 0;
    }
  }

  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const record = records.get(entry.target);
      if (!record) continue;
      record.visible = entry.isIntersecting;
      if (record.visible) { refresh(record); record.awaySince = 0; }
      else { record.active = 0; record.awaySince = performance.now(); if (record.canvas) record.canvas.style.display = 'none'; }
    }
    wake(); pump();
  }, { threshold: 0 });

  function watch(img, kind = 'image') {
    if (records.has(img)) { refresh(records.get(img)); return; }
    const record = { img, kind, source: '', status: 'idle', visible: false, ticket: 0, time: 0, awaySince: 0, active: 0 };
    records.set(img, record); refresh(record); intersection.observe(img);
  }

  function backgroundSource(element) {
    const css = getComputedStyle(element);
    if (css.backgroundRepeat !== 'no-repeat' || css.backgroundAttachment !== 'scroll') return '';
    // Multiple layers, gradients, image-set(), fixed backgrounds and tiled
    // patterns need different compositing; leave those images untouched.
    const match = /^url\("([^"\n]+)"\)$/.exec(css.backgroundImage);
    return match ? match[1] : '';
  }

  function scanBackgrounds() {
    backgroundTimer = 0;
    if (stopped) return;
    let count = 0;
    for (const node of backgroundQueue) {
      backgroundQueue.delete(node);
      if (node.isConnected && !(node instanceof HTMLImageElement) && node !== host) {
        const rect = node.getBoundingClientRect();
        if (rect.width >= settings.minSize && rect.height >= settings.minSize && backgroundSource(node)) watch(node, 'background');
      }
      if (++count >= 80) break;
    }
    if (backgroundQueue.size) backgroundTimer = setTimeout(scanBackgrounds, 30);
    pump();
  }

  function discover(root) {
    if (root === host || root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root instanceof HTMLImageElement) watch(root);
    for (const img of root.querySelectorAll('img')) watch(img);
    // Scan open shadow DOM as well as the main document. Closed roots cannot be inspected.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = root;
    do {
      if (node.shadowRoot && !roots.has(node.shadowRoot)) observe(node.shadowRoot);
      if (node.nodeType === 1 && node !== host) backgroundQueue.add(node);
    } while ((node = walker.nextNode()));
    if (!backgroundTimer) backgroundTimer = setTimeout(scanBackgrounds, 30);
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.target === host) continue;
      if (mutation.type === 'childList') for (const node of mutation.addedNodes) discover(node);
      if (mutation.type === 'attributes') {
        if (records.get(mutation.target)?.kind === 'background') refresh(records.get(mutation.target));
        if (['style', 'class'].includes(mutation.attributeName) && mutation.target !== host) {
          backgroundQueue.add(mutation.target);
          if (!backgroundTimer) backgroundTimer = setTimeout(scanBackgrounds, 30);
        }
        if (mutation.target instanceof HTMLImageElement) {
          watch(mutation.target);
          // A src/srcset assignment can precede currentSrc changing. The load event
          // will refresh again; hide the old face immediately in the meantime.
          if (['src', 'srcset', 'sizes'].includes(mutation.attributeName)) {
            const r = records.get(mutation.target); dispose(r); r.status = 'idle';
          }
        }
        if (mutation.target instanceof HTMLSourceElement) {
          const img = mutation.target.parentElement?.querySelector('img');
          if (img) { watch(img); dispose(records.get(img)); }
        }
      }
    }
    cleanup(); wake(); pump();
  });

  function observe(root) {
    roots.add(root);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'sizes', 'style', 'class', 'hidden'] });
    root.addEventListener('load', event => {
      if (event.target instanceof HTMLImageElement) { watch(event.target); refresh(records.get(event.target)); pump(); }
    }, true);
    discover(root);
  }

  function cleanup() {
    for (const [img, record] of records) {
      if (!img.isConnected) { dispose(record); intersection.unobserve(img); records.delete(img); }
      else if (!record.visible && record.awaySince && performance.now() - record.awaySince > 8000 && record.texture) dispose(record);
    }
    // Avoid retaining detached shadow trees on pages that replace their UI.
    for (const root of roots) if (root.host && !root.host.isConnected) roots.delete(root);
  }

  function captureImage(img) {
    // Reading an existing same-origin image avoids another network request, and
    // also supports local blob images. Tainted cross-origin images use the worker.
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    try {
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } catch { return img.currentSrc || img.src; }
  }

  async function pump() {
    if (detecting || !running()) return;
    cleanup();
    const ready = [...records.values()].filter(r => r.texture).length;
    if (ready >= settings.maxActive) {
      // Prefer currently visible images when the texture budget is full.
      const evict = [...records.values()].find(r => r.texture && !r.visible);
      if (evict) dispose(evict); else return;
    }
    const record = [...records.values()].find(r => {
      refresh(r);
      if (r.status !== 'idle' || !r.visible || !r.source) return false;
      if (r.kind === 'image' && (!r.img.complete || !r.img.naturalWidth)) return false;
      const rect = r.img.getBoundingClientRect();
      return rect.width >= settings.minSize && rect.height >= settings.minSize;
    });
    if (!record) return;
    detecting = true;
    record.status = 'loading';
    const ticket = ++record.ticket, source = record.source;
    try {
      const result = await chrome.runtime.sendMessage({ target: 'wireface-background', type: 'detect', url: record.kind === 'background' ? record.source : captureImage(record.img) });
      refresh(record);
      if (stopped || ticket !== record.ticket || !record.img.isConnected || source !== record.source) return;
      if (result?.disabled || !running()) { record.status = 'idle'; return; }
      if (!result || result.error) throw new Error(result?.error || 'Detector did not respond.');
      scanned++;
      if (!result.faces.length) { record.status = 'empty'; return; }
      const bitmap = await createImageBitmap(await (await fetch(result.image)).blob());
      if (ticket !== record.ticket || !running() || !record.img.isConnected) { bitmap.close(); record.status = 'idle'; return; }
      ensureLayer();
      record.bitmap = bitmap;
      record.naturalWidth = result.naturalWidth;
      record.naturalHeight = result.naturalHeight;
      record.faces = result.faces.map((points, index) => {
        const face = new FittedFace(points, result.width / result.height);
        face.identity = `${record.source}#face-${index}`;
        face.idle.randomMood = randomMoodFor(face.identity, settings.moodSeed);
        return face;
      });
      record.texture = renderer.upload(bitmap);
      record.canvas = document.createElement('canvas');
      record.canvas.style.cssText = 'position:absolute;pointer-events:none;display:none;';
      record.context = record.canvas.getContext('2d');
      shadow.append(record.canvas);
      record.status = 'ready';
      wake();
    } catch (e) {
      if (ticket === record.ticket) { dispose(record); record.status = 'error'; skipped++; error = e.message; }
    } finally {
      detecting = false;
      // Yield between images so long pages remain responsive.
      if (running()) setTimeout(pump, 70);
    }
  }

  function topElement(x, y) {
    let element = document.elementFromPoint(x, y);
    while (element?.shadowRoot?.elementFromPoint) {
      const next = element.shadowRoot.elementFromPoint(x, y);
      if (!next || next === element) break;
      element = next;
    }
    return element;
  }

  function layout(record) {
    const img = record.img, rect = img.getBoundingClientRect(), style = getComputedStyle(img);
    if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0 || rect.width < settings.minSize || rect.height < settings.minSize) return null;
    let clip = intersect(rect, { left: 0, top: 0, right: innerWidth, bottom: innerHeight });
    let opacity = Number(style.opacity);
    for (let node = img; node; node = node.parentElement || node.getRootNode().host) {
      const css = node === img ? style : getComputedStyle(node);
      if (css.transform !== 'none') {
        const m = new DOMMatrixReadOnly(css.transform);
        // Axis-aligned scaling is supported; avoid misplaced faces on rotated,
        // mirrored or perspective-transformed pictures.
        if (!m.is2D || Math.abs(m.b) > 0.001 || Math.abs(m.c) > 0.001 || m.a <= 0 || m.d <= 0) return null;
      }
      if (node === img) continue;
      opacity *= Number(css.opacity);
      if (css.visibility !== 'visible' || css.display === 'none' || opacity <= 0) return null;
      const r = node.getBoundingClientRect();
      if (/(hidden|clip|scroll|auto)/.test(css.overflowX)) clip = intersect(clip, { left: r.left, right: r.right, top: -Infinity, bottom: Infinity });
      if (/(hidden|clip|scroll|auto)/.test(css.overflowY)) clip = intersect(clip, { top: r.top, bottom: r.bottom, left: -Infinity, right: Infinity });
    }
    if (clip.width <= 0 || clip.height <= 0) return null;
    const sx = rect.width / (img.offsetWidth || rect.width), sy = rect.height / (img.offsetHeight || rect.height);
    const px = key => parseFloat(style[key]) || 0;
    const bg = record.kind === 'background';
    if (bg && style.backgroundOrigin !== 'padding-box' && style.backgroundOrigin !== 'content-box' && style.backgroundOrigin !== 'border-box') return null;
    const border = !bg || style.backgroundOrigin !== 'border-box';
    const padding = !bg || style.backgroundOrigin === 'content-box';
    const inset = side => (border ? px(`border${side}Width`) : 0) + (padding ? px(`padding${side}`) : 0);
    const left = rect.left + inset('Left') * sx;
    const top = rect.top + inset('Top') * sy;
    const width = rect.width - (inset('Left') + inset('Right')) * sx;
    const height = rect.height - (inset('Top') + inset('Bottom')) * sy;
    if (width <= 0 || height <= 0) return null;
    const placement = bg
      ? backgroundPlacement(width / sx, height / sy, record.naturalWidth, record.naturalHeight, style.backgroundSize, style.backgroundPosition)
      : imagePlacement(width / sx, height / sy, img.naturalWidth, img.naturalHeight, style.objectFit, style.objectPosition);
    if (!placement) return null;
    placement.x *= sx; placement.width *= sx; placement.y *= sy; placement.height *= sy;
    const visibleFaces = record.faces.filter(face => {
      const b = face.bounds;
      // Do not paint over menus, dialogs, sticky headers, or neighboring cards.
      // Sample the centre and inner corners of each face in the page's hit-test tree.
      for (const [u, v] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
        const x = left + placement.x + (b.left + (b.right - b.left) * u) * placement.width;
        const y = top + placement.y + (b.top + (b.bottom - b.top) * v) * placement.height;
        const hit = topElement(x, y);
        const hitsImage = hit === img || (style.pointerEvents === 'none' && hit?.contains(img));
        if (x < clip.left || x >= clip.right || y < clip.top || y >= clip.bottom || !hitsImage) return false;
      }
      return true;
    });
    return { left, top, width, height, clip, placement, visibleFaces, opacity, style };
  }

  function wake() { if (!raf && running() && [...records.values()].some(r => r.visible && r.texture)) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (!running()) return;
    if (now - lastFrame < 1000 / 30) { wake(); return; }
    const dt = Math.min(.25, (now - lastFrame) / 1000); lastFrame = now;
    active = 0;
    let hoverCandidate = null, hoverTime = 0, hoverDistance = Infinity;
    for (const record of records.values()) {
      record.active = 0;
      if (!record.canvas) continue;
      if (!record.visible || !record.img.isConnected || active >= settings.maxActive) { record.canvas.style.display = 'none'; continue; }
      refresh(record);
      if (!record.canvas) continue;
      const l = layout(record);
      if (!l || !l.visibleFaces.length) { record.canvas.style.display = 'none'; continue; }
      const c = record.canvas.style;
      c.display = 'block'; c.left = `${l.left}px`; c.top = `${l.top}px`;
      c.width = `${l.width}px`; c.height = `${l.height}px`;
      c.opacity = String(l.opacity); c.borderRadius = l.style.borderRadius; c.filter = l.style.filter;
      c.clipPath = `inset(${Math.max(0, l.clip.top - l.top)}px ${Math.max(0, l.left + l.width - l.clip.right)}px ${Math.max(0, l.top + l.height - l.clip.bottom)}px ${Math.max(0, l.clip.left - l.left)}px)`;
      record.time += dt;
      try {
        const faces = l.visibleFaces.slice(0, settings.maxActive - active);
        const hit = pointer ? topElement(pointer.x, pointer.y) : null;
        const overImage = pointer && pointer.x >= l.left && pointer.x < l.left + l.width && pointer.y >= l.top && pointer.y < l.top + l.height
          && (hit === record.img || (l.style.pointerEvents === 'none' && hit?.contains(record.img)));
        for (const face of faces) {
          const b = face.bounds;
          const box = { x: l.left + l.placement.x + (b.left + b.right) / 2 * l.placement.width,
            y: l.top + l.placement.y + (b.top + b.bottom) / 2 * l.placement.height,
            width: (b.right - b.left) * l.placement.width, height: (b.bottom - b.top) * l.placement.height };
          face.targetGaze = settings.eyeTracking ? gazeTarget(pointer, box) : null;
          if (overImage && settings.hoverExpressions && settings.intensity > 0) {
            const distance = Math.hypot((pointer.x - box.x) / box.width, (pointer.y - box.y) / box.height);
            if (distance < hoverDistance) { hoverCandidate = face; hoverTime = record.time; hoverDistance = distance; }
          }
        }
        renderer.draw(record, l.placement, l.width, l.height, settings, faces);
        record.active = faces.length; active += faces.length;
      }
      catch (e) { error = e.message; dispose(record); record.status = 'error'; }
    }
    if (hoverCandidate !== hoveredFace) {
      hoveredFace = hoverCandidate;
      hoverPending = !!hoverCandidate;
    }
    // If a quick re-entry hits the cooldown, keep one pending reaction until it
    // can run. Remaining over the image never continuously restarts reactions.
    if (hoverPending && hoverCandidate?.idle.react(hoverTime)) hoverPending = false;
    wake();
  }

  function pause() {
    cancelAnimationFrame(raf); raf = 0; active = 0;
    pointer = null; hoveredFace = null; hoverPending = false;
    for (const r of records.values()) { r.active = 0; if (r.canvas) r.canvas.style.display = 'none'; }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    settings = normalizeSettings(changes.settings.newValue);
    for (const record of records.values()) for (const face of record.faces || []) face.idle.randomMood = randomMoodFor(face.identity, settings.moodSeed);
    if (!enabledFor(settings, site)) { pause(); for (const r of records.values()) dispose(r); }
    else { wake(); pump(); }
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.target !== 'wireface-content') return;
    if (message.type === 'rescan') {
      error = ''; skipped = 0;
      for (const r of records.values()) { dispose(r); r.status = 'idle'; }
      renderer?.destroy(); renderer = null;
      discover(document); pump();
    }
    if (message.type === 'status' || message.type === 'rescan') respond({ enabled: enabledFor(settings, site), site, active: [...records.values()].reduce((n, r) => n + (r.active || 0), 0), scanned, skipped, error, detected: [...records.values()].reduce((n, r) => n + (r.faces?.length || 0), 0), scanning: detecting,
      faceStates: [...records.values()].flatMap(r => (r.faces || []).map(f => ({ mood: f.idle.mood, expression: f.idle.gesture?.spec.name || null,
        gestures: f.idle.gestureCount, hovers: f.idle.hoverCount, gaze: f.gaze.value.slice() }))) });
  });
  addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    pointer = { x: event.clientX, y: event.clientY }; wake();
  }, { passive: true, capture: true });
  const clearPointer = () => { pointer = null; hoveredFace = null; hoverPending = false; };
  addEventListener('pointerout', event => { if (!event.relatedTarget) clearPointer(); }, { passive: true });
  addEventListener('blur', clearPointer);
  document.addEventListener('visibilitychange', () => { if (!running()) pause(); else { lastFrame = performance.now(); wake(); pump(); } });
  addEventListener('scroll', () => { wake(); pump(); }, { passive: true, capture: true });
  addEventListener('resize', () => { for (const r of records.values()) refresh(r); wake(); pump(); }, { passive: true });
  addEventListener('pagehide', event => {
    pause(); for (const r of records.values()) dispose(r);
    renderer?.destroy(); renderer = null;
    if (!event.persisted) { stopped = true; observer.disconnect(); intersection.disconnect(); clearInterval(maintenance); clearTimeout(backgroundTimer); backgroundQueue.clear(); }
  });
  addEventListener('pageshow', () => { if (running()) { wake(); pump(); } });
  const maintenance = setInterval(() => { cleanup(); if (running()) pump(); }, 2500);
  observe(document);
}
