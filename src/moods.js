// Standing expressions only: no mood opens the jaw or starts speech.
export const MOODS = Object.freeze({
  neutral: { label: 'Neutral', channels: {} },
  happy: { label: 'Happy', channels: { smileL: .48, smileR: .48, squintL: .1, squintR: .1, browUpL: .08, browUpR: .08 } },
  cheeky: { label: 'Cheeky', channels: { smileL: .12, smileR: .55, browUpL: .28, squintR: .1 } },
  curious: { label: 'Curious', channels: { browUpL: .5, browUpR: .18, eyeWideL: .08, eyeWideR: .08, smileR: .12 } },
  calm: { label: 'Calm', channels: { smileL: .16, smileR: .16, blinkL: .06, blinkR: .06 } },
  thoughtful: { label: 'Thoughtful', channels: { browUpR: .3, browDown: .12, pout: .28 } },
  sleepy: { label: 'Sleepy', channels: { blinkL: .38, blinkR: .38, browInner: .12, pout: .1 } },
  grumpy: { label: 'Grumpy', channels: { browDown: .45, frown: .3, pout: .25, squintL: .08, squintR: .08 } },
});
export const RANDOM_MOODS = Object.keys(MOODS).filter(name => name !== 'neutral');
export const MOOD_CHOICES = ['random', ...Object.keys(MOODS)];

// Stable during eviction/re-detection; changing the seed reshuffles everyone.
export function randomMoodFor(identity, seed = 0) {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const c of identity) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x45d9f3b) >>> 0; hash ^= hash >>> 16;
  return RANDOM_MOODS[(hash >>> 0) % RANDOM_MOODS.length];
}
