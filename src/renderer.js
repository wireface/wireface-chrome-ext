import { canonicalRig } from '../vendor/wireface/core/canonical.js';
import { Pose, C } from '../vendor/wireface/core/rig.js';
import { prepareTransfer } from '../vendor/wireface/prepare-transfer.js';
import { Transfer } from '../vendor/wireface/transfer.js';
import { IdleMotion } from './idle.js';
import { faceBounds } from './geometry.js';
import { EyeGaze, eyeBasis } from './gaze.js';

const RIG = canonicalRig();
const TRIANGLES = new Uint16Array([...RIG.skin, ...RIG.caps.mouth]);
const EYES = { R: new Uint16Array(RIG.caps.eyeR), L: new Uint16Array(RIG.caps.eyeL) };
const edgeSet = new Set(), edges = [];
for (let i = 0; i < RIG.skin.length; i += 3) {
  for (const [a, b] of [[RIG.skin[i], RIG.skin[i + 1]], [RIG.skin[i + 1], RIG.skin[i + 2]], [RIG.skin[i + 2], RIG.skin[i]]]) {
    const key = Math.min(a, b) * 468 + Math.max(a, b);
    if (!edgeSet.has(key)) { edges.push(a, b); edgeSet.add(key); }
  }
}
const LINE_INDICES = new Uint16Array(edges);
const STILL = { yaw: 0, pitch: 0, roll: 0, y: 0 };

const VERTEX = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
in float aAlpha;
uniform vec4 uPlacement;
out vec2 vUV;
out float vAlpha;
void main() {
  vec2 p = aPosition * uPlacement.xy + uPlacement.zw;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
  vUV = aUV;
  vAlpha = aAlpha;
}`;
const FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D uImage;
uniform bool uWire;
uniform bool uEye;
uniform vec2 uEyeCenter;
uniform vec4 uEyeAxes;
uniform vec2 uIris;
uniform vec2 uGaze;
in vec2 vUV;
in float vAlpha;
out vec4 outColor;
void main() {
  vec2 uv = vUV;
  if (uEye) {
    mat2 basis = mat2(uEyeAxes.xy, uEyeAxes.zw);
    mat2 invBasis = inverse(basis);
    vec2 p = invBasis * (uv - uEyeCenter);
    vec2 iris = clamp(invBasis * (uIris - uEyeCenter), vec2(-0.3), vec2(0.3));
    vec2 q = p;
    // Inverse local warp moves the photographed iris/sclera while fixing the
    // corners and lid boundary. Drawing only the eye caps clips it to the lids,
    // including during a blink; no eyeballs are painted over closed eyelids.
    for (int i = 0; i < 5; i++) {
      float edge = max(0.0, 1.0 - q.x*q.x) * max(0.0, 1.0 - q.y*q.y);
      float focus = 1.0 - 0.15 * min(1.0, length(q - iris));
      q = p - uGaze * vec2(0.4, 0.32) * edge * focus;
    }
    uv = uEyeCenter + basis * q;
  }
  vec4 pixel = texture(uImage, uv);
  float a = smoothstep(0.0, 0.12, vAlpha) * pixel.a;
  outColor = uWire ? vec4(0.28, 1.0, 0.79, a * 0.52) : vec4(pixel.rgb, a);
}`;

