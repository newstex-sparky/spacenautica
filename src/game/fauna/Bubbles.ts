/**
 * Gill bubbles.
 *
 * A small pooled point sprite system. Bubbles are emitted from a creature's
 * gill slit, rise with buoyancy, wobble on the local current and pop at the
 * surface. The sprite itself is a procedural DataTexture: a refractive rim with
 * a bright top-left specular pip, which is what makes a 6-pixel dot read as a
 * bubble rather than a white blob.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aFade;
uniform float uPixelScale;
varying float vFade;
varying float vDist;
void main() {
  vFade = aFade;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.5, aSize * uPixelScale / max(vDist, 0.15));
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uSprite;
uniform vec3 uwExtinction;
uniform vec3 uwInscatter;
uniform float uwDensity;
varying float vFade;
varying float vDist;
void main() {
  vec4 s = texture2D(uSprite, gl_PointCoord);
  if (s.a < 0.01) discard;
  vec3 c = s.rgb;
  vec3 tr = exp(-uwExtinction * vDist * uwDensity);
  c = c * tr + uwInscatter * (1.0 - tr) * 0.6;
  gl_FragColor = vec4(c, s.a * vFade);
}
`;

function makeSprite(size: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const h = size * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - h) / h;
      const dy = (y + 0.5 - h) / h;
      const r = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;
      if (r > 1) continue;
      // Thin refractive rim, near-transparent centre.
      const rim = Math.pow(Math.max(0, 1 - Math.abs(r - 0.86) / 0.16), 1.6);
      const body = (1 - r * r) * 0.16;
      // Specular pip, upper-left, plus a dim caustic pip lower-right.
      const s1 = Math.exp(-(((dx + 0.34) ** 2 + (dy + 0.34) ** 2) / 0.018));
      const s2 = Math.exp(-(((dx - 0.3) ** 2 + (dy - 0.36) ** 2) / 0.05)) * 0.35;
      const a = Math.min(1, rim * 0.85 + body + s1 * 0.9 + s2 * 0.4);
      const l = Math.min(1, 0.55 + rim * 0.5 + s1 * 1.4 + s2 * 0.5);
      data[i] = Math.round(255 * Math.min(1, l * 0.92));
      data[i + 1] = Math.round(255 * Math.min(1, l * 0.98));
      data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export class Bubbles {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private sprite: THREE.DataTexture;
  private posAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private fadeAttr: THREE.BufferAttribute;

  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private cursor = 0;
  private readonly cap: number;

  constructor(capacity: number, shared: Record<string, THREE.IUniform>) {
    this.cap = capacity;
    this.geo = new THREE.BufferGeometry();
    const pos = new Float32Array(capacity * 3);
    const size = new Float32Array(capacity);
    const fade = new Float32Array(capacity);
    // Park everything far below the world until it is used.
    for (let i = 0; i < capacity; i++) pos[i * 3 + 1] = -100000;
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.sizeAttr = new THREE.BufferAttribute(size, 1);
    this.fadeAttr = new THREE.BufferAttribute(fade, 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.fadeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aSize', this.sizeAttr);
    this.geo.setAttribute('aFade', this.fadeAttr);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);

    this.sprite = makeSprite(48);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSprite: { value: this.sprite },
        uPixelScale: { value: 700 },
        uwExtinction: shared.uwExtinction ?? { value: new THREE.Vector3(0.42, 0.09, 0.045) },
        uwInscatter: shared.uwInscatter ?? { value: new THREE.Color(0.06, 0.3, 0.38) },
        uwDensity: shared.uwDensity ?? { value: 1 },
      },
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geo, this.mat);
    this.points.name = 'fauna.bubbles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  resize(height: number): void {
    this.mat.uniforms.uPixelScale.value = height * 0.62;
  }

  emit(x: number, y: number, z: number, radius: number, rise: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const p = this.posAttr.array as Float32Array;
    p[i * 3] = x;
    p[i * 3 + 1] = y;
    p[i * 3 + 2] = z;
    this.vel[i * 3] = (Math.random() - 0.5) * 0.12;
    this.vel[i * 3 + 1] = rise * (0.7 + Math.random() * 0.6);
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
    (this.sizeAttr.array as Float32Array)[i] = radius * (0.6 + Math.random() * 0.8);
    (this.fadeAttr.array as Float32Array)[i] = 1;
    this.maxLife[i] = 3.5 + Math.random() * 3.5;
    this.life[i] = this.maxLife[i];
  }

  update(dt: number, time: number, surfaceY: number): void {
    const p = this.posAttr.array as Float32Array;
    const f = this.fadeAttr.array as Float32Array;
    let live = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      live = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      // Wobble: bubbles spiral as they rise.
      const w = time * 2.6 + i * 1.7;
      p[i3] += (this.vel[i3] + Math.sin(w) * 0.09) * dt;
      p[i3 + 1] += this.vel[i3 + 1] * dt;
      p[i3 + 2] += (this.vel[i3 + 2] + Math.cos(w * 0.8) * 0.09) * dt;
      this.vel[i3 + 1] = Math.min(this.vel[i3 + 1] + 0.35 * dt, 1.4);
      const t = this.life[i] / this.maxLife[i];
      f[i] = Math.min(1, t * 3) * Math.min(1, (1 - t) * 8 + 0.15);
      if (p[i3 + 1] > surfaceY - 0.05 || this.life[i] <= 0) {
        this.life[i] = 0;
        f[i] = 0;
        p[i3 + 1] = -100000;
      }
    }
    if (live) {
      this.posAttr.needsUpdate = true;
      this.fadeAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
    }
    this.points.visible = live;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.sprite.dispose();
  }
}
