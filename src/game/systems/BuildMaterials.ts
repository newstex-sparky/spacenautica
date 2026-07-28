/**
 * BUILD MATERIALS — procedural PBR for habitat pieces.
 *
 * Zero external assets: every map here is computed into a DataTexture at runtime
 * from `core/Noise`. Three scales of variation, as required by the visual bar:
 *
 *   macro  — a world-space grunge layer (~0.05 /m) multiplied into albedo and
 *            roughness so a long corridor is never one flat colour.
 *   mid    — the generated panel/seam/rivet maps on the mesh UVs.
 *   micro  — a high-frequency detail normal sampled at ~3 /m, keeping the
 *            surface alive at 30 cm.
 *
 * Every material also mixes in `WaterSystem.sharedUniforms` and the shared
 * `applyUnderwater()` chunk, so habitat hulls fog identically to terrain.
 */

import * as THREE from 'three';
import { Noise } from '../core/Noise';
import type { GameContext, GameSystem } from '../core/Types';
import { UNDERWATER_GLSL } from '../world/water/UnderwaterFog';

/** The only part of `WaterSystem` this module needs. */
interface WaterLike extends GameSystem {
  sharedUniforms?: Record<string, THREE.IUniform>;
}

/* ------------------------------------------------------------------ *
 * Procedural map generation
 * ------------------------------------------------------------------ */

interface HullMaps {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  aoMap: THREE.DataTexture;
}

function tex(data: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Panelled hull: rectangular plate grid with recessed seams, rivet rows, weld
 * beads, salt streaks and biofilm. `panels` controls plates per tile.
 */
function generateHull(
  size: number,
  noise: Noise,
  base: THREE.Color,
  opts: { panels: number; rivets: boolean; wear: number; biofilm: number },
): HullMaps {
  const n = size * size;
  const albedo = new Uint8Array(n * 4);
  const rough = new Uint8Array(n * 4);
  const ao = new Uint8Array(n * 4);
  const height = new Float32Array(n);
  const inv = 1 / size;
  const P = opts.panels;

  // ---- pass 1: height field (drives normals + AO) ----
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x * inv;
      const v = y * inv;
      const px = u * P;
      const py = v * P;
      const cx = Math.floor(px);
      const cy = Math.floor(py);
      const fx = px - cx;
      const fy = py - cy;

      // Per-plate bulge: each plate sits at a very slightly different height.
      const plate = (noise.noise2(cx * 3.7 + 0.5, cy * 2.9 + 1.5) * 0.5 + 0.5) * 0.35;

      // Seam: distance to the nearest plate border.
      const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
      const seam = 1 - Math.min(1, edge / 0.045);
      // Weld bead sits just inside the seam and stands proud of the plate.
      const bead = Math.exp(-Math.pow((edge - 0.06) / 0.03, 2)) * 0.5;

      // Rivets along the seams.
      let rivet = 0;
      if (opts.rivets) {
        const rx = (fx * 8) % 1;
        const ry = (fy * 8) % 1;
        const nearEdgeX = fx < 0.09 || fx > 0.91;
        const nearEdgeY = fy < 0.09 || fy > 0.91;
        if (nearEdgeX || nearEdgeY) {
          const d = Math.hypot(rx - 0.5, ry - 0.5);
          rivet = Math.max(0, 1 - d / 0.26) * 0.7;
        }
      }

      // Micro grain + dents.
      const grain = noise.fbm2(u * 46, v * 46, 4) * 0.06;
      const dent = Math.max(0, noise.warpedFbm2(u * 5.5 + 11, v * 5.5 - 4, 1.4, 4)) * -0.28 * opts.wear;

      height[y * size + x] = plate - seam * 0.55 + bead + rivet + grain + dent;
    }
  }

  // ---- pass 2: albedo / roughness / AO from the height field ----
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x * inv;
      const v = y * inv;
      const h = height[i];

      // Vertical salt/rust streaks: advect a noise field downward.
      const streak = Math.max(
        0,
        noise.fbm2(u * 22, v * 2.4, 4) * 0.5 + 0.5 - 0.52,
      ) * (0.4 + 0.6 * (1 - v)) * 1.8;
      // Biofilm settles in the recesses.
      const film = Math.max(0, -h) * 2.2 * opts.biofilm +
        Math.max(0, noise.fbm2(u * 7.5 - 3, v * 7.5 + 9, 3)) * 0.35 * opts.biofilm;
      const grime = THREE.MathUtils.clamp(streak * opts.wear + film, 0, 1);

      // Paint chipping exposes bare metal on the proud edges.
      const chip = THREE.MathUtils.clamp((h - 0.42) * 3.2, 0, 1) * opts.wear;

      const r = base.r * (1 - grime * 0.55) + 0.16 * grime + 0.42 * chip;
      const gg = base.g * (1 - grime * 0.45) + 0.20 * grime + 0.44 * chip;
      const b = base.b * (1 - grime * 0.35) + 0.18 * grime + 0.46 * chip;

      albedo[i * 4] = THREE.MathUtils.clamp(r, 0, 1) * 255;
      albedo[i * 4 + 1] = THREE.MathUtils.clamp(gg, 0, 1) * 255;
      albedo[i * 4 + 2] = THREE.MathUtils.clamp(b, 0, 1) * 255;
      albedo[i * 4 + 3] = 255;

      // Roughness: painted panels are semi-gloss, grime and chips are matte,
      // rivet crowns are polished by handling.
      const rr = THREE.MathUtils.clamp(
        0.42 + grime * 0.42 - chip * 0.22 + noise.noise2(u * 90, v * 90) * 0.05,
        0.06,
        0.98,
      );
      rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = rr * 255;
      rough[i * 4 + 3] = 255;

      // AO: cavity term from the height field, deepened in the seams.
      const cav = THREE.MathUtils.clamp(0.55 + h * 0.9, 0.18, 1);
      const a = cav * 255;
      ao[i * 4] = ao[i * 4 + 1] = ao[i * 4 + 2] = a;
      ao[i * 4 + 3] = 255;
    }
  }

  // ---- pass 3: normals from the height gradient ----
  const nrm = new Uint8Array(n * 4);
  const strength = 3.4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xl = height[y * size + ((x - 1 + size) % size)];
      const xr = height[y * size + ((x + 1) % size)];
      const yd = height[((y - 1 + size) % size) * size + x];
      const yu = height[((y + 1) % size) * size + x];
      let nx = (xl - xr) * strength;
      let ny = (yd - yu) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nrm[i * 4] = (nx * 0.5 + 0.5) * 255;
      nrm[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      nrm[i * 4 + 2] = (nz / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 3] = 255;
    }
  }

  return {
    map: tex(albedo, size, true),
    normalMap: tex(nrm, size, false),
    roughnessMap: tex(rough, size, false),
    aoMap: tex(ao, size, false),
  };
}