function shader(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

export class FittedFace {
  constructor(points, aspect) {
    this.uvs = Float32Array.from(points.slice(0, 468).flat());
    this.transfer = new Transfer(prepareTransfer(RIG, this.uvs, aspect));
    this.pose = new Pose(RIG);
    this.idle = new IdleMotion();
    this.gaze = new EyeGaze();
    this.targetGaze = null;
    this.eyes = { R: eyeBasis(points, 'R', aspect), L: eyeBasis(points, 'L', aspect) };
    this.bounds = faceBounds(points.slice(0, 468));
    this.aspect = aspect;
    this.positions = new Float32Array(936);
    this.pose.apply(new Float32Array(RIG.channels.length), 0);
    this.neutral = this.transfer.apply(this.pose, { head: STILL, depth: 0, pin: 1 }).slice();
    this.alpha = Float32Array.from(RIG.masks.edge);
    this.mouth = [(points[13][0] + points[14][0]) / 2, (points[13][1] + points[14][1]) / 2];
    this.mouthRadius = [Math.max(.001, Math.abs(points[291][0] - points[61][0]) / 2), Math.max(.001, Math.abs(points[17][1] - points[0][1]) / 2)];
  }
  step(time, intensity, mood = 'neutral') {
    const motion = this.idle.sample(time, intensity, mood);
    this.gaze.sample(time, this.targetGaze, Math.min(1, intensity * 1.3));
    this.pose.apply(motion.weights, 0);
    const positions = this.transfer.apply(this.pose, { head: STILL, depth: 0, pin: 1 });
    const b = this.bounds, noseX = this.uvs[1 * 2], noseY = this.uvs[1 * 2 + 1];
    for (let i = 0; i < 468; i++) {
      const u = this.uvs[i * 2], v = this.uvs[i * 2 + 1];
      // The reference pose is subtracted so a neutral face exactly matches the
      // source photo, including rig eyelid collision corrections.
      let x = u + (positions[i * 2] - this.neutral[i * 2]) / this.aspect;
      let y = v + positions[i * 2 + 1] - this.neutral[i * 2 + 1];
      const distance = ((u - noseX) / Math.max(0.001, (b.right - b.left) * 0.13)) ** 2
        + ((v - noseY) / Math.max(0.001, (b.bottom - b.top) * 0.12)) ** 2;
      x += Math.exp(-distance * 1.7) * motion.twitch * (b.right - b.left) * 0.024;
      // Most of the 3D pout is forward (Z), which a flat photo transfer discards.
      // Give it an actual 2D silhouette: gently purse and thicken the lower lip.
      const lipRegion = Math.exp(-.5 * (((u - this.mouth[0]) / this.mouthRadius[0]) ** 2 + ((v - this.mouth[1]) / this.mouthRadius[1]) ** 2));
      const pout = motion.weights[C.pout] * Math.max(RIG.masks.lips[i], lipRegion);
      x -= (u - this.mouth[0]) * .30 * pout;
      y += ((v - this.mouth[1]) * .4 + (v > this.mouth[1] ? (b.bottom - b.top) * .012 : 0)) * pout;
      this.positions[i * 2] = x;
      this.positions[i * 2 + 1] = y;
    }
    return this.positions;
  }
}

// A single WebGL context serves every picture. Each visible image gets a small
// 2D presentation canvas, avoiding Chrome's per-page WebGL context limit.
export class PhotoRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!this.gl) throw new Error('Wireface needs WebGL 2. Enable graphics acceleration in Chrome.');
    const gl = this.gl;
    this.lost = false;
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; });
    const vs = shader(gl, gl.VERTEX_SHADER, VERTEX), fs = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    this.program = gl.createProgram();
    gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.linkProgram(this.program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    gl.useProgram(this.program);
    this.buffers = [];
    this.attributes = {};
    for (const [name, size] of [['aPosition', 2], ['aUV', 2], ['aAlpha', 1]]) {
      const buffer = gl.createBuffer(), location = gl.getAttribLocation(this.program, name);
      this.buffers.push(buffer); this.attributes[name] = buffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }
    this.indices = gl.createBuffer(); this.buffers.push(this.indices);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices);
    this.placement = gl.getUniformLocation(this.program, 'uPlacement');
    this.wire = gl.getUniformLocation(this.program, 'uWire');
    this.eyeUniforms = Object.fromEntries(['uEye', 'uEyeCenter', 'uEyeAxes', 'uIris', 'uGaze'].map(name => [name, gl.getUniformLocation(this.program, name)]));
    gl.uniform1i(gl.getUniformLocation(this.program, 'uImage'), 0);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.textures = new Set();
  }
  upload(image) {
    const gl = this.gl, texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.textures.add(texture);
    return texture;
  }
  release(texture) { if (texture) { this.gl.deleteTexture(texture); this.textures.delete(texture); } }
  draw(record, placement, width, height, settings, visibleFaces) {
    if (this.lost) throw new Error('Graphics context was lost. Use Scan again to restore Wireface.');
    const gl = this.gl;
    const scale = Math.min(devicePixelRatio || 1, 1.5, 1280 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindTexture(gl.TEXTURE_2D, record.texture);
    gl.uniform4f(this.placement, placement.width / width, placement.height / height, placement.x / width, placement.y / height);
    for (const face of visibleFaces) {
      for (const [name, data] of [['aPosition', face.step(record.time, settings.intensity, settings.mood || 'neutral')], ['aUV', face.uvs], ['aAlpha', face.alpha]]) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.attributes[name]); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      }
      gl.uniform1i(this.wire, 0);
      gl.uniform1i(this.eyeUniforms.uEye, 0);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, TRIANGLES, gl.STATIC_DRAW);
      gl.drawElements(gl.TRIANGLES, TRIANGLES.length, gl.UNSIGNED_SHORT, 0);
      gl.uniform1i(this.eyeUniforms.uEye, 1);
      gl.uniform2fv(this.eyeUniforms.uGaze, face.gaze.value);
      for (const side of ['R', 'L']) {
        const eye = face.eyes[side];
        gl.uniform2fv(this.eyeUniforms.uEyeCenter, eye.center);
        gl.uniform4fv(this.eyeUniforms.uEyeAxes, [...eye.axisX, ...eye.axisY]);
        gl.uniform2fv(this.eyeUniforms.uIris, eye.iris);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, EYES[side], gl.STATIC_DRAW);
        gl.drawElements(gl.TRIANGLES, EYES[side].length, gl.UNSIGNED_SHORT, 0);
      }
      gl.uniform1i(this.eyeUniforms.uEye, 0);
      if (settings.showMesh) {
        gl.uniform1i(this.wire, 1);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, LINE_INDICES, gl.STATIC_DRAW);
        gl.drawElements(gl.LINES, LINE_INDICES.length, gl.UNSIGNED_SHORT, 0);
      }
    }
    const canvas = record.canvas;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    record.context.clearRect(0, 0, w, h);
    record.context.drawImage(this.canvas, 0, 0);
  }
  destroy() {
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    for (const buffer of this.buffers) this.gl.deleteBuffer(buffer);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.textures.clear();
  }
}
