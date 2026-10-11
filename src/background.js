import { normalizeSettings, enabledFor, siteKey, validImageURL } from './settings.js';

let creating;
async function ensureDetector() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
  if (contexts.length) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['BLOBS'],
      justification: 'Decode image blobs and run the bundled local face landmark detector on a canvas.',
    }).finally(() => { creating = null; });
  }
  await creating;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== 'wireface-background' || sender.id !== chrome.runtime.id) return;
  if (message.type === 'site' && sender.tab) { respond({ site: siteKey(sender.tab.url || sender.url) }); return; }
  if (message.type !== 'detect' || !sender.tab || !validImageURL(message.url)) {
    respond({ error: 'Invalid image request.' }); return;
  }
  (async () => {
    const settings = normalizeSettings((await chrome.storage.local.get('settings')).settings);
    if (!enabledFor(settings, siteKey(sender.tab.url || sender.url))) return { disabled: true };
    await ensureDetector();
    return await chrome.runtime.sendMessage({ target: 'wireface-detector', type: 'detect', url: message.url });
  })().then(respond, error => respond({ error: error.message || 'Could not inspect this image.' }));
  return true;
});