/** High-frequency tangent-space normal used as the micro detail layer. */
function generateDetailNormal(size: number, noise: Noise): THREE.DataTexture {
  const n = size * size;
  const data = new Uint8Array(n * 4);
  const h = new Float32Array(n);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x * inv;
      const v = y * inv;
      h[y * size + x] =
        noise.fbm2(u * 34, v * 34, 5) * 0.6 +
        noise.billow2(u * 78, v * 78, 3) * 0.4;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xl = h[y * size + ((x - 1 + size) % size)];
      const xr = h[y * size + ((x + 1) % size)];
      const yd = h[((y - 1 + size) % size) * size + x];
      const yu = h[((y + 1) % size) * size + x];
      let nx = (xl - xr) * 1.6;
      let ny = (yd - yu) * 1.6;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      data[i * 4] = (nx * 0.5 + 0.5) * 255;
      data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      data[i * 4 + 2] = (1 / len * 0.5 + 0.5) * 255;
      data[i * 4 + 3] = 255;
    }
  }
  return tex(data, size, false);
}

/** Low-frequency world-space multiply layer that breaks up tiling. */
function generateGrunge(size: number, noise: Noise): THREE.DataTexture {
  const n = size * size;
  const data = new Uint8Array(n * 4);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x * inv;
      const v = y * inv;
      const a = noise.warpedFbm2(u * 3.1, v * 3.1, 1.7, 5) * 0.5 + 0.5;
      const b = noise.fbm2(u * 9.3 + 21, v * 9.3 - 7, 4) * 0.5 + 0.5;
      const c = 1 - noise.ridged2(u * 5.7 - 13, v * 5.7 + 5, 4);
      data[i * 4] = THREE.MathUtils.clamp(a, 0, 1) * 255;
      data[i * 4 + 1] = THREE.MathUtils.clamp(b, 0, 1) * 255;
      data[i * 4 + 2] = THREE.MathUtils.clamp(c, 0, 1) * 255;
      data[i * 4 + 3] = 255;
    }
  }
  return tex(data, size, false);
}

