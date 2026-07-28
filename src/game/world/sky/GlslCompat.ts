/**
 * Local compatibility prelude for `core/Noise.ts`'s `NOISE_GLSL`.
 *
 * `NOISE_GLSL` declares `sn_permute` only for `vec4`, but its own `snoise(vec2)`
 * calls it with a `vec3`:
 *
 *   vec3 p = sn_permute( sn_permute( i.y + vec3(...) ) + i.x + vec3(...) );
 *
 * so any shader that includes the chunk and touches 2D simplex noise (directly,
 * or via `fbm(vec2, int)` / `ridged`) fails to link with
 * "'sn_permute' : no matching overloaded function found".
 *
 * Prepending this chunk *before* `NOISE_GLSL` supplies the missing overload
 * without redefining anything the shared chunk already declares. The proper fix
 * belongs in `core/Noise.ts`, which this module does not own — see the
 * integration notes.
 */
export const NOISE_COMPAT_GLSL = /* glsl */ `
vec3 sn_permute(vec3 x) {
  vec3 m = ((x * 34.0) + 1.0) * x;
  return m - floor(m * (1.0 / 289.0)) * 289.0;
}
`;
