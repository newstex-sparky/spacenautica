/**
 * Physical atmosphere model shared by the GPU LUT passes, the sky dome and the
 * CPU-side light estimator.
 *
 * The medium is the standard Bruneton/Hillaire Earth fit: two-term Rayleigh +
 * Mie exponential profiles plus a tent-shaped ozone absorber. Distances are in
 * KILOMETRES inside the atmosphere solver (the rest of the game is metric, so
 * the sky system converts at the boundary: `rKm = groundR + worldY * 0.001`).
 *
 * Everything here is analytic or LUT-driven — no textures are ever loaded.
 */

/* ------------------------------------------------------------------ *
 * Medium parameters (kept in one place so CPU and GPU cannot drift)
 * ------------------------------------------------------------------ */

export const ATMO = {
  /** Planet radius, km. */
  groundR: 6360,
  /** Top of atmosphere, km. */
  topR: 6460,
  /** Rayleigh scattering coefficient at sea level, 1/km, RGB. */
  rayleighS: [5.802e-3, 13.558e-3, 33.1e-3] as const,
  rayleighH: 8.0,
  mieS: 3.996e-3,
  mieA: 4.4e-3,
  mieH: 1.2,
  mieG: 0.8,
  /** Ozone absorption peak, 1/km, RGB. */
  ozoneA: [0.65e-3, 1.881e-3, 0.085e-3] as const,
  ozoneCentre: 25.0,
  ozoneWidth: 15.0,
  /** Transmittance LUT dimensions (mu, r). */
  transW: 256,
  transH: 64,
  /** Multiple-scattering LUT is square (muSun, r). */
  msSize: 32,
  /**
   * Scale from physical radiance (sun irradiance = 1) into the renderer's
   * linear working range. Chosen so a clear midday zenith lands near 0.9 and
   * ACES maps it to a deep, saturated blue rather than washing out.
   */
  skyScale: 34.0,
} as const;

/* ------------------------------------------------------------------ *
 * GLSL: medium sampling, sphere intersection, LUT parameterisations
 * ------------------------------------------------------------------ */

export const ATMOSPHERE_GLSL = /* glsl */ `
#define ATMO_PI 3.141592653589793
#define ATMO_GROUND_R ${ATMO.groundR.toFixed(1)}
#define ATMO_TOP_R ${ATMO.topR.toFixed(1)}

const vec3  ATMO_RAY_S = vec3(${ATMO.rayleighS.map((v) => v.toFixed(8)).join(', ')});
const float ATMO_RAY_H = ${ATMO.rayleighH.toFixed(4)};
const float ATMO_MIE_S = ${ATMO.mieS.toFixed(8)};
const float ATMO_MIE_A = ${ATMO.mieA.toFixed(8)};
const float ATMO_MIE_H = ${ATMO.mieH.toFixed(4)};
const float ATMO_MIE_G = ${ATMO.mieG.toFixed(4)};
const vec3  ATMO_OZO_A = vec3(${ATMO.ozoneA.map((v) => v.toFixed(8)).join(', ')});

/** Scattering + extinction of the medium at altitude h (km above ground). */
void atmoMedium(float h, out vec3 rayS, out float mieS, out vec3 ext) {
  float hh = max(h, 0.0);
  float dR = exp(-hh / ATMO_RAY_H);
  float dM = exp(-hh / ATMO_MIE_H);
  float dO = max(0.0, 1.0 - abs(hh - ${ATMO.ozoneCentre.toFixed(1)}) / ${ATMO.ozoneWidth.toFixed(1)});
  rayS = ATMO_RAY_S * dR;
  mieS = ATMO_MIE_S * dM;
  ext  = rayS + vec3(ATMO_MIE_S + ATMO_MIE_A) * dM + ATMO_OZO_A * dO;
}

/** Nearest forward hit of a sphere centred on the origin, or -1.0. */
float atmoSphere(vec3 ro, vec3 rd, float rad) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - rad * rad;
  float d = b * b - c;
  if (d < 0.0) return -1.0;
  d = sqrt(d);
  float t0 = -b - d;
  float t1 = -b + d;
  if (t1 < 0.0) return -1.0;
  return t0 < 0.0 ? t1 : t0;
}

/** Bruneton's distance-warped (mu, r) parameterisation — dense near the horizon. */
vec2 atmoTransUv(float r, float mu) {
  float H = sqrt(max(0.0, ATMO_TOP_R * ATMO_TOP_R - ATMO_GROUND_R * ATMO_GROUND_R));
  float rho = sqrt(max(0.0, r * r - ATMO_GROUND_R * ATMO_GROUND_R));
  float disc = r * r * (mu * mu - 1.0) + ATMO_TOP_R * ATMO_TOP_R;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dMin = ATMO_TOP_R - r;
  float dMax = rho + H;
  return vec2((d - dMin) / max(dMax - dMin, 1e-5), rho / max(H, 1e-5));
}

/** Inverse of atmoTransUv. */
void atmoTransParams(vec2 uv, out float r, out float mu) {
  float H = sqrt(max(0.0, ATMO_TOP_R * ATMO_TOP_R - ATMO_GROUND_R * ATMO_GROUND_R));
  float rho = uv.y * H;
  r = sqrt(rho * rho + ATMO_GROUND_R * ATMO_GROUND_R);
  float dMin = ATMO_TOP_R - r;
  float dMax = rho + H;
  float d = dMin + uv.x * (dMax - dMin);
  mu = d == 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
  mu = clamp(mu, -1.0, 1.0);
}

vec3 atmoTransmittance(sampler2D lut, float r, float mu) {
  vec2 uv = atmoTransUv(clamp(r, ATMO_GROUND_R, ATMO_TOP_R), clamp(mu, -1.0, 1.0));
  return texture2D(lut, uv).rgb;
}

vec3 atmoMultiScatter(sampler2D lut, float r, float muS) {
  float u = clamp(muS * 0.5 + 0.5, 0.0, 1.0);
  float v = clamp((r - ATMO_GROUND_R) / (ATMO_TOP_R - ATMO_GROUND_R), 0.0, 1.0);
  return texture2D(lut, vec2(u, v)).rgb;
}

float atmoRayleighPhase(float c) { return 0.05968310365946075 * (1.0 + c * c); }

float atmoMiePhase(float c) {
  float g = ATMO_MIE_G;
  float k = 3.0 / (8.0 * ATMO_PI) * (1.0 - g * g) / (2.0 + g * g);
  return k * (1.0 + c * c) / pow(max(1e-4, 1.0 + g * g - 2.0 * g * c), 1.5);
}

/* --- sky-view panorama mapping: azimuth x, sqrt-warped altitude y --- */

vec2 skyViewUv(vec3 dir) {
  float u = atan(dir.z, dir.x) / (2.0 * ATMO_PI) + 0.5;
  float s = sqrt(abs(dir.y)) * (dir.y < 0.0 ? -1.0 : 1.0);
  return vec2(u, s * 0.5 + 0.5);
}

vec3 skyViewDir(vec2 uv) {
  float az = (uv.x - 0.5) * 2.0 * ATMO_PI;
  float s = uv.y * 2.0 - 1.0;
  float y = s * s * (s < 0.0 ? -1.0 : 1.0);
  float c = sqrt(max(0.0, 1.0 - y * y));
  return vec3(cos(az) * c, y, sin(az) * c);
}
`;

