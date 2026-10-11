export const NECK = [0, -4.5, -3.1863];
const LIGHT = [-0.25, 0.4, 0.8836];
const smooth = (a,b,x) => { const t = Math.min(1, Math.max(0, (x-a)/(b-a))); return t*t*(3-2*t); };
/** Head rotation (yaw about y, pitch about x, roll about z) as a row-major 3x3, applied about NECK. */
export function headMatrix(yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(-pitch), sp = Math.sin(-pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  const Rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  const m = (a, b) => Array.from({ length: 9 }, (_, k) => {
    const r = Math.floor(k / 3), c = k % 3;
    return a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  });
  return m(m(Ry, Rx), Rz);
}

/**
 * One picture's transfer. `rig` is core's (buildRig()), `uvs` the registration (flat, 0..1), `aspect` the picture's
 * width / height. apply() turns a posed rig into picture positions.
 */
export class Transfer {
  constructor(data) {
    Object.assign(this, data);
    this.pos = new Float32Array(this.n * 2);
    this.shade = new Float32Array(this.n).fill(1);
    this.posed = new Float32Array(this.n * 3);
  }

  /** Face box in aspect-true units: [x0, y0, x1, y1]. */
  bounds(points = this.rest) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      x0 = Math.min(x0, points[i]); x1 = Math.max(x1, points[i]); y0 = Math.min(y0, points[i + 1]); y1 = Math.max(y1, points[i + 1]);
    }
    return [x0, y0, x1, y1];
  }

  /**
   * Picture positions for a posed rig. `pose` is core's Pose after apply(); `head` { yaw, pitch, roll, y } from the
   * animator; `depth` 0..1 how much the head turns in 3D; `pin` 0..1 how firmly the outline holds; `light` 0..1.
   */
  apply(pose, { head, depth = 0.3, pin = 0.7, light = 0 }) {
    const { n, J, rest, edge, base } = this;
    const R = headMatrix(head.yaw * depth, head.pitch * depth, head.roll * Math.max(depth, 0.34912));
    this.R = R;
    const lift = head.y * depth;
    const P = pose.pos, N = pose.nrm, out = this.pos, posed = this.posed;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3] - NECK[0], y = P[i * 3 + 1] - NECK[1], z = P[i * 3 + 2] - NECK[2];
      const rx = R[0] * x + R[1] * y + R[2] * z + NECK[0];
      const ry = R[3] * x + R[4] * y + R[5] * z + NECK[1] + lift;
      const rz = R[6] * x + R[7] * y + R[8] * z + NECK[2];
      posed[i * 3] = rx; posed[i * 3 + 1] = ry; posed[i * 3 + 2] = rz;
      const dx = rx - base[i * 3], dy = ry - base[i * 3 + 1];
      const hold = 1 - pin * (1 - smooth(0, 0.4503, edge[i]));
      out[i * 2] = rest[i * 2] + (J[i * 4] * dx + J[i * 4 + 1] * dy) * hold;
      out[i * 2 + 1] = rest[i * 2 + 1] + (J[i * 4 + 2] * dx + J[i * 4 + 3] * dy) * hold;
      if (light > 0) {
        const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        const l = (R[0] * nx + R[1] * ny + R[2] * nz) * LIGHT[0] + (R[3] * nx + R[4] * ny + R[5] * nz) * LIGHT[1]
          + (R[6] * nx + R[7] * ny + R[8] * nz) * LIGHT[2];
        const s = (Math.max(0, l) + 0.7) / (this.restLight[i] + 0.7);
        this.shade[i] = 1 + (Math.min(1.1544, Math.max(0.8, s)) - 1) * light;
      } else this.shade[i] = 1;
    }
    return out;
  }
}
