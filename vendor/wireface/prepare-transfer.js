/*! Wireface | Required Notice: Copyright 2026 Compsmart (https://wireface.dev) | Wireface SDK Licence; free local use including commercial: https://wireface.dev/license/ */
// From the 3D rig to the flat picture. Core's rig poses the canonical mesh in its own units (roughly centimetres, y
// up); here each vertex's movement away from rest is carried onto the picture through its own 2x2 Jacobian: how the
// canonical face's surroundings of that vertex map onto the picture's. So a drawn face whose eyes are three times
// the usual height blinks shut properly, and a wide cartoon mouth opens to its own width.
//
// Three more things make a flat picture behave:
//   - its lips are sealed first (moved together along the seam; the texture stays put), as the rig's are, so the
//     mouth opens from closed even if it is open in the picture;
//   - vertices near the face's outline are pinned to the picture (edge_pin), so the jaw and the head's sway don't
//     drag the outline off the background behind it (a ghost chin);
//   - the head's turn only moves it by `depth` (0 = flat), and lighting changes are relative to rest, so at rest the
//     picture is exactly itself.
import { POSITIONS, TRIANGLES } from './core/mesh-data.js';
import { CH, Pose, RING } from './core/rig.js';

export const NECK = [0, -4.5, -3.1863];            // where the head turns about (as core's view)
const UPPER_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const LOWER_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
const LIGHT = [-0.25, 0.4, 0.8836];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Each vertex's neighbours over the mesh's edges. */
export function neighbours(n = POSITIONS.length / 3, tris = TRIANGLES) {
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  return nb.map(s => [...s]);
}

/**
 * Close the picture's lips: each pair of inner-lip points meets in the middle, and the lip around it follows.
 * `q` is flat [x, y] in aspect-true units; returns a sealed copy and how open the lips were (in eye distances).
 */
export function sealLips(q, eyeDist = 1) {
  const out = q.slice();
  const gaps = UPPER_IN.map((u, k) => [q[u * 2] - q[LOWER_IN[k] * 2], q[u * 2 + 1] - q[LOWER_IN[k] * 2 + 1]]);
  const open = Math.max(...gaps.map(g => Math.hypot(g[0], g[1]))) / eyeDist;
  if (open < 0.004) return { sealed: out, open };
  const n = POSITIONS.length / 3, P = i => [POSITIONS[i * 3], POSITIONS[i * 3 + 1]];
  const halfW = Math.abs(POSITIONS[291 * 3] - POSITIONS[61 * 3]) / 2;
  for (let i = 0; i < n; i++) {
    const [x, y] = P(i);
    if (Math.abs(x) > halfW * 1.3) continue;
    let best = null, bd = Infinity;            // nearest inner-lip point on the unsealed canonical face
    for (let k = 1; k < UPPER_IN.length - 1; k++) {
      for (const [ring, side] of [[UPPER_IN, -0.5], [LOWER_IN, 0.5]]) {
        const [rx, ry] = P(ring[k]), d = Math.hypot(x - rx, y - ry);
        if (d < bd) { bd = d; best = { k, side }; }
      }
    }
    const w = Math.exp(-((bd / 0.6979) ** 2)) * (1 - smooth(halfW * 0.95, halfW * 1.2978, Math.abs(x)));
    if (w < 1e-3) continue;
    const g = gaps[best.k];
    out[i * 2] += g[0] * best.side * w;
    out[i * 2 + 1] += g[1] * best.side * w;
  }
  return { sealed: out, open };
}

const inv2 = m => {
  const det = m[0] * m[3] - m[1] * m[2];
  return Math.abs(det) < 1e-12 ? null : [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
};
const mul2 = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]];

/**
 * Per-vertex 2x2 Jacobians [a, b, c, d] (picture = J * canonical, for small moves) fitted by least squares over each
 * vertex's two-ring, pulled towards the whole face's mapping where the neighbourhood says little, then smoothed.
 * `base` is canonical [x, y, z] per vertex, `q` the picture's [x, y].
 */
