/**
 * Sum-of-Gerstner-waves ocean spectrum, shared between the CPU (physics,
 * `surfaceHeightAt`) and the GPU (surface vertex shader) so the mesh you see
 * and the height the player floats on are the same field.
 *
 * The bank is a decaying geometric series of wavelengths (macro swell -> chop)
 * spread around the wind direction, with deep-water dispersion
 * (omega = sqrt(g*k)) so long waves genuinely travel faster than short ones.
 */

export const WAVE_COUNT = 10;

const G = 9.81;

/** Base wavelengths in metres, longest first. Macro -> mid -> chop. */
const WAVELENGTHS = [168, 96, 61, 38, 24, 15.5, 9.8, 6.2, 3.9, 2.5];
/** Calm-sea amplitudes in metres. Sum ~1.39 m => ~2.8 m crest-to-trough. */
const AMPLITUDES = [0.42, 0.3, 0.22, 0.15, 0.1, 0.068, 0.045, 0.03, 0.02, 0.013];
/** Deterministic directional spread (radians) and phase offsets per component. */
const SPREAD = [0.0, -0.31, 0.44, -0.58, 0.71, -0.86, 1.02, -1.14, 1.27, -1.36];
const PHASE = [0.0, 1.71, 4.12, 2.63, 5.44, 0.87, 3.29, 5.98, 2.15, 4.71];

/**
 * Packed Gerstner wave bank.
 *
 * `packA[i] = (dirX, dirZ, amplitude, wavenumber)`
 * `packB[i] = (omega, choppiness Q, phase, wavelength)`
 *
 * Both are plain `Float32Array`s so they can be handed straight to a
 * `uniform vec4 uWaveA[WAVE_COUNT]` with zero per-frame allocation.
 */
export class WaveField {
  readonly packA = new Float32Array(WAVE_COUNT * 4);
  readonly packB = new Float32Array(WAVE_COUNT * 4);

  /** Wind heading in radians (direction the waves travel toward). */
  windAngle = 0.7;
  /** 0..1 storm factor from `world.sky`. Scales amplitude, chop and spread. */
  storm = 0;
  /** Global amplitude scale, dropped to 0 when the ocean is disabled. */
  scale = 1;

  /** Largest possible surface elevation, used for camera/AABB safety margins. */
  maxAmplitude = 1.4;

  constructor() {
    this.configure(this.windAngle, 0);
  }

  /** Rebuilds the bank. Cheap enough to call every frame. */
  configure(windAngle: number, storm: number): void {
    this.windAngle = windAngle;
    this.storm = storm;

    const ampScale = this.scale * (1 + 1.65 * storm);
    // Total horizontal steepness must stay < 1 or the crests self-intersect.
    const chop = 0.52 + 0.34 * storm;
    let ampSum = 0;

    for (let i = 0; i < WAVE_COUNT; i++) {
      const lambda = WAVELENGTHS[i] * (1 - 0.18 * storm);
      const k = (Math.PI * 2) / lambda;
      const amp = AMPLITUDES[i] * ampScale;
      // Short waves spread wider around the wind than long swell does.
      const a = windAngle + SPREAD[i] * (0.55 + 0.45 * storm);
      const omega = Math.sqrt(G * k);
      // q * amp * k summed over all waves == chop, so chop is the real steepness.
      const q = chop / (amp * k * WAVE_COUNT);

      const o = i * 4;
      this.packA[o] = Math.cos(a);
      this.packA[o + 1] = Math.sin(a);
      this.packA[o + 2] = amp;
      this.packA[o + 3] = k;
      this.packB[o] = omega;
      this.packB[o + 1] = q;
      this.packB[o + 2] = PHASE[i];
      this.packB[o + 3] = lambda;
      ampSum += amp;
    }
    this.maxAmplitude = ampSum;
  }

  /**
   * Surface elevation at a world XZ. Gerstner waves displace horizontally, so
   * this inverts the mapping with two fixed-point iterations — accurate to a
   * few centimetres, which is well under swim-controller tolerance.
   */
  heightAt(x: number, z: number, t: number): number {
    let px = x;
    let pz = z;
    for (let iter = 0; iter < 2; iter++) {
      let dx = 0;
      let dz = 0;
      for (let i = 0; i < WAVE_COUNT; i++) {
        const o = i * 4;
        const dirX = this.packA[o];
        const dirZ = this.packA[o + 1];
        const amp = this.packA[o + 2];
        const k = this.packA[o + 3];
        const f = k * (dirX * px + dirZ * pz) - this.packB[o] * t + this.packB[o + 2];
        const qa = this.packB[o + 1] * amp * Math.cos(f);
        dx += dirX * qa;
        dz += dirZ * qa;
      }
      px = x - dx;
      pz = z - dz;
    }
    let y = 0;
    for (let i = 0; i < WAVE_COUNT; i++) {
      const o = i * 4;
      const f =
        this.packA[o + 3] * (this.packA[o] * px + this.packA[o + 1] * pz) -
        this.packB[o] * t +
        this.packB[o + 2];
      y += this.packA[o + 2] * Math.sin(f);
    }
    return y;
  }

