/**
 * A compact analytic sky used *only* by the water system, for surface
 * reflections and for the refraction disc inside Snell's window. It is not the
 * game's sky — `world.sky` owns that — it is a cheap stand-in that matches the
 * sun direction/colour it publishes, so reflections agree with the lighting.
 *
 * If the sky system later hands over a panorama through
 * `WaterSystem.setSkyTexture()`, `uSkyTexAmount` cross-fades to it and the
 * analytic form becomes a fallback only.
 */
export const ANALYTIC_SKY_GLSL = /* glsl */ `
uniform vec3  uSkyZenith;
uniform vec3  uSkyHorizon;
uniform vec3  uSunColorSky;
uniform float uSunDisc;      // sun radiance multiplier
uniform float uStorm;
uniform sampler2D uSkyTex;   // optional equirect panorama
uniform float uSkyTexAmount;

/** Radiance of the sky in direction 'dir' (normalised, +Y up). Linear. */
vec3 waterSkyColor(vec3 dir) {
  vec3 d = normalize(dir);
  float up = clamp(d.y, -1.0, 1.0);

  // Gradient: a bright, slightly desaturated horizon band into a deep zenith.
  float t = pow(clamp(up, 0.0, 1.0), 0.42);
  vec3 c = mix(uSkyHorizon, uSkyZenith, t);
  // Below the horizon (grazing reflections) desaturate toward the haze band.
  c = mix(uSkyHorizon * 0.72, c, smoothstep(-0.12, 0.02, up));

  // Sun: a hard disc (~0.53 deg) plus two glow lobes.
  float cd = dot(d, normalize(uwSunDir));
  float disc = smoothstep(0.99975, 0.99991, cd);
  float glow = pow(max(cd, 0.0), 1400.0) * 0.55 + pow(max(cd, 0.0), 55.0) * 0.085;
  float storm = 1.0 - 0.82 * uStorm;
  c += uSunColorSky * uSunDisc * (disc * 26.0 + glow) * storm;

  // Faint cloud banding so a mirror-flat sea still has something to reflect.
  vec2 cuv = d.xz / max(abs(up) + 0.06, 0.06) * 0.55 + vec2(uwTime * 0.004, 0.0);
  float cl = wnFbm(cuv, 4);
  float cover = smoothstep(0.06, 0.62, cl * (0.45 + 0.75 * uStorm));
  vec3 cloudLit = mix(vec3(0.30, 0.34, 0.40), uSunColorSky * 0.9, 0.45) * (0.55 + 0.9 * uSunDisc * 0.25);
  c = mix(c, cloudLit, cover * 0.55 * smoothstep(0.0, 0.28, up));

  vec3 pano = c;
  if (uSkyTexAmount > 0.001) {
    vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, acos(clamp(up, -1.0, 1.0)) * 0.31830989);
    pano = texture2D(uSkyTex, uv).rgb;
  }
  return mix(c, pano, uSkyTexAmount);
}
`;
