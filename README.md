# Wireface Chrome

[wireface.dev](https://wireface.dev) ? A silent face animation extension for Chrome.

Faces in browser pictures come to life with random blinks, double blinks, smiles, left/right smirks, pouts, squints, nose twitches and brow raises. Eyes follow the pointer and hovering over a picture triggers a random expression. Each face has independent timing and can have its own random mood. It animates the original picture using Wireface's fitted face rig; the wire mesh is optional. There is no talking, speech animation, microphone access or audio.

## Install the built extension

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the **`dist`** folder from a local build (see below).
4. Refresh any already-open web pages. Pin **Wireface** to the toolbar if you want quick access to its controls.

`wireface-chrome.zip` contains the same ready-to-load extension. Extract it and select the extracted directory with **Load unpacked**. No build, API key, server or account is required to use the packaged extension. It has not been published to the Chrome Web Store.

Open the toolbar popup to pause everywhere, pause the current site, adjust **Personality**, toggle the mesh, or scan again. Setting Personality to **Still** stops all expressions, moods and gaze motion, including blinks. Disabling Wireface immediately shows the untouched original images.

### Recent updates

Version 0.2.2 adds a clickable [wireface.dev](https://wireface.dev) link to the popup footer and extension homepage, and makes this repository build independently. It uses the desktop app's original blue-to-violet wireframe logo on solid black for the Chrome icons and popup. The popup background is also black. Run `npm run icons` to regenerate the PNG sizes from the checked-in `assets/icons/logo.svg` (the desktop app's original artwork, backed with black); ordinary builds copy the checked-in `assets/icons` files.

- **Eyes follow the pointer** smoothly within the photographed eye openings. Tracking uses the mouse/pen position, not a camera. The irises move inside the animated lids, so blinks continue to cover them. Turn this off to return the eyes to their original direction.
- **Random expression on hover** reacts once when the pointer enters a picture. In a group photo, the closest visible face responds; moving to another face lets it react. A short cooldown prevents jitter at the edge from restarting an expression repeatedly. Touch scrolling does not trigger reactions.
- **Mood for faces** defaults to **Random per face**. Each face keeps its assignment when it scrolls out of view and back. **Shuffle** assigns another set without rescanning images. Choose **Neutral**, **Happy**, **Cheeky**, **Curious**, **Calm**, **Thoughtful**, **Sleepy** or **Grumpy** to apply that mood to all faces. Mood changes fade smoothly; short idle/hover expressions temporarily take precedence and then return to the standing mood.
- **More visible idle motion:** the first micro expression starts within 0.4–1.8 seconds of active animation; subsequent expressions have 1.2–3.2 second gaps. A shuffled pool visits every expression before repeating it. Pout and squint are now included, and flat-photo expression strength is increased without amplifying full blinks. All animation remains silent with the jaw closed.

To update an existing unpacked installation, click **Reload** on Wireface at `chrome://extensions`, then refresh the web pages. The same `dist` folder and `wireface-chrome.zip` now contain version 0.2.2; existing preferences are preserved and the new interaction controls default to enabled.

### Why the earlier version looked like blinking only

The old scheduler did run other gestures, but the default intensity and another random strength multiplier reduced smiles/smirks/brows to roughly 1–2 pixels of peak displacement in the 260-pixel test portrait, compared with an unmistakable full eyelid closure. It could also wait 7.5 seconds between gestures and randomly repeat the same gesture. Pout was absent from the pool, and most of the underlying rig's pout is forward in 3D, which does not visibly project onto a flat picture.

Version 0.2.0 adds a 2D lip purse for pout and boosts photo expression channels. Regression checks now exercise mouth and brow movement separately from blinking, and compare rendered eye pixels for gaze tracking. On the same test portrait at the default setting, peak smile/smirk/brow displacement is approximately 3.7–5.5 pixels. Actual movement depends on the fitted face and displayed image size.

## Supported pictures

- Ordinary `<img>` elements, responsive `<picture>`/`srcset` images and lazy-loaded images.
- Images inserted later by a page, including infinite-scroll results.
- Multiple faces in one picture, with independent movement.
- Same-origin, cross-origin, readable blob/data images and images inside open shadow DOM.
- Single, non-repeating CSS background images, including `cover`, `contain`, explicit sizes and background positioning.
- HTTP/HTTPS frames; a site's pause setting also applies to its embedded frames.
- Local pages and pictures when **Allow access to file URLs** is enabled in Chrome's extension details.

Detection is strongest on clear human faces. Small, obscured, very sideways or heavily stylized faces may be missed. By default, pictures smaller than 80 × 80 displayed pixels are ignored, each picture is scanned for up to eight faces, and each frame draws up to 12 visible faces. Detection textures are capped at 1280 pixels on their longest side. Images over 20 MB or 40 megapixels are skipped.

Chrome's internal pages, the Chrome Web Store and the built-in PDF viewer do not allow ordinary extension content scripts. Video, canvas pixels, SVG, closed shadow roots, pseudo-element backgrounds, repeating/layered/fixed backgrounds and rotated/mirrored/perspective-transformed images are not supported. GIF/WebP animations are treated as a still frame. Images that require credentials on another origin or reject extension fetches may be skipped. The popup reports inspection errors; **Scan again** retries them. Complex clipping/stacking effects can also prevent a face from being shown.

The original image element remains in place, retaining its size, alt text and links. A transparent, pointer-transparent canvas paints just the moving face over it. Image fit/position, common overflow clipping and page scrolling are respected. Faces covered by a modal or another element are hidden using hit tests. Offscreen images and hidden tabs stop animating; unused textures are released.

## Local processing and permissions

The packaged MediaPipe model runs in an extension offscreen document, and the Wireface rig and renderer run locally. There are no remote scripts, model downloads, analytics, accounts or image uploads. When the extension cannot read the already-loaded image, it requests that image's URL without credentials or a referrer. The detector keeps a bounded in-memory cache for up to five minutes; pictures and landmarks are not saved in extension storage. Only preferences are persisted.

The manifest requests:

| Permission | Purpose |
| --- | --- |
| HTTP/HTTPS host access | Find page images automatically and read cross-origin image pixels. |
| File host access | Optional local-picture support, subject to Chrome's file-access toggle. |
| `storage` | Save pause settings, site exclusions and appearance preferences. |
| `offscreen` | Decode image blobs and run the bundled detector away from the page. |

The architecture follows Chrome's [cross-origin request model](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) and [offscreen document API](https://developer.chrome.com/docs/extensions/reference/api/offscreen). Detection uses the [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).

## Build and develop

Use Node 20 or newer. This repository includes the required Wireface runtime, face detector/model and test fixtures; no sibling repositories or private package registry are required.

```powershell
git clone https://github.com/wireface/wireface-chrome-ext.git
cd wireface-chrome-ext
npm ci
npm run build
npm test
npm run test:browser
npm run package
```

The browser suite needs a Playwright Chromium installation. If needed, run `npx playwright-core install chromium`, or set `WIREFACE_CHROMIUM` to a Chromium executable. It uses a temporary browser profile, not your normal Chrome profile. On Windows, the scripts can also use an existing Playwright Chromium installation.

`npm run build` bundles the extension, copies the checked-in `vendor/mediapipe` model/WASM files and includes licence notices. `npm run package` also produces `wireface-chrome.zip`. After rebuilding, click **Reload** on the extension in Chrome and refresh the test page.

The unit tests cover silent random expression coverage, independent timing, hover cooldowns, mood blending, stable random assignments, gaze easing, still mode, visible non-blink movement, fitted geometry, image/background placement, clipping, URL validation and settings. The browser suite uses actual bundled face detection under a restrictive page CSP and verifies cursor tracking, hover reactions, live mood changes/shuffling, interaction toggles, region-specific pixel changes, cross-origin images, multiple faces, dynamic sources, backgrounds, open shadow DOM, lazy loading, pause/resume, modal occlusion, cleanup, original links/layout and popup settings. It also checks that the fixture run makes no external requests. Screenshots and results are written to `artifacts/`, including an expression and gaze contact sheet.

## Layout

- `src/content.js`: image discovery, lifecycle, placement, clipping and scheduling.
- `src/background.js` / `src/offscreen.js`: trusted extension messaging and local detection.
- `src/renderer.js`: Wireface rig fitting and a shared WebGL renderer for all pictures in a frame.
- `src/idle.js`: silent, randomized expression timing.
- `src/gaze.js` / `src/moods.js`: pointer gaze, standing expressions and stable random mood assignment.
- `src/popup.js`, `popup.html`, `popup.css`: toolbar controls.
- `tools/`: reproducible bundle and ZIP creation.
- `test/`: unit and real-browser checks, with local fixtures.
- `vendor/`: pinned Wireface runtime and MediaPipe assets; see `vendor/README.md` for their origins.

Wireface code retains the Wireface SDK Licence copied into the built extension. MediaPipe's model, runtime and canonical geometry retain their Apache 2.0 notices. See `LICENSE.md`, `NOTICE` and `licenses/Apache-2.0.txt`; these also ship with the built extension.