/* ------------------------------------------------------------------ *
 * GLSL: the scattering raymarch used by both the multi-scatter LUT and
 * the sky-view LUT.
 * ------------------------------------------------------------------ */

export const ATMOSPHERE_MARCH_GLSL = /* glsl */ `
struct AtmoSample {
  vec3 lum;    // in-scattered radiance reaching the observer
  vec3 trans;  // transmittance along the whole marched segment
  vec3 msf;    // multi-scatter transfer term (only used by the MS LUT pass)
};

/**
 * Hillaire-style single-scatter integration with an analytic in-scatter
 * integral per step. msLut supplies the second-and-higher order energy;
 * pass useMs = 0.0 while building the MS LUT itself.
 */
AtmoSample atmoMarch(
  sampler2D tLut, sampler2D msLut,
  float r0, vec3 dir, vec3 sunDir, vec3 sunIrr,
  int steps, float jitter, float useMs, float isoPhase
) {
  AtmoSample o;
  o.lum = vec3(0.0);
  o.trans = vec3(1.0);
  o.msf = vec3(0.0);

  vec3 ro = vec3(0.0, r0, 0.0);
  float tTop = atmoSphere(ro, dir, ATMO_TOP_R);
  float tGnd = atmoSphere(ro, dir, ATMO_GROUND_R);
  float tMax = tTop;
  if (tGnd > 0.0) tMax = min(tMax, tGnd);
  if (tMax <= 0.0) return o;
  tMax = min(tMax, 600.0);

  float cosT = dot(dir, sunDir);
  float phR = mix(atmoRayleighPhase(cosT), 0.07957747, isoPhase);
  float phM = mix(atmoMiePhase(cosT), 0.07957747, isoPhase);

  float fSteps = float(steps);
  float t = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    float tNew = ((float(i) + jitter) / fSteps) * tMax;
    float dt = tNew - t;
    if (dt <= 0.0) { t = tNew; continue; }
    float tMid = t + dt * 0.5;
    t = tNew;

    vec3 p = ro + dir * tMid;
    float rr = length(p);
    vec3 up = p / rr;
    float h = rr - ATMO_GROUND_R;

    vec3 rayS; float mieS; vec3 ext;
    atmoMedium(h, rayS, mieS, ext);

    vec3 stepTrans = exp(-ext * dt);
    float muS = dot(up, sunDir);
    vec3 sunT = atmoTransmittance(tLut, rr, muS);
    // Hard planet shadow on the sun ray.
    float lit = atmoSphere(p, sunDir, ATMO_GROUND_R) < 0.0 ? 1.0 : 0.0;
    vec3 ms = atmoMultiScatter(msLut, rr, muS) * useMs;

    vec3 inS = (rayS * phR + vec3(mieS) * phM) * (lit * sunT) + (rayS + vec3(mieS)) * ms;
    inS *= sunIrr;

    vec3 safeExt = max(ext, vec3(1e-9));
    vec3 integ = (inS - inS * stepTrans) / safeExt;
    o.lum += o.trans * integ;

    // Energy transfer used by the multiple-scattering LUT.
    vec3 sc = (rayS + vec3(mieS)) * 0.07957747;
    o.msf += o.trans * ((sc - sc * stepTrans) / safeExt);

    o.trans *= stepTrans;
  }

  // Bounce off the ocean/ground when the ray terminates there.
  if (tGnd > 0.0 && tGnd <= tTop) {
    vec3 p = ro + dir * tGnd;
    float rr = max(length(p), ATMO_GROUND_R);
    vec3 up = p / rr;
    float muS = dot(up, sunDir);
    if (muS > 0.0) {
      vec3 sunT = atmoTransmittance(tLut, rr, muS);
      o.lum += o.trans * sunT * sunIrr * muS * vec3(0.05, 0.075, 0.11) / ATMO_PI;
    }
  }
  return o;
}
`;
