import { PhotoRenderer, FittedFace } from '../src/renderer.js';
import { GESTURES } from '../src/idle.js';

const image = await createImageBitmap(await (await fetch('/amara.jpg')).blob());
const points = await (await fetch('/amara.json')).json();
const renderer = new PhotoRenderer();
for (const name of ['neutral', 'blink', 'smile', 'smirk-left', 'pout', 'brow-raise', 'look-left', 'look-right', 'look-down']) {
  const face = new FittedFace(points, image.width / image.height);
  face.idle.nextBlink = face.idle.nextGesture = Infinity;
  if (name === 'blink') face.idle.blinkStart = .41;
  else if (name.startsWith('look-')) {
    face.targetGaze = name === 'look-left' ? [-1, 0] : name === 'look-right' ? [1, 0] : [0, 1];
    for (let t = 0; t < .5; t += .02) face.step(t, .65);
  } else if (name !== 'neutral') face.idle.gesture = { spec: GESTURES.find(g => g.name === name), start: 0, duration: 1, strength: .95 };
  const canvas = document.createElement('canvas');
  const record = { texture: renderer.upload(image), canvas, context: canvas.getContext('2d'), time: name === 'nose-twitch' ? .4 : .5 };
  renderer.draw(record, { x: 0, y: 0, width: 280, height: 280 }, 280, 280, { intensity: .65, showMesh: false }, [face]);
  const result = document.createElement('canvas'); result.width = result.height = 280;
  const ctx = result.getContext('2d'); ctx.drawImage(image, 0, 0, 280, 280); ctx.drawImage(canvas, 0, 0, 280, 280);
  const figure = document.createElement('figure'), caption = document.createElement('figcaption'); caption.textContent = name;
  figure.append(result, caption); document.querySelector('main').append(figure);
  result.dataset.expression = name;
  renderer.release(record.texture);
}
renderer.destroy(); image.close();
// The pixel oracle checks specific regions, not just that some animation changed
// the image. This catches the original blink-only false positive in browser QA.
const data = name => document.querySelector(`canvas[data-expression="${name}"]`).getContext('2d').getImageData(0, 0, 280, 280).data;
const neutral = data('neutral');
const diff = (a, b, rect) => {
  let total = 0;
  for (let y = rect[1]; y < rect[3]; y++) for (let x = rect[0]; x < rect[2]; x++) for (let c = 0; c < 3; c++) total += Math.abs(a[(y * 280 + x) * 4 + c] - b[(y * 280 + x) * 4 + c]);
  return total;
};
const mouth = [112, 145, 172, 179], brows = [105, 90, 176, 104], eyes = [108, 100, 177, 121];
document.body.dataset.pixelChecks = JSON.stringify({
  smile: diff(neutral, data('smile'), mouth), smirk: diff(neutral, data('smirk-left'), mouth),
  pout: diff(neutral, data('pout'), mouth), brows: diff(neutral, data('brow-raise'), brows),
  gaze: diff(data('look-left'), data('look-right'), eyes),
  gazeMouth: diff(data('look-left'), data('look-right'), mouth),
});
document.body.dataset.ready = 'true';
