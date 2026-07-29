/**
 * Shared GLSL for depth-graded underwater scattering. Every material that draws
 * geometry beneath the surface must apply `applyUnderwater()` as the final step
 * of its fragment shader (in LINEAR space, before tone mapping) so water colour
 * stays consistent across the frame.
 *
 * FROZEN CONTRACT
 * ---------------
 * `applyUnderwater(vec3 color, float dist, float worldY, vec3 viewDir)` and the
 * eight uniform names declared in `UNDERWATER_UNIFORMS_GLSL` are depended on by
 * terrain, flora, props, fauna and the view model. The implementation below has
 * been upgraded (Jerlov extinction, Henyey-Greenstein inscatter, downwelling)
 * but deliberately reads *only* those eight uniforms, so any shader that already
 * declares them keeps compiling untouched.
 *
 * `viewDir` is the normalised direction from the eye toward the shaded point;
 * `dot(viewDir, uwSunDir) == 1` means you are looking straight at the sun.
 */
// Every shared chunk in this file is wrapped in an include guard. Materials are
// assembled by several independent systems and a chunk can legitimately arrive
// twice in one shader (e.g. a prop that patches in fog itself and then gets the
// global patch too); without the guard that is a redefinition link error.
export const UNDERWATER_UNIFORMS_GLSL = /* glsl */ `
#ifndef UW_UNIFORMS_INCLUDED
#define UW_UNIFORMS_INCLUDED
uniform vec3  uwExtinction;    // per-metre beam extinction, RGB (red dies first)
uniform vec3  uwInscatter;     // linear inscattered colour at the surface
uniform float uwSurfaceY;      // world Y of the sea surface
uniform float uwDensity;       // biome density multiplier
uniform vec3  uwSunDir;        // toward the sun
uniform vec3  uwSunColor;
uniform float uwTime;
uniform float uwCameraDepth;
#endif
`;

export const UNDERWATER_FUNCS_GLSL = /* glsl */ `
#ifndef UW_FUNCS_INCLUDED
#define UW_FUNCS_INCLUDED

// Ratio of diffuse downwelling attenuation Kd to beam extinction c. Beam
// extinction is larger because a view ray also loses light scattered *out* of
// the ray, while that same light still travels downward. This is the single
// knob that decides how deep you can still see anything.
#define UW_KD_RATIO 0.42
// Skylight/biolume haze floor: keeps the abyss from collapsing to pure black
// and keeps the residual tint blue rather than grey.
#define UW_FLOOR vec3(0.011, 0.028, 0.044)

/** Downwelling irradiance factor reaching 'depth' metres below the surface. */
vec3 waterDownwelling(float depth) {
  vec3 kd = uwExtinction * uwDensity * UW_KD_RATIO;
  return exp(-kd * max(depth, 0.0)) + UW_FLOOR;
}

/** Beer-Lambert transmittance along 'dist' metres of water. */
vec3 waterTransmittance(float dist) {
  return exp(-uwExtinction * uwDensity * max(dist, 0.0));
}

/** Henyey-Greenstein phase function; g>0 is forward scattering. */
float waterPhaseHG(float cosT, float g) {
  float gg = g * g;
  float d = max(1.0 + gg - 2.0 * g * cosT, 1e-3);
  return (1.0 - gg) / (12.566370614 * d * sqrt(d));
}

/*
 * Beer-Lambert extinction along the view ray plus depth-dependent, anisotropic
 * inscatter. dist: view distance in metres. wy: world Y of the shaded point.
 *
 * The inscatter integral is solved in closed form rather than evaluated at some
 * representative depth. Along the ray, depth(s) = camDepth + grad*s, so
 *
 *   I = sigma_s * exp(-Kd*camDepth) * INTEGRAL[0..dist] exp(-(sigma_t + Kd*grad)*s) ds
 *
 * which is the 'W' term below. Getting this right is not a nicety: any scheme
 * that picks one depth for the whole ray (the eye's, the endpoint's, or a blend)
 * makes two surfaces that meet at the eye-level horizon disagree — the far ocean
 * surface has endpoint depth 0 while the water behind it has the eye's depth —
 * and paints a razor-sharp horizontal seam right across the frame. Here a long
 * near-horizontal ray is automatically dominated by the eye's depth, because
 * exp(-sigma_t*s) kills the far end's contribution, so both sides converge and
 * there is no seam to hide.
 */
vec3 applyUnderwater(vec3 color, float dist, float wy, vec3 viewDir) {
  float d = max(dist, 0.0);
  vec3 sigT = max(uwExtinction * uwDensity, vec3(1e-5));
  vec3 kd = sigT * UW_KD_RATIO;

  float camD = max(uwCameraDepth, 0.0);
  float ptD = max(0.0, uwSurfaceY - wy);
  // Depth gained per metre travelled. Geometrically |grad| <= 1, and since
  // UW_KD_RATIO < 1 the decay constant 'a' below can never reach zero.
  float grad = clamp((ptD - camD) / max(d, 1e-3), -1.0, 1.0);

  vec3 T = exp(-sigT * d);
  vec3 a = sigT + kd * grad;
  vec3 W = sigT * (1.0 - exp(-a * d)) / a;   // -> (1 - T) when grad == 0
  vec3 down = exp(-kd * camD);

  vec3 v = normalize(viewDir);
  float cosT = dot(v, normalize(uwSunDir));
  // Isotropic base (1/4pi) plus a strong forward lobe: this is what makes the
  // water glow when you turn to face the sun.
  float phase = 0.0795775 + waterPhaseHG(cosT, 0.62) * 0.85;
  float daylight = smoothstep(-0.04, 0.14, uwSunDir.y);

  vec3 ambient = uwInscatter * (down * W + UW_FLOOR * (1.0 - T));
  vec3 sun = uwSunColor * down * W * (phase * 1.15 * daylight);

  return color * T + ambient + sun;
}
#endif
`;

