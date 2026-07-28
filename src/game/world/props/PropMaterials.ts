/**
 * Prop material library.
 *
 * Every material here is a `MeshStandardMaterial` rewired through
 * `onBeforeCompile` so it keeps the engine's lighting, shadows and IBL while
 * generating all of its albedo / normal / roughness / AO detail procedurally
 * (see `PropShaders.ts`). Each one mixes in `WaterSystem.sharedUniforms` and
 * applies `applyUnderwater()` exactly once, so a single change to water colour
 * propagates to every rock, wreck and vent in the world.
 */
import * as THREE from 'three';
import type { QualityTier } from '../../core/Types';
import {
  HIGHLIGHT_FRAG, HIGHLIGHT_VERT,
  PROP_AO_FRAG, PROP_UNDERWATER_FRAG,
  PROP_VERT_BODY, PROP_VERT_NORMAL, PROP_VERT_PARS,
  propFragPars, propSurfaceBlock,
} from './PropShaders';
import type { PropMatKind } from './PropShaders';

const lin = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();

export interface PropMatSpec {
  kind: PropMatKind;
  /** Primary albedo. */
  colA: number;
  /** Secondary / strata / chipped-metal albedo. */
  colB: number;
  /** Cavity, crack and rust-shadow albedo. */
  colDark: number;
  /** Sediment colour on upward faces (usually the biome floor colour). */
  silt: number;
  /** Ore / rust-highlight / glow colour. */
  accent: number;
  /** Primer / secondary glow / heat colour. */
  accent2: number;
  roughness: number;
  /** Rock: bedding-plane strength. Metal/alien: panel or cell size in metres. */
  shape: number;
  /** Ore density, rust amount or glow strength depending on family. */
  accentAmount: number;
  siltLevel: number;
  /** Procedural pattern frequency multiplier. Big props want a smaller value. */
  detailScale: number;
  /** Barnacle / coral coverage multiplier. */
  crust: number;
  /** Paint-chipping threshold (metal only). */
  chip: number;
  emissive: number;
  doubleSided?: boolean;
  transparent?: boolean;
}

