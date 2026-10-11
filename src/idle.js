import { C, CH } from '../vendor/wireface/core/rig.js';
import { MOODS, RANDOM_MOODS } from './moods.js';

export const GESTURES = Object.freeze([
  { name: 'smile', duration: [2.2, 3.5], channels: { smileL: .85, smileR: .85, squintL: .13, squintR: .13 } },
  { name: 'smirk-left', duration: [1.8, 3], channels: { smileL: .95, smileR: .08, browUpR: .3 } },
  { name: 'smirk-right', duration: [1.8, 3], channels: { smileR: .95, smileL: .08, browUpL: .3 } },
  { name: 'brow-raise', duration: [1.3, 2.1], channels: { browUpL: .85, browUpR: .85 } },
  { name: 'one-brow', duration: [1.8, 2.7], channels: { browUpL: .95, browUpR: .08 } },
  { name: 'nose-twitch', duration: [.4, .6], channels: { sneer: .2 }, twitch: true },
  { name: 'pout', duration: [2, 3.2], channels: { pout: .95, frown: .12, browInner: .18 } },
  { name: 'squint', duration: [1.4, 2.3], channels: { squintL: .48, squintR: .48, browDown: .25 } },
]);

// Flat photos lack the lighting cues of the 3D rig. Blinks already use the full
// lid range; only the subtle expression channels need amplification.
const PHOTO_GAIN = Object.entries({ smileL: 1.65, smileR: 1.65, browUpL: 1.8, browUpR: 1.8,
  browDown: 1.6, browInner: 1.6, frown: 1.55, pout: 1.4, sneer: 1.5 });

const smooth = t => t * t * (3 - 2 * t);
export function envelope(progress, releaseStart = .6) {
  if (progress <= 0 || progress >= 1) return 0;
  if (progress < .24) return smooth(progress / .24);
  if (progress > releaseStart) return smooth((1 - progress) / (1 - releaseStart));
  return 1;
}

// Uses an active-time clock supplied by the renderer. Scrolling away pauses time;
// returning never causes a burst of missed gestures. There are no speech channels.
export class IdleMotion {
  constructor(random = Math.random) {
    this.random = random;
    this.weights = new Float32Array(CH.length);
    this.moodWeights = new Float32Array(CH.length);
    this.randomMood = RANDOM_MOODS[Math.floor(random() * RANDOM_MOODS.length) % RANDOM_MOODS.length];
    this.mood = 'neutral';
    this.nextBlink = this.range(0.8, 5);
    this.nextGesture = this.range(.4, 1.8);
    this.blinkStart = -100;
    this.double = false;
    this.gesture = null;
    this.bag = [];
    this.lastGesture = null;
    this.lastHover = -100;
    this.hoverCount = 0;
    this.gestureCount = 0;
    this.lastTime = 0;
  }
  range(min, max) { return min + this.random() * (max - min); }
  pick() {
    if (!this.bag.length) {
      this.bag = [...GESTURES];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
      if (this.bag.at(-1).name === this.lastGesture) [this.bag[0], this.bag[this.bag.length - 1]] = [this.bag.at(-1), this.bag[0]];
    }
    const spec = this.bag.pop(); this.lastGesture = spec.name;
    return spec;
  }
  begin(time, source = 'idle') {
    const spec = this.pick();
    this.gesture = { spec, source, start: time, duration: this.range(...spec.duration), strength: source === 'hover' ? 1 : this.range(.9, 1) };
    this.nextGesture = time + this.gesture.duration + this.range(1.2, 3.2);
    this.gestureCount++;
  }
  react(time) {
    if (time - this.lastHover < 2.2) return false;
    this.lastHover = time; this.hoverCount++; this.begin(time, 'hover');
    return true;
  }
  sample(time, intensity = 0.65, mood = 'neutral') {
    const w = this.weights;
    w.fill(0);
    const dt = Math.max(0, Math.min(.25, time - this.lastTime)); this.lastTime = time;
    this.mood = mood === 'random' ? this.randomMood : Object.hasOwn(MOODS, mood) ? mood : 'neutral';
    if (intensity <= 0) return { weights: w, jaw: 0, twitch: 0 };
    const baseline = MOODS[this.mood].channels, ease = 1 - Math.exp(-dt * 5);
    for (let c = 0; c < CH.length; c++) {
      this.moodWeights[c] += ((baseline[CH[c]] || 0) - this.moodWeights[c]) * ease;
      w[c] = this.moodWeights[c] * intensity;
    }
    if (time >= this.nextBlink) {
      this.blinkStart = time;
      this.double = this.random() < 0.16;
      this.nextBlink = time + this.range(2.6, 7);
    }
    let bt = time - this.blinkStart;
    if (this.double && bt >= 0.27) bt -= 0.27;
    // A fast close, a tiny hold, and a softer reopening.
    const blink = bt < 0 || bt > 0.22 ? 0 : bt < 0.07 ? smooth(bt / 0.07) : bt < 0.1 ? 1 : 1 - smooth((bt - 0.1) / 0.12);
    w[C.blinkL] = Math.max(w[C.blinkL], blink); w[C.blinkR] = Math.max(w[C.blinkR], blink);
    if (time >= this.nextGesture) this.begin(time);
    let twitch = 0;
    if (this.gesture) {
      const g = this.gesture, progress = (time - g.start) / g.duration;
      // A nose twitch lifts quickly, then relaxes without a held pose or oscillation.
      const amount = envelope(progress, g.spec.twitch ? .24 : .6) * g.strength;
      // A transient expression temporarily overrides conflicting standing moods.
      for (let c = 0; c < CH.length; c++) if (!CH[c].startsWith('blink')) w[c] *= 1 - amount * .85;
      for (const [name, value] of Object.entries(g.spec.channels)) w[C[name]] += value * amount * intensity;
      if (g.spec.twitch) twitch = amount * intensity;
      if (progress >= 1) this.gesture = null;
    }
    for (const [name, gain] of PHOTO_GAIN) w[C[name]] *= gain;
    for (let c = 0; c < CH.length; c++) w[c] = Math.max(0, Math.min(CH[c].startsWith('blink') ? 1 : 1.15, w[c]));
    return { weights: w, jaw: 0, twitch };
  }
}
