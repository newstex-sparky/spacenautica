import * as THREE from 'three';

/**
 * Ephemeris + night-sky GLSL.
 *
 * The sun and moon run on real spherical astronomy (declination from the axial
 * tilt, hour angle from local solar time, moon on a synodic cycle) so sunrise
 * azimuth drifts with the season, the moon rises ~50 min later each day and a
 * full moon really is opposite the sun. The star field is defined in *equatorial*
 * coordinates and rotated into world space by the sidereal matrix, so the whole
 * sky wheels around the pole over the night instead of sliding sideways.
 */

const DEG = Math.PI / 180;
const OBLIQUITY = 23.4392911 * DEG;
/** Sidereal month, days. */
const MOON_SIDEREAL = 27.321661;
/** Synodic month, days. */
const MOON_SYNODIC = 29.530589;

export interface CelestialConfig {
  /** Observer latitude, degrees. Positive north. */
  latitude: number;
  /** Day of the tropical year, 0..365. Drives solar declination. */
  dayOfYear: number;
  /** Whole days elapsed since world start, for the lunar cycle. */
  dayIndex: number;
}

export class Celestial {
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, -1, 0);
  /** Rotates a world direction into the fixed equatorial star frame. */
  readonly starRot = new THREE.Matrix3();
  /** 0 = new, 0.5 = full. */
  moonPhase = 0.5;
  /** Illuminated fraction of the lunar disc, 0..1. */
  moonIllum = 1;
  /** Signed sine of the altitude angle (== dir.y). */
  sunAltitude = 1;
  moonAltitude = -1;
  /** Local apparent sidereal angle, radians. */
  siderealAngle = 0;

  update(timeOfDay: number, cfg: CelestialConfig): void {
    const phi = cfg.latitude * DEG;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    // --- sun: ecliptic longitude from day of year (0 at the vernal equinox)
    const yearFrac = (cfg.dayOfYear - 80.0) / 365.2422;
    const lambdaS = yearFrac * 2 * Math.PI;
    const decS = Math.asin(Math.sin(OBLIQUITY) * Math.sin(lambdaS));
    const raS = Math.atan2(Math.cos(OBLIQUITY) * Math.sin(lambdaS), Math.cos(lambdaS));

    // Local solar hour angle: 0 at local apparent noon, +west.
    const hourAngleS = ((timeOfDay - 12) / 24) * 2 * Math.PI;
    horizontal(decS, hourAngleS, sinPhi, cosPhi, this.sunDir);
    this.sunAltitude = this.sunDir.y;

    // --- moon: sidereal advance + a fixed 5.14 deg orbital inclination that we
    // fold straight into the ecliptic latitude so the moon's arc is not a clone
    // of the sun's.
    const days = cfg.dayIndex + timeOfDay / 24;
    const lambdaM = lambdaS + (days / MOON_SIDEREAL) * 2 * Math.PI;
    const betaM = 5.145 * DEG * Math.sin((days / 27.212) * 2 * Math.PI);
    const sinDecM =
      Math.sin(betaM) * Math.cos(OBLIQUITY) + Math.cos(betaM) * Math.sin(OBLIQUITY) * Math.sin(lambdaM);
    const decM = Math.asin(Math.max(-1, Math.min(1, sinDecM)));
    const raM = Math.atan2(
      Math.sin(lambdaM) * Math.cos(OBLIQUITY) - Math.tan(betaM) * Math.sin(OBLIQUITY),
      Math.cos(lambdaM),
    );
    // Local sidereal angle: solar hour angle plus the sun's right ascension.
    const theta = hourAngleS + raS;
    this.siderealAngle = theta;
    const hourAngleM = theta - raM;
    horizontal(decM, hourAngleM, sinPhi, cosPhi, this.moonDir);
    this.moonAltitude = this.moonDir.y;

    // --- phase from the synodic cycle (elongation from the sun)
    const elong = (days / MOON_SYNODIC) * 2 * Math.PI;
    this.moonPhase = ((elong / (2 * Math.PI)) % 1 + 1) % 1;
    this.moonIllum = (1 - Math.cos(elong)) * 0.5;

    // --- world -> equatorial rotation (orthonormal, so transpose == inverse)
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    this.starRot.set(
      -st, cosPhi * ct, sinPhi * ct,
      ct, cosPhi * st, sinPhi * st,
      0, sinPhi, -cosPhi,
    );
  }
}

/**
 * Equatorial (declination, hour angle) -> world direction, with
 * +X east, +Y up, +Z south.
 */