/** The full catalogue, keyed by id. Only `id`s here can be requested. */
export const PROP_MATERIALS = {
  rock_basalt: {
    kind: 'rock', colA: 0x4a4b50, colB: 0x2f3136, colDark: 0x17181c, silt: 0xa89a78,
    accent: 0x8a7a5c, accent2: 0xff5a1e, roughness: 0.88, shape: 0.25, accentAmount: 0.0,
    siltLevel: 0.55, detailScale: 1.0, crust: 0.9, chip: 0.5, emissive: 1,
  },
  rock_limestone: {
    kind: 'rock', colA: 0xbfb49a, colB: 0x8e836c, colDark: 0x4a4436, silt: 0xd6c8a4,
    accent: 0xb9a06a, accent2: 0xff5a1e, roughness: 0.92, shape: 0.85, accentAmount: 0.34,
    siltLevel: 0.7, detailScale: 1.0, crust: 1.0, chip: 0.5, emissive: 1,
  },
  rock_sandstone: {
    kind: 'rock', colA: 0xc09368, colB: 0x8f6a48, colDark: 0x4b3524, silt: 0xd9c9a3,
    accent: 0x9c7f4a, accent2: 0xff5a1e, roughness: 0.95, shape: 0.95, accentAmount: 0.26,
    siltLevel: 0.75, detailScale: 1.0, crust: 0.8, chip: 0.5, emissive: 1,
  },
  rock_shale: {
    kind: 'rock', colA: 0x3c4148, colB: 0x22262c, colDark: 0x101316, silt: 0x8b8570,
    accent: 0x6f7d86, accent2: 0xff5a1e, roughness: 0.8, shape: 1.0, accentAmount: 0.1,
    siltLevel: 0.45, detailScale: 1.0, crust: 0.7, chip: 0.5, emissive: 1,
  },
  rock_vent: {
    kind: 'rock', colA: 0x2b2422, colB: 0x161211, colDark: 0x0a0807, silt: 0x5a4a3a,
    accent: 0xc0902a, accent2: 0xff4d10, roughness: 0.82, shape: 0.35, accentAmount: 0.12,
    siltLevel: 0.2, detailScale: 1.1, crust: 0.25, chip: 0.5, emissive: 1,
  },
  ore_limestone: {
    kind: 'rock', colA: 0xb0a68e, colB: 0x847a64, colDark: 0x413c30, silt: 0xd6c8a4,
    accent: 0xd8c98a, accent2: 0xff5a1e, roughness: 0.9, shape: 0.8, accentAmount: 0.7,
    siltLevel: 0.5, detailScale: 1.15, crust: 0.85, chip: 0.5, emissive: 1.6,
  },
  ore_metal: {
    kind: 'rock', colA: 0x5a5148, colB: 0x39332c, colDark: 0x1a1714, silt: 0xa89a78,
    accent: 0xc9b48a, accent2: 0xff5a1e, roughness: 0.72, shape: 0.4, accentAmount: 0.85,
    siltLevel: 0.35, detailScale: 1.25, crust: 0.7, chip: 0.5, emissive: 2.0,
  },
  hull_painted: {
    kind: 'metal', colA: 0xb8b3aa, colB: 0x8d9199, colDark: 0x3a2418, silt: 0xa89a78,
    accent: 0x9c4f1e, accent2: 0x7d5a48, roughness: 0.46, shape: 1.7, accentAmount: 0.85,
    siltLevel: 0.4, detailScale: 1.0, crust: 1.0, chip: 0.42, emissive: 1,
    doubleSided: true,
  },
  hull_orange: {
    kind: 'metal', colA: 0xc4601c, colB: 0x8d9199, colDark: 0x38200f, silt: 0xa89a78,
    accent: 0x8e4416, accent2: 0x6f6256, roughness: 0.44, shape: 1.2, accentAmount: 0.62,
    siltLevel: 0.35, detailScale: 1.1, crust: 0.85, chip: 0.4, emissive: 1,
    doubleSided: true,
  },
  hull_interior: {
    kind: 'metal', colA: 0x7c7a72, colB: 0x5c6068, colDark: 0x241610, silt: 0x6a6152,
    accent: 0x7a3d16, accent2: 0x555049, roughness: 0.52, shape: 1.4, accentAmount: 0.95,
    siltLevel: 0.15, detailScale: 1.05, crust: 0.35, chip: 0.36, emissive: 1,
    doubleSided: true,
  },
  salvage_metal: {
    kind: 'metal', colA: 0x8e8a80, colB: 0x9a9ea6, colDark: 0x2e1c12, silt: 0xa89a78,
    accent: 0xa2551f, accent2: 0x6d6a62, roughness: 0.5, shape: 0.75, accentAmount: 0.9,
    siltLevel: 0.5, detailScale: 1.4, crust: 1.0, chip: 0.34, emissive: 1,
  },
  precursor: {
    kind: 'alien', colA: 0x1d2b2e, colB: 0x2a3d3f, colDark: 0x080d0e, silt: 0x3a4a4a,
    accent: 0x26e0c8, accent2: 0x7a4bd0, roughness: 0.24, shape: 1.6, accentAmount: 1.0,
    siltLevel: 0.05, detailScale: 0.9, crust: 0.0, chip: 0.5, emissive: 1.4,
  },
  quartz: {
    kind: 'crystal', colA: 0xd6e6ee, colB: 0x9dc4d6, colDark: 0x5a8496, silt: 0xd6c8a4,
    accent: 0x9fe4ff, accent2: 0xffffff, roughness: 0.09, shape: 0.5, accentAmount: 1.0,
    siltLevel: 0.15, detailScale: 1.6, crust: 0.0, chip: 0.5, emissive: 1.1,
  },
  egg_shell: {
    kind: 'organic', colA: 0xcbb08a, colB: 0x8f9a72, colDark: 0x453a2c, silt: 0xd6c8a4,
    accent: 0x6ff0c4, accent2: 0xffd08a, roughness: 0.42, shape: 0.5, accentAmount: 1.0,
    siltLevel: 0.2, detailScale: 1.5, crust: 0.0, chip: 0.5, emissive: 1.0,
  },
  coral_sample: {
    kind: 'organic', colA: 0xc45a4a, colB: 0xe0a05c, colDark: 0x50201c, silt: 0xd6c8a4,
    accent: 0xff9a6a, accent2: 0xff5f7a, roughness: 0.62, shape: 0.5, accentAmount: 1.0,
    siltLevel: 0.25, detailScale: 1.7, crust: 0.0, chip: 0.5, emissive: 0.7,
  },
} satisfies Record<string, PropMatSpec>;