/* ------------------------------------------------------------------ *
 * Underwater + multi-scale injection
 * ------------------------------------------------------------------ */

const MACRO_UNIFORM_DECL = /* glsl */ `
uniform sampler2D uMacroGrunge;
uniform sampler2D uDetailNormal;
uniform float uMacroScale;
uniform float uMacroStrength;
uniform float uDetailScale;
uniform float uDetailStrength;
varying vec3 vWorldPosUW;
`;

/**
 * Mixes the shared water uniforms plus the macro/micro layers into a standard
 * material. Called once per material; the uniforms are shared objects so a
 * change in `WaterSystem` propagates without touching this file.
 */
export function applyHullShader(
  mat: THREE.MeshStandardMaterial,
  shared: Record<string, THREE.IUniform>,
  extra: {
    grunge: THREE.Texture;
    detail: THREE.Texture;
    macroScale?: number;
    macroStrength?: number;
    detailScale?: number;
    detailStrength?: number;
  },
): void {
  const own: Record<string, THREE.IUniform> = {
    uMacroGrunge: { value: extra.grunge },
    uDetailNormal: { value: extra.detail },
    uMacroScale: { value: extra.macroScale ?? 0.055 },
    uMacroStrength: { value: extra.macroStrength ?? 0.55 },
    uDetailScale: { value: extra.detailScale ?? 3.0 },
    uDetailStrength: { value: extra.detailStrength ?? 0.4 },
  };

  mat.fog = false; // applyUnderwater() is the single source of distance colour.
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, own);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPosUW;`)
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWorldPosUW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vWorldPosUW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${MACRO_UNIFORM_DECL}\n${UNDERWATER_GLSL}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        // --- macro scale: triplanar-ish world-space variation kills tiling ---
        vec3 mgA = texture2D(uMacroGrunge, vWorldPosUW.xz * uMacroScale).rgb;
        vec3 mgB = texture2D(uMacroGrunge, vWorldPosUW.zy * uMacroScale * 0.61 + 0.37).rgb;
        float macro = mix(mgA.r, mgB.g, 0.45);
        float macroTint = mix(mgA.b, mgB.b, 0.5);
        diffuseColor.rgb *= mix(1.0, macro * 1.35, uMacroStrength);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.82, 0.95, 0.9), macroTint * 0.35 * uMacroStrength);
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        {
          float mr = texture2D(uMacroGrunge, vWorldPosUW.xz * uMacroScale * 1.7 + 0.11).g;
          roughnessFactor = clamp(roughnessFactor * (0.78 + 0.48 * mr), 0.045, 1.0);
        }
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          // --- micro scale: detail normal, triplanar blended by the shading normal ---
          vec3 an = abs(normal);
          vec3 bw = an / max(an.x + an.y + an.z, 1e-4);
          vec3 dxz = texture2D(uDetailNormal, vWorldPosUW.xz * uDetailScale).xyz * 2.0 - 1.0;
          vec3 dxy = texture2D(uDetailNormal, vWorldPosUW.xy * uDetailScale).xyz * 2.0 - 1.0;
          vec3 dzy = texture2D(uDetailNormal, vWorldPosUW.zy * uDetailScale).xyz * 2.0 - 1.0;
          vec3 dn = dzy * bw.x + dxz * bw.y + dxy * bw.z;
          normal = normalize(normal + dn * uDetailStrength);
        }
        `,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `#include <opaque_fragment>
        {
          vec3 toFrag = vWorldPosUW - cameraPosition;
          float uwDist = length(toFrag);
          vec3 uwView = uwDist > 1e-4 ? toFrag / uwDist : vec3(0.0, 0.0, -1.0);
          gl_FragColor.rgb = applyUnderwater(gl_FragColor.rgb, uwDist, vWorldPosUW.y, uwView);
        }
        `,
      );
  };
  mat.customProgramCacheKey = () => 'spacenautica.hull.v1';
  mat.needsUpdate = true;
}

