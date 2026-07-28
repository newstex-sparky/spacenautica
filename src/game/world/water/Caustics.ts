import * as THREE from 'three';
import { NOISE_GLSL } from '../../core/Noise';

/**
 * Procedural caustics by photon gathering.
 *
 * A bank of capillary/short gravity waves is built on an integer lattice of a
 * 48 m tile, so the field — and therefore the texture — is *exactly* seamless.
 * For every texel we refract the sun through the analytic surface normal,
 * project the refracted ray onto a receiver plane and measure the Jacobian
 * determinant of that mapping. Intensity is 1/|det|: where neighbouring photons
 * converge, the determinant collapses and you get the sharp bright filaments
 * real caustics are made of. Three slightly different indices of refraction
 * produce the chromatic fringing at filament edges.
 *
 * This is not a scrolling texture: the pattern is regenerated every frame from
 * the live wave field and sun direction.
 */

const G = 9.81;
const TILE = 48;
const LATTICE: Array<[number, number]> = [
  [3, 1],
  [-2, 4],
  [5, -2],
  [4, 5],
  [7, 3],
  [-6, 6],
  [9, -4],
  [11, 7],
];
const CWAVES = LATTICE.length;

const FRAG = /* glsl */ `
precision highp float;

uniform vec3  uSunDir;
uniform float uTime;
uniform vec4  uCA[${CWAVES}];   // Kx, Kz, amplitude, omega
uniform float uTexel;           // world metres per texel
uniform float uDepth;           // reference receiver depth in metres
uniform float uGain;
uniform vec2  uEta;             // (base eta, chromatic spread)

varying vec2 vUv;

${NOISE_GLSL}

/** Analytic surface height + normal of the periodic ripple bank. */
void surf(vec2 p, out float h, out vec3 n) {
  h = 0.0;
  vec2 g = vec2(0.0);
  for (int i = 0; i < ${CWAVES}; i++) {
    vec4 w = uCA[i];
    float f = dot(w.xy, p) - w.w * uTime;
    h += w.z * sin(f);
    g += w.xy * (w.z * cos(f));
  }
  n = normalize(vec3(-g.x, 1.0, -g.y));
}

/** Where a photon landing on the surface at 'p' hits the receiver plane. */
vec2 land(vec2 p, float h, vec3 n, vec3 inDir, float eta, float depth) {
  vec3 rd = refract(inDir, n, eta);
  if (rd.y > -0.02) return p;                 // grazing / TIR guard
  float t = (depth + h) / (-rd.y);
  return p + rd.xz * t;
}

float channel(vec2 p0, float h0, vec3 n0,
              vec2 px, float hx, vec3 nx,
              vec2 pz, float hz, vec3 nz,
              vec3 inDir, float eta, float eps, float soft) {
  vec2 q0 = land(p0, h0, n0, inDir, eta, uDepth);
  vec2 qx = land(px, hx, nx, inDir, eta, uDepth);
  vec2 qz = land(pz, hz, nz, inDir, eta, uDepth);
  vec2 dx = (qx - q0) / eps;
  vec2 dz = (qz - q0) / eps;
  float det = abs(dx.x * dz.y - dx.y * dz.x);
  return 1.0 / (det + soft);
}

void main() {
  vec2 p = vUv * ${TILE.toFixed(1)};
  // Sun elevation clamped: a sun on the horizon would smear the pattern to
  // infinity, which is physically true and visually useless.
  vec3 sd = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.26), uSunDir.z));
  vec3 inDir = -sd;

  // Finite-difference step tied to the texel footprint: this band-limits the
  // result, which is what keeps the filaments from aliasing into fireflies.
  float eps = max(uTexel * 1.35, 0.02);
  float soft = 0.055 + uTexel * 0.05;

  float h0, hx, hz;
  vec3 n0, nx, nz;
  surf(p, h0, n0);
  surf(p + vec2(eps, 0.0), hx, nx);
  surf(p + vec2(0.0, eps), hz, nz);

  float er = uEta.x - uEta.y;
  float eg = uEta.x;
  float eb = uEta.x + uEta.y;

  vec3 c = vec3(
    channel(p, h0, n0, p + vec2(eps, 0.0), hx, nx, p + vec2(0.0, eps), hz, nz, inDir, er, eps, soft),
    channel(p, h0, n0, p + vec2(eps, 0.0), hx, nx, p + vec2(0.0, eps), hz, nz, inDir, eg, eps, soft),
    channel(p, h0, n0, p + vec2(eps, 0.0), hx, nx, p + vec2(0.0, eps), hz, nz, inDir, eb, eps, soft)
  );

  // Micro layer: cell-edge ridges from a seamless voronoi (integer scale keeps
  // the tile joint invisible) add the fine crawling structure between filaments.
  vec3 vo = voronoi(vUv * 12.0 + vec2(uTime * 0.05, uTime * -0.037));
  float ridge = smoothstep(0.0, 0.32, vo.y - vo.x);
  c *= 0.82 + 0.42 * ridge;

  gl_FragColor = vec4(clamp(c * uGain, 0.0, 8.0), 1.0);
}
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export class CausticsRenderer {
  readonly tileSize = TILE;
  private rt: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private size: number;

  constructor(size: number) {
    this.size = size;
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.rt.texture.wrapS = THREE.RepeatWrapping;
    this.rt.texture.wrapT = THREE.RepeatWrapping;
    this.rt.texture.name = 'water.caustics';

    const ca = new Float32Array(CWAVES * 4);
    for (let i = 0; i < CWAVES; i++) {
      const n = LATTICE[i];
      const kx = (Math.PI * 2 * n[0]) / TILE;
      const kz = (Math.PI * 2 * n[1]) / TILE;
      const k = Math.hypot(kx, kz);
      const lambda = (Math.PI * 2) / k;
      const amp = 0.1 * Math.pow(lambda / 15.2, 0.85);
      ca[i * 4] = kx;
      ca[i * 4 + 1] = kz;
      ca[i * 4 + 2] = amp;
      ca[i * 4 + 3] = Math.sqrt(G * k);
    }

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.3) },
        uTime: { value: 0 },
        uCA: { value: ca },
        uTexel: { value: TILE / size },
        uDepth: { value: 12 },
        uGain: { value: 1 },
        uEta: { value: new THREE.Vector2(0.7502, 0.004) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  get texture(): THREE.Texture {
    return this.rt.texture;
  }

  /** Regenerates the tile. Call once per frame (or every other frame on low). */
  render(renderer: THREE.WebGLRenderer, time: number, sunDir: THREE.Vector3, gain: number): void {
    const u = this.mat.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    u.uTime.value = time;
    u.uGain.value = gain;

    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = prevXr;
  }

  dispose(): void {
    this.rt.dispose();
    this.mat.dispose();
    this.quad.geometry.dispose();
  }
}