export type PropMatId = keyof typeof PROP_MATERIALS;

/* ------------------------------------------------------------------ *
 * Factory
 * ------------------------------------------------------------------ */

export class PropMaterialLibrary {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  private owned: THREE.Material[] = [];

  constructor(
    private readonly shared: Record<string, THREE.IUniform>,
    private readonly tier: QualityTier,
  ) {}

  /** Cached PBR material for a catalogue id. */
  get(id: PropMatId): THREE.MeshStandardMaterial {
    let m = this.cache.get(id);
    if (!m) {
      m = this.build(id, PROP_MATERIALS[id]);
      this.cache.set(id, m);
    }
    return m;
  }

  private build(id: string, spec: PropMatSpec): THREE.MeshStandardMaterial {
    const encrust = spec.crust > 0 && (spec.kind === 'rock' || spec.kind === 'metal');
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: spec.roughness,
      metalness: 0,
      // We do our own wavelength-dependent extinction; the scene's uniform fog
      // must not double-apply.
      fog: false,
      side: spec.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      transparent: spec.transparent === true,
      envMapIntensity: 0.8,
      dithering: true,
    });
    mat.name = `props.${id}`;

    const uniforms: Record<string, THREE.IUniform> = {
      uPropColA: { value: lin(spec.colA) },
      uPropColB: { value: lin(spec.colB) },
      uPropColDark: { value: lin(spec.colDark) },
      uPropSilt: { value: lin(spec.silt) },
      uPropAccent: { value: lin(spec.accent) },
      uPropAccent2: { value: lin(spec.accent2) },
      uPropParams: {
        value: new THREE.Vector4(spec.roughness, spec.shape, spec.accentAmount, spec.siltLevel),
      },
      uPropParams2: {
        value: new THREE.Vector4(spec.detailScale, spec.crust, spec.chip, spec.emissive),
      },
    };
    // Expose them so systems can retune per biome at runtime.
    (mat as THREE.MeshStandardMaterial & { propUniforms: Record<string, THREE.IUniform> })
      .propUniforms = uniforms;

    const vent = id === 'rock_vent';
    const defines: string[] = [];
    if (encrust) defines.push('PROP_ENCRUST');
    if (vent) defines.push('PROP_VENT');

    mat.onBeforeCompile = (shader) => {
      for (const k in this.shared) shader.uniforms[k] = this.shared[k];
      for (const k in uniforms) shader.uniforms[k] = uniforms[k];

      const head = defines.map((d) => `#define ${d}`).join('\n');

      shader.vertexShader = `${head}\n${PROP_VERT_PARS}\n${shader.vertexShader}`
        .replace(
          '#include <defaultnormal_vertex>',
          `#include <defaultnormal_vertex>\n${PROP_VERT_NORMAL}`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>\n${PROP_VERT_BODY}`,
        );

      shader.fragmentShader = `${head}\n${propFragPars(spec.kind)}\n${shader.fragmentShader}`
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>\n${propSurfaceBlock(spec.kind)}`,
        )
        .replace('#include <aomap_fragment>', PROP_AO_FRAG)
        .replace('#include <opaque_fragment>', PROP_UNDERWATER_FRAG);
    };
    mat.customProgramCacheKey = () => `props|${spec.kind}|${defines.join(',')}|${this.tier}`;

    this.owned.push(mat);
    return mat;
  }

  /**
   * Additive fresnel rim used as the "you can harvest this" affordance. One
   * instance is reused for whatever the player is aiming at.
   */
  makeHighlightMaterial(color = 0x8ff0ff): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      vertexShader: HIGHLIGHT_VERT,
      fragmentShader: HIGHLIGHT_FRAG,
      uniforms: {
        uColor: { value: lin(color) },
        uTime: { value: 0 },
        uStrength: { value: 1 },
        uGrow: { value: 0.035 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      fog: false,
    });
    m.name = 'props.highlight';
    this.owned.push(m);
    return m;
  }

  dispose(): void {
    for (const m of this.owned) m.dispose();
    this.owned.length = 0;
    this.cache.clear();
  }
}