function horizontal(dec: number, ha: number, sinPhi: number, cosPhi: number, out: THREE.Vector3): void {
  const sd = Math.sin(dec);
  const cd = Math.cos(dec);
  const sh = Math.sin(ha);
  const ch = Math.cos(ha);
  const e = -cd * sh;
  const n = sd * cosPhi - cd * sinPhi * ch;
  const u = sd * sinPhi + cd * cosPhi * ch;
  out.set(e, u, -n).normalize();
}

/** North galactic pole and galactic centre in the equatorial frame. */
export function galacticNormal(out: THREE.Vector3): THREE.Vector3 {
  const ra = 192.85948 * DEG;
  const dec = 27.12825 * DEG;
  return out.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)).normalize();
}

export function galacticCentre(out: THREE.Vector3): THREE.Vector3 {
  const ra = 266.405 * DEG;
  const dec = -28.936 * DEG;
  return out.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)).normalize();
}

/* ------------------------------------------------------------------ *
 * GLSL — sun disc, moon, star field, milky way, aurora
 * ------------------------------------------------------------------ */

export const CELESTIAL_GLSL = /* glsl */ `
uniform mat3  uStarRot;
uniform vec3  uGalNormal;
uniform vec3  uGalCentre;
uniform float uStarBrightness;
uniform float uPixelAngle;
uniform float uSunRadius;
uniform vec3  uSunRadiance;
uniform float uMoonRadius;
uniform vec3  uMoonRadiance;
uniform float uMoonIllum;
uniform float uAurora;
uniform float uSkyTime;

/* ---- cube-cell star grid ---- */

vec3 starCell(vec3 d, float n, out vec2 cellUv, out float face) {
  vec3 a = abs(d);
  float m = max(a.x, max(a.y, a.z));
  vec2 uv;
  if (a.x >= m) { uv = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= m) { uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
  else { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
  uv = uv * 0.5 + 0.5;
  cellUv = floor(uv * n);
  return vec3(uv, 0.0);
}

vec3 starUnproject(vec2 uv, float face) {
  vec2 p = uv * 2.0 - 1.0;
  vec3 d;
  if (face < 0.5) d = vec3(1.0, p.x, p.y);
  else if (face < 1.5) d = vec3(-1.0, p.x, p.y);
  else if (face < 2.5) d = vec3(p.x, 1.0, p.y);
  else if (face < 3.5) d = vec3(p.x, -1.0, p.y);
  else if (face < 4.5) d = vec3(p.x, p.y, 1.0);
  else d = vec3(p.x, p.y, -1.0);
  return normalize(d);
}

/** Stellar colour from a hashed effective temperature. */
vec3 starTint(float h) {
  vec3 hot  = vec3(0.72, 0.82, 1.00);
  vec3 warm = vec3(1.00, 0.98, 0.95);
  vec3 gold = vec3(1.00, 0.87, 0.68);
  vec3 red  = vec3(1.00, 0.66, 0.45);
  float t = pow(h, 1.6);
  vec3 c = mix(hot, warm, smoothstep(0.0, 0.30, t));
  c = mix(c, gold, smoothstep(0.30, 0.68, t));
  c = mix(c, red, smoothstep(0.68, 1.0, t));
  return c;
}

/** Milky-way surface brightness in the equatorial frame. */
float milkyWay(vec3 cd, out vec3 tint) {
  float s = dot(cd, uGalNormal);
  float band = exp(-s * s / 0.0135);
  float clump = fbm3(cd * 8.5 + vec3(11.3, 4.7, 2.1), 4) * 0.5 + 0.5;
  float fine = fbm3(cd * 27.0 + vec3(2.7), 3) * 0.5 + 0.5;
  float bulge = pow(max(0.0, dot(cd, uGalCentre)), 7.0);
  // Dark dust lane straight down the middle of the band.
  float lane = 1.0 - 0.72 * exp(-s * s / 0.0012) * smoothstep(0.25, 0.7, clump);
  float dust = smoothstep(0.24, 0.74, clump) * (0.55 + 0.45 * fine);
  tint = mix(vec3(0.62, 0.70, 0.95), vec3(1.0, 0.90, 0.74), 0.35 + 0.55 * bulge);
  return band * dust * lane * (0.42 + 2.6 * bulge);
}

vec3 starField(vec3 worldDir) {
  vec3 cd = normalize(uStarRot * worldDir);
  vec3 mwTint;
  float mw = milkyWay(cd, mwTint);

  vec3 col = mwTint * mw * 0.0115 * uStarBrightness;

  // Airmass-driven scintillation: strong near the horizon, calm at the zenith.
  float scint = clamp(0.22 / (max(worldDir.y, 0.0) + 0.10), 0.0, 1.7);

  // Three layers of decreasing density / increasing magnitude.
  for (int layer = 0; layer < 3; layer++) {
    float n = layer == 0 ? 190.0 : (layer == 1 ? 64.0 : 17.0);
    vec2 cell; float face;
    starCell(cd, n, cell, face);
    float lseed = float(layer) * 37.0;
    vec3 h3 = hash33(vec3(cell + lseed, face * 7.0 + lseed));
    float density = layer == 0 ? (0.26 + 0.62 * min(1.0, mw * 3.2))
                  : (layer == 1 ? 0.30 : 0.42);
    if (h3.x > density) continue;

    vec2 jit = vec2(h3.y, h3.z) * 0.62 + 0.19;
    vec3 sDir = starUnproject((cell + jit) / n, face);
    float c = dot(cd, sDir);
    if (c < 0.99) continue;
    float ang2 = max(0.0, 2.0 * (1.0 - c));

    float hb = hash12(cell * 1.37 + lseed + face * 13.0);
    // Magnitude distribution: pow() biases hard toward faint stars.
    float mag = pow(hb, layer == 2 ? 2.0 : 5.0);
    float flux = mag * (layer == 0 ? 0.55 : (layer == 1 ? 1.5 : 6.5));

    float twk = 1.0 + scint * 0.55 * sin(uSkyTime * (5.0 + hb * 11.0) + hb * 63.0)
                    * (0.6 + 0.4 * sin(uSkyTime * (2.3 + hb * 3.1) + face));
    float sigma = uPixelAngle * (0.62 + 0.5 * mag);
    float core = exp(-ang2 / max(1e-12, sigma * sigma));

    vec3 tint = starTint(hash12(cell * 2.11 + face * 5.0 + lseed + 91.0));
    col += tint * flux * core * twk * 0.042 * uStarBrightness;

    // Diffraction spikes on the showpiece stars only.
    if (layer == 2 && mag > 0.45) {
      float ang = sqrt(ang2);
      vec3 up = abs(sDir.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
      vec3 t1 = normalize(cross(up, sDir));
      vec3 t2 = cross(sDir, t1);
      float a1 = abs(dot(cd - sDir, t1));
      float a2 = abs(dot(cd - sDir, t2));
      float spike = exp(-a1 / (uPixelAngle * 0.45)) + exp(-a2 / (uPixelAngle * 0.45));
      col += tint * flux * spike * exp(-ang / (uPixelAngle * 9.0)) * 0.0068 * uStarBrightness;
    }
  }
  return col;
}

/* ---- sun ---- */

vec3 sunDisc(vec3 rd, vec3 sunDir) {
  float c = dot(rd, sunDir);
  if (c <= 0.0) return vec3(0.0);
  float ang = sqrt(max(0.0, 2.0 * (1.0 - c)));
  float edge = 1.0 - smoothstep(uSunRadius - uPixelAngle * 0.7, uSunRadius + uPixelAngle * 0.7, ang);
  vec3 col = vec3(0.0);
  if (edge > 0.0) {
    float rn = clamp(ang / uSunRadius, 0.0, 1.0);
    float mu = sqrt(max(0.0, 1.0 - rn * rn));
    // Quadratic limb-darkening law, visible band.
    float ld = 1.0 - 0.34 * (1.0 - mu) - 0.19 * (1.0 - mu) * (1.0 - mu);
    col += uSunRadiance * ld * edge;
  }
  // Aureole: forward-scattered halo just outside the disc.
  col += uSunRadiance * 0.020 * exp(-ang / (uSunRadius * 7.0));
  col += uSunRadiance * 0.0022 * exp(-ang / (uSunRadius * 42.0));
  return col;
}

/* ---- moon ---- */

vec3 moonDisc(vec3 rd, vec3 moonDir, vec3 sunDir) {
  float c = dot(rd, moonDir);
  if (c <= 0.0) return vec3(0.0);
  float ang = sqrt(max(0.0, 2.0 * (1.0 - c)));
  vec3 col = uMoonRadiance * 0.010 * exp(-ang / (uMoonRadius * 5.0));
  col += uMoonRadiance * 0.0016 * exp(-ang / (uMoonRadius * 26.0)) * (0.25 + 0.75 * uMoonIllum);
  float edge = 1.0 - smoothstep(uMoonRadius - uPixelAngle * 0.8, uMoonRadius + uPixelAngle * 0.8, ang);
  if (edge <= 0.0) return col;

  vec3 up = abs(moonDir.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 T = normalize(cross(up, moonDir));
  vec3 B = cross(moonDir, T);
  vec2 q = vec2(dot(rd, T), dot(rd, B)) / uMoonRadius;
  float r2 = min(0.99995, dot(q, q));
  float w = sqrt(1.0 - r2);
  vec3 n = normalize(T * q.x + B * q.y - moonDir * w);

  float lam = max(0.0, dot(n, sunDir));
  // Lommel-Seeliger: the moon is nearly flat-lit rather than Lambertian.
  float refl = lam / max(0.10, lam + w) * 1.45;

  // Albedo: maria basins over highlands, plus crater rims.
  float maria = fbm3(n * 3.1 + vec3(4.2, 1.1, 8.3), 4) * 0.5 + 0.5;
  float alb = mix(0.058, 0.135, smoothstep(0.40, 0.74, maria));
  vec3 crat = voronoi(vec2(n.x, n.y) * 15.0 + n.z * 4.0);
  alb *= 0.82 + 0.42 * smoothstep(0.02, 0.19, crat.x);
  float micro = fbm3(n * 22.0, 3) * 0.5 + 0.5;
  alb *= 0.9 + 0.2 * micro;

  // A full moon is a ~0.12-albedo rock in full sunlight; on screen it has to be
  // a bright near-white disc you can see the maria on, not a grey smudge.
  vec3 surface = uMoonRadiance * alb * refl * 105.0;
  // Earthshine: cold blue fill on the unlit limb.
  float dark = smoothstep(0.16, 0.0, lam);
  surface += vec3(0.36, 0.52, 0.86) * alb * dark * 0.30 * (1.0 - uMoonIllum * 0.6)
             * length(uMoonRadiance);
  return col + surface * edge;
}

/* ---- aurora ---- */

float auroraCurtain(vec2 q, float t) {
  float w = fbm(q * 0.62 + vec2(t * 0.021, t * 0.008), 3);
  float band = abs(sin((q.y * 1.35 + w * 2.9 + t * 0.037) * 3.14159265));
  float sheet = pow(max(0.0, 1.0 - band), 7.0);
  float rays = 0.45 + 0.55 * (0.5 + 0.5 * sin(q.x * 19.0 + w * 11.0 + t * 0.8));
  float macro = smoothstep(0.15, 0.75, fbm(q * 0.24 + vec2(3.7, 1.9), 3) * 0.5 + 0.5);
  return sheet * rays * macro;
}

vec3 auroraGlow(vec3 rd) {
  if (uAurora <= 0.002 || rd.y < -0.02) return vec3(0.0);
  vec3 ro = vec3(0.0, ATMO_GROUND_R + 0.01, 0.0);
  float rA = ATMO_GROUND_R + 92.0;
  float rB = ATMO_GROUND_R + 265.0;
  float t0 = atmoSphere(ro, rd, rA);
  float t1 = atmoSphere(ro, rd, rB);
  if (t0 < 0.0 || t1 < 0.0) return vec3(0.0);
  vec3 acc = vec3(0.0);
  const int STEPS = 12;
  for (int i = 0; i < STEPS; i++) {
    float f = (float(i) + 0.5) / float(STEPS);
    vec3 p = ro + rd * mix(t0, t1, f);
    float alt = length(p) - ATMO_GROUND_R;
    vec2 q = p.xz * 0.0125;
    float dens = auroraCurtain(q, uSkyTime);
    // Emission bands: 557.7 nm green low, 630 nm red high, violet at the base.
    float hN = clamp((alt - 92.0) / 173.0, 0.0, 1.0);
    float g0 = (hN - 0.14) / 0.20;
    float g1 = (hN - 0.66) / 0.34;
    float g2 = (hN - 0.03) / 0.07;
    vec3 emis = vec3(0.16, 1.0, 0.45) * exp(-g0 * g0);
    emis += vec3(1.0, 0.24, 0.42) * 0.55 * exp(-g1 * g1);
    emis += vec3(0.36, 0.30, 1.0) * 0.20 * exp(-g2 * g2);
    acc += emis * dens * (1.0 - hN * 0.35);
  }
  float horizon = smoothstep(-0.02, 0.14, rd.y);
  return acc * (uAurora * 0.019 / float(STEPS) * 12.0) * horizon;
}
`;