/* ------------------------------------------------------------------ *
 * Ghost (placement preview) shader
 * ------------------------------------------------------------------ */

const GHOST_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNrm;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNrm = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const GHOST_FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uTime;
uniform float uValid;
varying vec3 vWorld;
varying vec3 vNrm;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(dot(normalize(vNrm), V), 0.0, 1.0), 2.2);

  // Construction grid on the world planes, so the ghost reads as a projection.
  vec3 gp = vWorld * 2.0;
  vec3 gw = abs(fract(gp) - 0.5);
  float grid = 1.0 - smoothstep(0.0, 0.06, min(min(gw.x, gw.y), gw.z));

  // Rolling scan line travelling up the piece.
  float scan = smoothstep(0.86, 1.0, sin(vWorld.y * 6.0 - uTime * 3.4) * 0.5 + 0.5);

  float a = 0.16 + fres * 0.55 + grid * 0.18 + scan * 0.35;
  // Invalid placements pulse.
  a *= mix(0.75 + 0.25 * sin(uTime * 9.0), 1.0, uValid);
  gl_FragColor = vec4(uColor * (0.55 + fres * 0.9 + scan * 0.6), a);
}
`;

/* ------------------------------------------------------------------ *
 * The material set
 * ------------------------------------------------------------------ */

export class BuildMaterials {
  readonly hull: THREE.MeshStandardMaterial;
  readonly trim: THREE.MeshStandardMaterial;
  readonly rubber: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshPhysicalMaterial;
  readonly glow: THREE.MeshStandardMaterial;
  readonly ghost: THREE.ShaderMaterial;
  readonly interior: THREE.MeshStandardMaterial;

  private disposables: Array<{ dispose(): void }> = [];
  private grunge: THREE.DataTexture;
  private detail: THREE.DataTexture;

  constructor(ctx: GameContext) {
    const tier = ctx.settings.graphics.tier;
    const size = tier === 'low' ? 256 : tier === 'medium' ? 384 : 512;
    const noise = new Noise(0x5eab07);
    const aniso = Math.min(
      ctx.settings.graphics.anisotropy,
      ctx.renderer.capabilities.getMaxAnisotropy(),
    );

    const shared = this.resolveWaterUniforms(ctx);

    this.grunge = generateGrunge(Math.max(128, size >> 1), noise);
    this.detail = generateDetailNormal(Math.max(128, size >> 1), noise);
    this.disposables.push(this.grunge, this.detail);

    // --- painted structural hull ---
    const hullMaps = generateHull(size, noise, new THREE.Color(0.68, 0.66, 0.62), {
      panels: 4, rivets: true, wear: 0.85, biofilm: 0.55,
    });
    this.hull = new THREE.MeshStandardMaterial({
      ...hullMaps,
      color: 0xffffff,
      metalness: 0.34,
      roughness: 1,
      vertexColors: true,
      side: THREE.FrontSide,
    });
    this.tune(hullMaps, aniso, 2.2);
    applyHullShader(this.hull, shared, { grunge: this.grunge, detail: this.detail });

    // --- brushed structural trim: ribs, flanges, bolts ---
    const trimMaps = generateHull(Math.max(128, size >> 1), new Noise(0x1c0ffee), new THREE.Color(0.41, 0.43, 0.46), {
      panels: 8, rivets: true, wear: 0.6, biofilm: 0.3,
    });
    this.trim = new THREE.MeshStandardMaterial({
      ...trimMaps, color: 0xffffff, metalness: 0.88, roughness: 1, vertexColors: true,
    });
    this.tune(trimMaps, aniso, 3.4);
    applyHullShader(this.trim, shared, {
      grunge: this.grunge, detail: this.detail, macroStrength: 0.4, detailStrength: 0.5,
    });

    // --- interior deck / painted inner shell (lighter, cleaner) ---
    const intMaps = generateHull(Math.max(128, size >> 1), new Noise(0x7ea11a), new THREE.Color(0.78, 0.79, 0.77), {
      panels: 6, rivets: false, wear: 0.35, biofilm: 0.1,
    });
    this.interior = new THREE.MeshStandardMaterial({
      ...intMaps, color: 0xffffff, metalness: 0.22, roughness: 1, vertexColors: true, side: THREE.DoubleSide,
    });
    this.tune(intMaps, aniso, 2.6);
    applyHullShader(this.interior, shared, {
      grunge: this.grunge, detail: this.detail, macroStrength: 0.3, detailStrength: 0.32,
    });

    // --- rubber gaskets, hoses, seals ---
    const rubMaps = generateHull(Math.max(128, size >> 2), new Noise(0x3bb17a), new THREE.Color(0.08, 0.085, 0.09), {
      panels: 12, rivets: false, wear: 0.5, biofilm: 0.7,
    });
    this.rubber = new THREE.MeshStandardMaterial({
      ...rubMaps, color: 0xffffff, metalness: 0.02, roughness: 1, vertexColors: true,
    });
    this.tune(rubMaps, aniso, 4);
    applyHullShader(this.rubber, shared, {
      grunge: this.grunge, detail: this.detail, macroStrength: 0.35, detailStrength: 0.7, detailScale: 6,
    });

    // --- viewport glass ---
    this.glass = new THREE.MeshPhysicalMaterial({
      color: 0x9fd3dd,
      metalness: 0,
      roughness: 0.06,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      envMapIntensity: 1.4,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      normalMap: this.detail,
      normalScale: new THREE.Vector2(0.08, 0.08),
      depthWrite: false,
    });

    // --- powered indicator panels ---
    this.glow = new THREE.MeshStandardMaterial({
      color: 0x0a1418,
      emissive: new THREE.Color(0x53d4e8),
      emissiveIntensity: 2.4,
      roughness: 0.35,
      metalness: 0.1,
      toneMapped: true,
    });

    this.ghost = new THREE.ShaderMaterial({
      vertexShader: GHOST_VERT,
      fragmentShader: GHOST_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(0x54e0c0) },
        uTime: { value: 0 },
        uValid: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.disposables.push(
      this.hull, this.trim, this.interior, this.rubber, this.glass, this.glow, this.ghost,
      hullMaps.map, hullMaps.normalMap, hullMaps.roughnessMap, hullMaps.aoMap,
      trimMaps.map, trimMaps.normalMap, trimMaps.roughnessMap, trimMaps.aoMap,
      intMaps.map, intMaps.normalMap, intMaps.roughnessMap, intMaps.aoMap,
      rubMaps.map, rubMaps.normalMap, rubMaps.roughnessMap, rubMaps.aoMap,
    );
  }

  /** Falls back to a private uniform block when the water system is absent. */
  private resolveWaterUniforms(ctx: GameContext): Record<string, THREE.IUniform> {
    const water = ctx.tryGet<WaterLike>('world.water');
    if (water?.sharedUniforms) return water.sharedUniforms;
    return {
      uwExtinction: { value: new THREE.Vector3(0.42, 0.09, 0.045) },
      uwInscatter: { value: new THREE.Color(0.06, 0.3, 0.38) },
      uwSurfaceY: { value: 0 },
      uwDensity: { value: 1 },
      uwSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.3) },
      uwSunColor: { value: new THREE.Color(1, 0.97, 0.9) },
      uwTime: { value: 0 },
      uwCameraDepth: { value: 0 },
    };
  }

  private tune(maps: HullMaps, aniso: number, repeat: number): void {
    for (const t of [maps.map, maps.normalMap, maps.roughnessMap, maps.aoMap]) {
      t.anisotropy = aniso;
      t.repeat.set(repeat, repeat);
      t.needsUpdate = true;
    }
  }

  update(ctx: GameContext): void {
    this.ghost.uniforms.uTime.value = ctx.time;
  }

  setGhostValid(valid: boolean): void {
    (this.ghost.uniforms.uColor.value as THREE.Color).setHex(valid ? 0x54e0c0 : 0xe0503a);
    this.ghost.uniforms.uValid.value = valid ? 1 : 0;
  }

  /** Dims indicator panels when the base loses power. */
  setPowered(powered: boolean, fraction = 1): void {
    this.glow.emissiveIntensity = powered ? 1.6 + 1.4 * fraction : 0.08;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
