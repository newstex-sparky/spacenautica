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
export const UNDERWATER_UNIFORMS_GLSL = /* glsl */ `
uniform vec3  uwExtinction;    // per-metre beam extinction, RGB (red dies first)
uniform vec3  uwInscatter;     // linear inscattered colour at the surface
uniform float uwSurfaceY;      // world Y of the sea surface
uniform float uwDensity;       // biome density multiplier
uniform vec3  uwSunDir;        // toward the sun
uniform vec3  uwSunColor;
uniform float uwTime;
uniform float uwCameraDepth;
`;

export const UNDERWATER_FUNCS_GLSL = /* glsl */ `
/** Downwelling irradiance factor reaching 'depth' metres below the surface. */
vec3 waterDownwelling(float depth) {
  // Diffuse attenuation Kd is lower than beam extinction c; 0.62 is the ratio
  // used across the water system. The small floor keeps the abyss from
  // collapsing to pure black (ambient + biolume haze).
  vec3 kd = uwExtinction * uwDensity * 0.62;
  return exp(-kd * max(depth, 0.0)) + vec3(0.004, 0.010, 0.014);
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

// Beer-Lambert extinction along the view ray plus depth-dependent, anisotropic
// inscatter. dist: view distance in metres. wy: world Y of the shaded point.
vec3 applyUnderwater(vec3 color, float dist, float wy, vec3 viewDir) {
  float pointDepth = max(0.0, uwSurfaceY - wy);
  // Average the eye depth and the point depth so long horizontal rays through
  // a depth gradient light plausibly instead of popping at the far end.
  float meanDepth = mix(max(uwCameraDepth, 0.0), pointDepth, 0.5);
  vec3 down = waterDownwelling(meanDepth);
  vec3 T = waterTransmittance(dist);

  vec3 v = normalize(viewDir);
  float cosT = dot(v, normalize(uwSunDir));
  // Isotropic base (1/4pi) plus a strong forward lobe: this is what makes the
  // water glow when you turn to face the sun.
  float phase = 0.0795775 + waterPhaseHG(cosT, 0.62) * 0.85;
  float daylight = smoothstep(-0.04, 0.14, uwSunDir.y);

  vec3 ambient = uwInscatter * down;
  vec3 sun = uwSunColor * down * (phase * 1.15 * daylight);
  vec3 inscattered = (ambient + sun) * (1.0 - T);

  return color * T + inscattered;
}
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
uniform sampler2D uwCausticsMap;
// x: strength, y: world tile size in metres, z: depth falloff scale,
// w: 1 when materials should apply caustics themselves (no screen-space pass).
uniform vec4  uwCausticsParams;
`;

export const UNDERWATER_CAUSTICS_GLSL = /* glsl */ `
/**
 * Animated caustics at a world position. The texture is a seamless 48 m tile,
 * so it is sampled twice — rotated and at a different scale — and combined,
 * which destroys the visible repeat while keeping the sharp filaments.
 */
vec3 waterCaustics(vec3 wpos, vec3 wnrm) {
  float tile = max(uwCausticsParams.y, 1.0);
  vec2 p = wpos.xz / tile;
  // Rotate the second layer by ~37 degrees and scale by 1.7.
  vec2 q = vec2(p.x * 0.7986 - p.y * 0.6018, p.x * 0.6018 + p.y * 0.7986) * 1.73;
  vec3 a = texture2D(uwCausticsMap, p).rgb;
  vec3 b = texture2D(uwCausticsMap, q).rgb;
  // The tile has unit mean, so the product is mean-removed here: what survives
  // is the bright filament network, with no trace of the 48 m repeat.
  vec3 c = max(a * b - 0.82, 0.0) * 1.45;

  // Caustics are cast downward: only surfaces facing up receive them, and the
  // pattern smears out as the receiver tilts away.
  float facing = clamp(wnrm.y * 0.85 + 0.15, 0.0, 1.0);
  float depth = max(0.0, uwSurfaceY - wpos.y);
  float fall = exp(-depth * uwCausticsParams.z);
  return c * (uwCausticsParams.x * facing * fall);
}
`;

/** Everything, including the optional caustics helpers. */
export const UNDERWATER_FULL_GLSL =
  UNDERWATER_UNIFORMS_GLSL +
  UNDERWATER_CAUSTICS_UNIFORMS_GLSL +
  UNDERWATER_FUNCS_GLSL +
  UNDERWATER_CAUSTICS_GLSL;
