/**
 * `core/Noise.ts`'s `NOISE_GLSL` chunk is missing the `sn_permute(vec3)`
 * overload that its own `snoise(vec2)` calls, so *any* shader that injects the
 * chunk fails to link:
 *
 *   ERROR: 'sn_permute' : no matching overloaded function found
 *
 * `core/` belongs to the integrator, so this module patches the chunk at import
 * time instead of editing it. The patch is a no-op once the overload is added
 * upstream — see INTEGRATION REQUESTS in the player report.
 */
import { NOISE_GLSL } from '../core/Noise';

const MISSING_OVERLOAD = 'vec3 sn_permute(vec3 x){ return sn_mod289(((x*34.0)+1.0)*x); }\n';

export const VM_NOISE_GLSL = NOISE_GLSL.includes('sn_permute(vec3')
  ? NOISE_GLSL
  : NOISE_GLSL.replace('vec4 sn_permute(vec4 x){', MISSING_OVERLOAD + 'vec4 sn_permute(vec4 x){');