export function jacobians(base, q, nb = neighbours()) {
  const n = q.length / 2;
  // the whole face's linear map, about the centroids
  let cb = [0, 0], cq = [0, 0];
  for (let i = 0; i < n; i++) { cb[0] += base[i * 3]; cb[1] += base[i * 3 + 1]; cq[0] += q[i * 2]; cq[1] += q[i * 2 + 1]; }
  cb = cb.map(v => v / n); cq = cq.map(v => v / n);
  const A = [0, 0, 0, 0], M = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const px = base[i * 3] - cb[0], py = base[i * 3 + 1] - cb[1], qx = q[i * 2] - cq[0], qy = q[i * 2 + 1] - cq[1];
    A[0] += qx * px; A[1] += qx * py; A[2] += qy * px; A[3] += qy * py;
    M[0] += px * px; M[1] += px * py; M[2] += py * px; M[3] += py * py;
  }
  const global = mul2(A, inv2(M) || [1, 0, 0, 1]);
  const ring2 = nb.map((first, i) => {
    const s = new Set(first);
    for (const j of first) for (const k of nb[j]) if (k !== i) s.add(k);
    return [...s];
  });
  let J = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = [0, 0, 0, 0], m = [0, 0, 0, 0];
    let spread = 0;
    for (const j of ring2[i]) {
      const px = base[j * 3] - base[i * 3], py = base[j * 3 + 1] - base[i * 3 + 1];
      const qx = q[j * 2] - q[i * 2], qy = q[j * 2 + 1] - q[i * 2 + 1];
      const w = 1 / (0.19999 + Math.hypot(px, py));                 // nearer neighbours count for more
      a[0] += w * qx * px; a[1] += w * qx * py; a[2] += w * qy * px; a[3] += w * qy * py;
      m[0] += w * px * px; m[1] += w * px * py; m[2] += w * py * px; m[3] += w * py * py;
      spread += w * (px * px + py * py);
    }
    const lam = 0.07992 * spread / Math.max(1, ring2[i].length);  // regulariser, in the same units as m
    const reg = [a[0] + lam * global[0], a[1] + lam * global[1], a[2] + lam * global[2], a[3] + lam * global[3]];
    const inv = inv2([m[0] + lam, m[1], m[2], m[3] + lam]);
    J.set(inv ? mul2(reg, inv) : global, i * 4);
  }
  for (let pass = 0; pass < 2; pass++) {                         // a little smoothing, so neighbours move together
    const next = new Float32Array(J.length);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) {
        let s = J[i * 4 + k] * 2;
        for (const j of nb[i]) s += J[j * 4 + k];
        next[i * 4 + k] = s / (2 + nb[i].length);
      }
    }
    J = next;
  }
  return { J, global };
}

/** Each vertex's distance from the mesh's outline, over its edges, in the units of `q`. */
export function edgeDistances(q, tris = TRIANGLES, nb = neighbours()) {
  const n = q.length / 2, count = new Map();
  for (let t = 0; t < tris.length; t += 3) {
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const u = tris[t + a], v = tris[t + b], k = u < v ? u * 1000 + v : v * 1000 + u;
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  const dist = new Float32Array(n).fill(Infinity), open = [];
  for (const [k, c] of count) {
    if (c !== 1) continue;
    for (const v of [Math.floor(k / 1000), k % 1000]) if (dist[v]) { dist[v] = 0; open.push(v); }
  }
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
    const v = open.splice(bi, 1)[0];
    for (const w of nb[v]) {
      const d = dist[v] + Math.hypot(q[w * 2] - q[v * 2], q[w * 2 + 1] - q[v * 2 + 1]);
      if (d < dist[w]) { if (dist[w] === Infinity) open.push(w); dist[w] = d; }
    }
  }
  return dist;
}

function centre(flat, idx, stride) {
  const c = [0, 0];
  for (const i of idx) { c[0] += flat[i * stride]; c[1] += flat[i * stride + 1]; }
  return [c[0] / idx.length, c[1] / idx.length];
}

export function prepareTransfer(rig, uvs, aspect) {
  const data = {};
    const n = rig.count;
    data.n = n;
    // the rig at rest, as Pose leaves it (it nudges a few eyelid vertices off rig.base): movement is measured from here
    const still = new Pose(rig);
    still.apply(new Float32Array(CH.length), 0);
    rig = { ...rig, base: still.pos.slice() };
    data.aspect = aspect;
    data.uvs = uvs;
    const q = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { q[i * 2] = uvs[i * 2] * aspect; q[i * 2 + 1] = uvs[i * 2 + 1]; }
    const eyeL = centre(q, RING.eyeR, 2), eyeR = centre(q, RING.eyeL, 2);
    data.eyeDist = Math.hypot(eyeR[0] - eyeL[0], eyeR[1] - eyeL[1]) || 0.1;
    const { sealed, open } = sealLips(q, data.eyeDist);
    data.rest = sealed;
    data.mouthWasOpen = open;
    const nb = neighbours(n);
    const { J, global } = jacobians(rig.base, sealed, nb);
    data.J = J;
    data.unit = Math.sqrt(Math.abs(global[0] * global[3] - global[1] * global[2]));   // picture units per rig unit
    data.edge = edgeDistances(sealed, TRIANGLES, nb).map(d => d / data.eyeDist);     // in eye distances
    // the inner mouth is drawn rigidly, with the lips' own mapping
    const lips = RING.lipsIn;
    data.mouthQ = centre(sealed, lips, 2);
    data.mouthB = centre(rig.base, lips, 3);
    const Jm = [0, 0, 0, 0];
    for (const i of lips) for (let k = 0; k < 4; k++) Jm[k] += J[i * 4 + k] / lips.length;
    data.mouthJ = Jm;
    // rest lighting, so lighting only ever changes relative to the picture's own
    data.base = rig.base;
    data.restLight = Float32Array.from({ length: n }, (_, i) => Math.max(0,
      still.nrm[i * 3] * LIGHT[0] + still.nrm[i * 3 + 1] * LIGHT[1] + still.nrm[i * 3 + 2] * LIGHT[2]));
  return data;
}
