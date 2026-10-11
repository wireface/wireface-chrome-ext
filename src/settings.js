import { MOOD_CHOICES } from './moods.js';

export const DEFAULTS = Object.freeze({
  enabled: true,
  disabledSites: [],
  intensity: 0.65,
  showMesh: false,
  eyeTracking: true,
  hoverExpressions: true,
  mood: 'random',
  moodSeed: 0,
  maxActive: 12,
  minSize: 80,
});

export function normalizeSettings(input = {}) {
  const finite = (v, fallback, min, max) => Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    enabled: input.enabled !== false,
    disabledSites: Array.isArray(input.disabledSites) ? [...new Set(input.disabledSites.filter(x => typeof x === 'string'))].slice(0, 500) : [],
    intensity: finite(input.intensity, DEFAULTS.intensity, 0, 1),
    showMesh: input.showMesh === true,
    eyeTracking: input.eyeTracking !== false,
    hoverExpressions: input.hoverExpressions !== false,
    mood: MOOD_CHOICES.includes(input.mood) ? input.mood : DEFAULTS.mood,
    moodSeed: Math.floor(finite(input.moodSeed, DEFAULTS.moodSeed, 0, 0x7fffffff)),
    maxActive: Math.round(finite(input.maxActive, DEFAULTS.maxActive, 1, 24)),
    minSize: Math.round(finite(input.minSize, DEFAULTS.minSize, 40, 400)),
  };
}

export function siteKey(url) {
  try { const u = new URL(url); return u.protocol === 'file:' ? 'Local files' : u.hostname; }
  catch { return ''; }
}

export const enabledFor = (settings, site) => settings.enabled && !settings.disabledSites.includes(site);

// Only image URLs found by our isolated content script are accepted. Never return
// response text or arbitrary page data to a web page.
export function validImageURL(value) {
  if (typeof value !== 'string' || value.length > 12_000_000) return false;
  if (/^data:image\/(?:png|jpeg|webp|gif|avif|bmp);base64,/i.test(value)) return true;
  try { return ['https:', 'http:', 'file:'].includes(new URL(value).protocol); }
  catch { return false; }
}