/**
 * The water volume with *nothing* in it: what a ray that never hits geometry
 * looks like. Used by `WaterBackdrop` to paint the underwater far field so the
 * background can never disagree with the fog applied to solid surfaces — they
 * are literally the same integral, evaluated for a ray that runs to infinity.
 *
 * Opt in by including this chunk after `UNDERWATER_FUNCS_GLSL`.
 */
export const UNDERWATER_FARFIELD_GLSL = /* glsl */ `
#ifndef UW_FARFIELD_INCLUDED
#define UW_FARFIELD_INCLUDED
/**
 * Radiance of the open water column along 'rd' (normalised, pointing away from
 * the eye). Upward rays stop at the surface plane; everything else runs to
 * 'maxDist', which only needs to exceed a few optical depths.
 */
vec3 waterFarField(vec3 rd, float maxDist) {
  float camD = max(uwCameraDepth, 0.0);
  float dist = maxDist;
  if (rd.y > 1e-3) dist = min(maxDist, camD / rd.y);
  // World Y where the ray ends — this is what feeds applyUnderwater's depth
  // gradient, so 'up is brighter, down is darker' falls out of the physics
  // instead of being faked with a vertical ramp.
  float endY = uwSurfaceY - (camD - rd.y * dist);
  return applyUnderwater(vec3(0.0), dist, endY, rd);
}
#endif
`;

/** Convenience: the two chunks concatenated. */
export const UNDERWATER_GLSL = UNDERWATER_UNIFORMS_GLSL + UNDERWATER_FUNCS_GLSL;

/* ------------------------------------------------------------------ *
 * OPTIONAL add-ons. Not part of the frozen contract — opt in by also
 * declaring these uniforms (they are present in
 * `WaterSystem.sharedUniforms`, so `Object.assign` already gives you the
 * values).
 * ------------------------------------------------------------------ */

export const UNDERWATER_CAUSTICS_UNIFORMS_GLSL = /* glsl */ `
#ifndef UW_CAUSTIC_UNIFORMS_INCLUDED
#define UW_CAUSTIC_UNIFORMS_INCLUDED
uniform sampler2D uwCausticsMap;
// x: strength, y: world tile size in metres, z: depth falloff scale,
// w: 1 when materials should apply caustics themselves (always 1 now; kept so
//    shaders that branch on it still compile).
uniform vec4  uwCausticsParams;
#endif
`;

export const UNDERWATER_CAUSTICS_GLSL = /* glsl */ `
#ifndef UW_CAUSTICS_INCLUDED
#define UW_CAUSTICS_INCLUDED
// Internal gain applied on top of uwCausticsParams.x by waterCaustics() only.
// The published strength is calibrated for consumers that sample the tile with
// their own combine (world/terrain does); this restores full strength for the
// mean-subtracted combine below, which starts from zero instead of from the
// tile's mean.
#define UW_CAUSTIC_GAIN 2.6
/**
 * Animated caustics at a world position. The texture is a seamless 48 m tile of
 * unit-mean intensity, sampled twice — rotated ~37 degrees and scaled 1.73x, an
 * irrational ratio so the two layers never re-align — and combined with a
 * geometric mean, which destroys the visible repeat while keeping unit mean and
 * the sharp filaments of both layers.
 */
vec3 waterCaustics(vec3 wpos, vec3 wnrm) {
  float tile = max(uwCausticsParams.y, 1.0);
  vec2 p = wpos.xz / tile;
  vec2 q = vec2(p.x * 0.7986 - p.y * 0.6018, p.x * 0.6018 + p.y * 0.7986) * 1.73;
  vec3 a = texture2D(uwCausticsMap, p).rgb;
  vec3 b = texture2D(uwCausticsMap, q).rgb;
  vec3 c = sqrt(max(a * b, vec3(0.0)));
  // Keep only what is brighter than the ambient level; a soft shoulder above it
  // so filament cores do not clip into flat white plateaus.
  vec3 net = max(c - 0.75, vec3(0.0));
  net = net / (1.0 + net * 0.42);

  // Caustics are cast downward: only surfaces facing up receive them, and the
  // pattern smears out as the receiver tilts away.
  float facing = clamp(wnrm.y * 0.85 + 0.15, 0.0, 1.0);
  float depth = max(0.0, uwSurfaceY - wpos.y);
  float fall = exp(-depth * uwCausticsParams.z);
  return net * (uwCausticsParams.x * UW_CAUSTIC_GAIN * facing * fall);
}
#endif
`;

/** Everything, including the optional caustics helpers. */
export const UNDERWATER_FULL_GLSL =
  UNDERWATER_UNIFORMS_GLSL +
  UNDERWATER_CAUSTICS_UNIFORMS_GLSL +
  UNDERWATER_FUNCS_GLSL +
  UNDERWATER_CAUSTICS_GLSL;
