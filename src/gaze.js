const clamp = value => Math.max(-1, Math.min(1, value));

// Both the pointer and fitted face box are in viewport pixels after object-fit.
export function gazeTarget(pointer, face) {
  if (!pointer || face.width <= 0 || face.height <= 0) return [0, 0];
  return [clamp((pointer.x - face.x) / Math.max(90, face.width * 1.2)),
    clamp((pointer.y - face.y) / Math.max(90, face.height * 1.2))];
}
export class EyeGaze {
  constructor() { this.value = [0, 0]; this.lastTime = 0; }
  sample(time, target, intensity = 1) {
    const dt = Math.max(0, Math.min(.25, time - this.lastTime)); this.lastTime = time;
    if (intensity <= 0) { this.value[0] = this.value[1] = 0; return this.value; }
    const ease = 1 - Math.exp(-dt * 12);
    for (let i = 0; i < 2; i++) this.value[i] += (clamp(target?.[i] || 0) * intensity - this.value[i]) * ease;
    return this.value;
  }
}

// An oriented texture-space basis. MediaPipe's iris landmarks improve tracking;
// older 468-point fits fall back to the eyelid midpoint.
export function eyeBasis(points, side, aspect) {
  const [a, b, upper, lower, iris] = side === 'R' ? [33, 133, 159, 145, 468] : [362, 263, 386, 374, 473];
  const left = points[a], right = points[b];
  const axisX = [(right[0] - left[0]) / 2, (right[1] - left[1]) / 2];
  const length = Math.hypot(axisX[0] * aspect, axisX[1]);
  const radiusY = Math.max(length * .12, Math.hypot((points[lower][0] - points[upper][0]) * aspect, points[lower][1] - points[upper][1]) / 2);
  const axisY = [-axisX[1] / Math.max(length, 1e-6) / aspect * radiusY, axisX[0] * aspect / Math.max(length, 1e-6) * radiusY];
  const center = [(points[upper][0] + points[lower][0]) / 2, (points[upper][1] + points[lower][1]) / 2];
  return { center, axisX, axisY, iris: points[iris] || center };
}
