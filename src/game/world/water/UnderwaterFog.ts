/**
 * Shared GLSL for depth-graded underwater scattering. Every material that draws
 * geometry beneath the surface must apply `applyUnderwater()` as the final step
 * of its fragment shader so water colour stays consistent across the frame.
 */
export const UNDERWATER_UNIFORMS_GLSL = /* glsl */ `
uniform vec3  uwExtinction;    // per-metre extinction, RGB (red dies first)
uniform vec3  uwInscatter;     // linear inscattered colour at full path length
uniform float uwSurfaceY;      // world Y of the sea surface
uniform float uwDensity;       // biome density multiplier
uniform vec3  uwSunDir;        // toward the sun
uniform vec3  uwSunColor;
uniform float uwTime;
uniform float uwCameraDepth;
`;

export const UNDERWATER_FUNCS_GLSL = /* glsl */ `
// Beer-Lambert extinction along the view ray plus depth-dependent inscatter.
// dist: view distance in metres. wy: world Y of the shaded point.
vec3 applyUnderwater(vec3 color, float dist, float wy, vec3 viewDir) {
  float depth = max(0.0, uwSurfaceY - wy);
  // Light reaching this depth also attenuates on the way down.
  float verticalPath = depth;
  vec3 downwelling = exp(-uwExtinction * verticalPath * uwDensity);

  vec3 transmittance = exp(-uwExtinction * dist * uwDensity);

  // Anisotropic (Henyey-Greenstein) forward scattering toward the sun.
  float cosT = dot(normalize(viewDir), normalize(uwSunDir));
  const float g = 0.55;
  float hg = (1.0 - g * g) / (4.0 * 3.14159265 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));

  vec3 ambientScatter = uwInscatter * downwelling;
  vec3 sunScatter = uwSunColor * downwelling * hg * 0.9;
  vec3 inscattered = (ambientScatter + sunScatter) * (1.0 - transmittance);

  return color * transmittance + inscattered;
}
`;

/** Convenience: the two chunks concatenated. */
export const UNDERWATER_GLSL = UNDERWATER_UNIFORMS_GLSL + UNDERWATER_FUNCS_GLSL;