  /** Surface normal at a world XZ, written into `out`. */
  normalAt(x: number, z: number, t: number, out: { x: number; y: number; z: number }): void {
    let dydx = 0;
    let dydz = 0;
    for (let i = 0; i < WAVE_COUNT; i++) {
      const o = i * 4;
      const dirX = this.packA[o];
      const dirZ = this.packA[o + 1];
      const amp = this.packA[o + 2];
      const k = this.packA[o + 3];
      const f = k * (dirX * x + dirZ * z) - this.packB[o] * t + this.packB[o + 2];
      const c = Math.cos(f) * amp * k;
      dydx += dirX * c;
      dydz += dirZ * c;
    }
    const len = Math.hypot(dydx, 1, dydz);
    out.x = -dydx / len;
    out.y = 1 / len;
    out.z = -dydz / len;
  }
}

/**
 * GLSL twin of `WaveField`. Provides:
 *
 *   `void gerstner(vec2 p, float t, float fade, out vec3 disp, out vec3 nrm, out float jac)`
 *
 * `fade` scales displacement to zero toward the horizon so the far mesh stays
 * flat (and the horizon line stays quiet), while normals keep their full
 * strength for distant sun glitter.
 */
export const GERSTNER_GLSL = /* glsl */ `
#define WAVE_COUNT ${WAVE_COUNT}
uniform vec4 uWaveA[WAVE_COUNT];   // dirX, dirZ, amplitude, wavenumber
uniform vec4 uWaveB[WAVE_COUNT];   // omega, choppiness, phase, wavelength

void gerstner(vec2 p, float t, float fade, out vec3 disp, out vec3 nrm, out float jac) {
  disp = vec3(0.0);
  float dxdx = 0.0;
  float dxdz = 0.0;
  float dzdz = 0.0;
  vec2  dydp = vec2(0.0);

  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 A = uWaveA[i];
    vec4 B = uWaveB[i];
    vec2 d = A.xy;
    float amp = A.z * fade;
    float k = A.w;
    float f = k * dot(d, p) - B.x * t + B.z;
    float s = sin(f);
    float c = cos(f);

    disp.xz += (B.y * amp * c) * d;
    disp.y  += amp * s;

    float qak = B.y * amp * k;
    dxdx -= qak * d.x * d.x * s;
    dxdz -= qak * d.x * d.y * s;
    dzdz -= qak * d.y * d.y * s;
    dydp += (amp * k * c) * d;
  }

  vec3 tanX = vec3(1.0 + dxdx, dydp.x, dxdz);
  vec3 tanZ = vec3(dxdz, dydp.y, 1.0 + dzdz);
  nrm = normalize(cross(tanZ, tanX));
  // Horizontal Jacobian determinant: < 1 means the surface is compressing,
  // which is exactly where real water pinches and throws foam.
  jac = (1.0 + dxdx) * (1.0 + dzdz) - dxdz * dxdz;
}

/** Height only — used for the cheap outer rings and for shoreline queries. */
float gerstnerHeight(vec2 p, float t, float fade) {
  float y = 0.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 A = uWaveA[i];
    vec4 B = uWaveB[i];
    y += A.z * fade * sin(A.w * dot(A.xy, p) - B.x * t + B.z);
  }
  return y;
}
`;

/**
 * Sub-metre ripple field evaluated per fragment. The vertex grid cannot
 * tessellate anything under ~0.7 m, so this supplies the third (micro) scale of
 * normal detail with analytic derivatives — no texture, no tiling.
 */
export const RIPPLE_GLSL = /* glsl */ `
const int RIPPLE_COUNT = 7;

// Slope of a bank of short capillary waves. Returns d(height)/d(xz).
vec2 rippleSlope(vec2 p, float t, float amp) {
  vec2 slope = vec2(0.0);
  float lambda = 2.1;
  float a = amp;
  float ang = 0.9;
  for (int i = 0; i < RIPPLE_COUNT; i++) {
    float k = 6.2831853 / lambda;
    vec2 d = vec2(cos(ang), sin(ang));
    float om = sqrt(9.81 * k + 0.0728 / 1000.0 * k * k * k);
    float c = cos(k * dot(d, p) - om * t + float(i) * 2.399);
    slope += d * (a * k * c);
    lambda *= 0.62;
    a *= 0.68;
    ang += 2.399963;   // golden angle: never repeats a direction
  }
  return slope;
}
`;
