import { normalizeSettings, siteKey } from './settings.js';
import { MOODS } from './moods.js';

const $ = id => document.getElementById(id);
let settings = normalizeSettings((await chrome.storage.local.get('settings')).settings);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const site = siteKey(tab?.url);
const supported = /^(https?|file):/.test(tab?.url || '');
$('site').textContent = site || 'This browser page';
$('siteEnabled').disabled = !supported;
$('rescan').disabled = !supported;
for (const [value, label] of [['random', 'Random per face'], ...Object.entries(MOODS).map(([id, mood]) => [id, mood.label])]) {
  const option = document.createElement('option'); option.value = value; option.textContent = label; $('mood').append(option);
}

function render() {
  $('enabled').checked = settings.enabled;
  $('siteEnabled').checked = !settings.disabledSites.includes(site);
  $('intensity').value = Math.round(settings.intensity * 100);
  $('amount').textContent = `${Math.round(settings.intensity * 100)}%`;
  $('showMesh').checked = settings.showMesh;
  $('eyeTracking').checked = settings.eyeTracking;
  $('hoverExpressions').checked = settings.hoverExpressions;
  $('mood').value = settings.mood;
  $('shuffleMoods').disabled = settings.mood !== 'random';
  $('moodHint').textContent = settings.mood === 'random' ? 'Each face gets its own mood.' : `${MOODS[settings.mood].label} on every face. Idle expressions still play.`;
}
async function save(patch) {
  settings = normalizeSettings({ ...settings, ...patch });
  await chrome.storage.local.set({ settings });
  render(); refresh();
}
$('enabled').addEventListener('change', event => save({ enabled: event.target.checked }));
$('siteEnabled').addEventListener('change', event => save({ disabledSites: event.target.checked ? settings.disabledSites.filter(x => x !== site) : [...settings.disabledSites, site] }));
$('intensity').addEventListener('input', event => { $('amount').textContent = `${event.target.value}%`; });
$('intensity').addEventListener('change', event => save({ intensity: Number(event.target.value) / 100 }));
$('showMesh').addEventListener('change', event => save({ showMesh: event.target.checked }));
$('eyeTracking').addEventListener('change', event => save({ eyeTracking: event.target.checked }));
$('hoverExpressions').addEventListener('change', event => save({ hoverExpressions: event.target.checked }));
$('mood').addEventListener('change', event => save({ mood: event.target.value }));
$('shuffleMoods').addEventListener('click', () => save({ moodSeed: (settings.moodSeed + 1) % 0x80000000 }));
$('rescan').addEventListener('click', () => refresh('rescan'));
async function refresh(type = 'status') {
  if (!supported) {
    $('status').textContent = 'Open a web page with pictures';
    $('detail').textContent = 'Chrome protects its own pages and the Chrome Web Store from extensions.';
    return;
  }
  if (!settings.enabled || settings.disabledSites.includes(site)) {
    $('status').textContent = settings.enabled ? 'Paused on this site' : 'Wireface is paused';
    $('detail').textContent = ''; return;
  }
  try {
    const status = await chrome.tabs.sendMessage(tab.id, { target: 'wireface-content', type }, { frameId: 0 });
    $('status').textContent = status.active ? `${status.active} ${status.active === 1 ? 'face' : 'faces'} alive on this page` : status.scanning ? 'Looking for faces…' : status.detected ? 'Faces ready · scroll them into view' : 'Watching for faces in pictures';
    $('detail').textContent = status.error ? `${status.skipped || 1} image(s) skipped. ${status.error}` : settings.intensity === 0 ? 'Motion is set to Still. Raise Personality to animate.' : '';
  } catch {
    $('status').textContent = 'Refresh this page to start';
    $('detail').textContent = tab.url?.startsWith('file:') ? 'For local pictures, enable “Allow access to file URLs” in Chrome’s extension details.' : 'Existing tabs may need one refresh after you install or reload Wireface.';
  }
}
render(); refresh();
setInterval(refresh, 1500);
