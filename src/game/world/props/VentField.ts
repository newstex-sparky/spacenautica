/**
 * Hydrothermal vents and bubble columns.
 *
 * Each vent is a chimney (see `makeVentChimney`) with:
 *  - a rising particulate plume, fully GPU-animated from static attributes so a
 *    whole field costs one draw call and zero CPU work per frame,
 *  - a bubble column with rim-lit spheres,
 *  - an emissive throat glow that flickers,
 *  - a genuine refractive heat-shimmer shell (`transmission`) at high tiers,
 *    kept invisible until the player is close so the extra scene pass is only
 *    paid when it is actually on screen.
 *
 * Lights are *not* created here — the vents publish `emitters` and the props
 * system assigns them to a fixed-size pooled light rig, because changing the
 * light count at runtime would recompile every shader in the scene.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../core/Noise';
import type { GameContext, QualityTier } from '../../core/Types';
import { PLUME_FRAG, PLUME_VERT } from './PropShaders';
import { NOISE_GLSL } from '../../core/Noise';
import { makeVentChimney } from './RockGen';
import type { PropMaterialLibrary } from './PropMaterials';

const lin = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();

export interface VentSpec {
  /** World position of the chimney base. */
  pos: THREE.Vector3;
  height: number;
  /** 0..1 — scales plume density, glow and light intensity. */
  heat: number;
  seed: number;
}

export interface PropEmitter {
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  distance: number;
  flicker: number;
  /** Phase offset so several flickering lamps never pulse in lock-step. */
  phase: number;
}

/* ------------------------------------------------------------------ *
 * Heat shimmer
 * ------------------------------------------------------------------ */

const SHIMMER_VERT_PARS = /* glsl */ `
varying vec3 vShimObj;
`;
const SHIMMER_FRAG_PARS = /* glsl */ `
${NOISE_GLSL}
varying vec3 vShimObj;
uniform float uShimTime;
uniform float uShimAmp;
`;

/**
 * Builds the refractive shell material. `MeshPhysicalMaterial.transmission`
 * gives real screen-space refraction of whatever is behind the plume; the
 * normal is churned by scrolling 3D noise so it boils upward.
 */
function makeShimmerMaterial(): THREE.MeshPhysicalMaterial {
  const uniforms = {
    uShimTime: { value: 0 },
    uShimAmp: { value: 1 },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    transmission: 1,
    thickness: 1.4,
    ior: 1.06,
    roughness: 0.16,
    metalness: 0,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  mat.name = 'props.ventShimmer';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShimTime = uniforms.uShimTime;
    shader.uniforms.uShimAmp = uniforms.uShimAmp;
    shader.vertexShader = `${SHIMMER_VERT_PARS}\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vShimObj = transformed;',
    );
    shader.fragmentShader = `${SHIMMER_FRAG_PARS}\n${shader.fragmentShader}`.replace(
      '#include <normal_fragment_maps>',
      /* glsl */ `#include <normal_fragment_maps>
      {
        vec3 p = vShimObj * vec3(2.6, 1.1, 2.6) + vec3(0.0, -uShimTime * 1.9, 0.0);
        float e = 0.12;
        float h = snoise(p);
        vec3 g = vec3(snoise(p + vec3(e,0.0,0.0)) - h,
                      snoise(p + vec3(0.0,e,0.0)) - h,
                      snoise(p + vec3(0.0,0.0,e)) - h) / e;
        normal = normalize(normal + mat3(viewMatrix) * g * 0.22 * uShimAmp);
      }`,
    );
  };
  mat.customProgramCacheKey = () => 'props.ventShimmer';
  (mat as THREE.MeshPhysicalMaterial & { shimUniforms: typeof uniforms }).shimUniforms = uniforms;
  return mat;
}

/* ------------------------------------------------------------------ *
 * Particle column geometry
 * ------------------------------------------------------------------ */

/**
 * Bakes a soup of camera-facing quads. `origins` are the emitter mouths in
 * group space; the vertex shader does all the motion.
 */
function buildParticleGeometry(
  origins: Array<{ p: THREE.Vector3; count: number; radius: number; kind: number }>,
  seed: number,
): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  let total = 0;
  for (const o of origins) total += o.count;
  const verts = total * 6;
  const position = new Float32Array(verts * 3);
  const corner = new Float32Array(verts * 2);
  const aSeed = new Float32Array(verts * 4);
  const aOrigin = new Float32Array(verts * 4);
  const CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];

  let v = 0;
  for (const o of origins) {
    for (let i = 0; i < o.count; i++) {
      const ph = rng();
      const rad = o.radius * (0.15 + rng() * 0.85);
      const ang = rng() * Math.PI * 2;
      const size = 0.45 + rng() * 0.9;
      for (let k = 0; k < 6; k++) {
        corner[v * 2] = CORNERS[k * 2];
        corner[v * 2 + 1] = CORNERS[k * 2 + 1];
        aSeed[v * 4] = ph;
        aSeed[v * 4 + 1] = rad;
        aSeed[v * 4 + 2] = ang;
        aSeed[v * 4 + 3] = size;
        aOrigin[v * 4] = o.p.x;
        aOrigin[v * 4 + 1] = o.p.y;
        aOrigin[v * 4 + 2] = o.p.z;
        aOrigin[v * 4 + 3] = o.kind;
        // `position` is only used to give three a non-degenerate bounding
        // volume; the shader ignores it.
        position[v * 3] = o.p.x;
        position[v * 3 + 1] = o.p.y;
        position[v * 3 + 2] = o.p.z;
        v++;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 4));
  geo.setAttribute('aOrigin', new THREE.BufferAttribute(aOrigin, 4));
  return geo;
}

interface ColumnConfig {
  height: number;
  rise: number;
  spread: number;
  size: number;
  hot: number;
  cool: number;
  opacity: number;
}

/* ------------------------------------------------------------------ *
 * Vent field
 * ------------------------------------------------------------------ */

export class VentField {
  readonly group = new THREE.Group();
  readonly emitters: PropEmitter[] = [];

  private plumeMat: THREE.ShaderMaterial | null = null;
  private bubbleMat: THREE.ShaderMaterial | null = null;
  private shimmerMat: THREE.MeshPhysicalMaterial | null = null;
  private shimmerMeshes: THREE.Mesh[] = [];
  private chimneys: THREE.BatchedMesh | null = null;
  private owned: Array<{ dispose(): void }> = [];
  private vents: VentSpec[] = [];
  private instanceLods: number[][] = [];
  private currentScratch = new THREE.Vector3();

  constructor(
    private readonly mats: PropMaterialLibrary,
    private readonly shared: Record<string, THREE.IUniform>,
    private readonly tier: QualityTier,
  ) {
    this.group.name = 'world.props.vents';
  }

  /** `bubbleOnly` columns are plain sea-floor gas seeps with no chimney. */
  build(vents: VentSpec[], bubbleColumns: Array<{ pos: THREE.Vector3; strength: number }>, particulate: number): void {
    this.vents = vents;
    const dense = Math.max(0.15, particulate);

    /* --- chimneys ------------------------------------------------- */
    if (vents.length > 0) {
      const shapes = [0, 1, 2, 3].map((i) => makeVentChimney(9100 + i * 37, 2.6 + i * 0.9));
      let vTotal = 0;
      for (const s of shapes) for (const g of s.lods) vTotal += g.getAttribute('position').count;
      const batch = new THREE.BatchedMesh(vents.length + 2, vTotal + 8, 0, this.mats.get('rock_vent'));
      batch.name = 'props.ventChimneys';
      batch.castShadow = true;
      batch.receiveShadow = true;
      const geoIds = shapes.map((s) => s.lods.map((g) => batch.addGeometry(g)));
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const one = new THREE.Vector3();
      const pos = new THREE.Vector3();
      for (let i = 0; i < vents.length; i++) {
        const v = vents[i];
        const rng = mulberry32(v.seed);
        const pick = Math.floor(rng() * shapes.length) % shapes.length;
        const shape = shapes[pick];
        const scale = v.height / Math.max(0.01, shape.height);
        const id = batch.addInstance(geoIds[pick][0]);
        e.set((rng() - 0.5) * 0.16, rng() * Math.PI * 2, (rng() - 0.5) * 0.16);
        q.setFromEuler(e);
        one.set(scale * (0.85 + rng() * 0.3), scale, scale * (0.85 + rng() * 0.3));
        m4.compose(pos.set(v.pos.x, v.pos.y - shape.burial * scale, v.pos.z), q, one);
        batch.setMatrixAt(id, m4);
        this.instanceLods.push(geoIds[pick]);
      }
      batch.computeBoundingSphere();
      this.chimneys = batch;
      this.group.add(batch);
      for (const s of shapes) for (const g of s.lods) this.owned.push(g);
    }

    /* --- plumes --------------------------------------------------- */
    const plumeOrigins = vents.map((v) => ({
      p: new THREE.Vector3(v.pos.x, v.pos.y + v.height * 0.92, v.pos.z),
      count: Math.round((this.tier === 'low' ? 34 : this.tier === 'medium' ? 60 : 96) * dense * (0.5 + v.heat)),
      radius: v.height * 0.24,
      kind: 0,
    }));
    if (plumeOrigins.length > 0) {
      this.plumeMat = this.makeColumnMaterial({
        height: 26, rise: 0.055, spread: 1.5, size: 1.5,
        hot: 0xffb083, cool: 0x8fb9c4, opacity: 0.5,
      });
      const geo = buildParticleGeometry(plumeOrigins, 4711);
      const mesh = new THREE.Mesh(geo, this.plumeMat);
      mesh.name = 'props.ventPlumes';
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.owned.push(geo);
    }

    /* --- bubbles: vents plus stand-alone sea-floor seeps ---------- */
    const bubbleOrigins = [
      ...vents.map((v) => ({
        p: new THREE.Vector3(v.pos.x, v.pos.y + v.height * 0.9, v.pos.z),
        count: Math.round((this.tier === 'low' ? 18 : 40) * dense),
        radius: v.height * 0.16,
        kind: 1,
      })),
      ...bubbleColumns.map((b) => ({
        p: b.pos.clone(),
        count: Math.round((this.tier === 'low' ? 14 : 30) * dense * b.strength),
        radius: 0.5 + b.strength * 0.9,
        kind: 1,
      })),
    ].filter((o) => o.count > 0);

    if (bubbleOrigins.length > 0) {
      this.bubbleMat = this.makeColumnMaterial({
        height: 34, rise: 0.085, spread: 0.55, size: 0.5,
        hot: 0xdff2ff, cool: 0xa8d4e6, opacity: 0.7,
      });
      const geo = buildParticleGeometry(bubbleOrigins, 913);
      const mesh = new THREE.Mesh(geo, this.bubbleMat);
      mesh.name = 'props.bubbleColumns';
      mesh.frustumCulled = false;
      mesh.renderOrder = 7;
      this.group.add(mesh);
      this.owned.push(geo);
    }

    /* --- heat shimmer (high tiers only) --------------------------- */
    if (this.tier === 'high' || this.tier === 'ultra') {
      this.shimmerMat = makeShimmerMaterial();
      for (const v of vents) {
        const h = v.height * 3.2;
        const geo = new THREE.CylinderGeometry(v.height * 0.22, v.height * 0.62, h, 14, 4, true);
        const mesh = new THREE.Mesh(geo, this.shimmerMat);
        mesh.position.set(v.pos.x, v.pos.y + v.height * 0.9 + h * 0.5, v.pos.z);
        mesh.renderOrder = 4;
        mesh.visible = false;
        mesh.name = 'props.ventShimmer';
        this.group.add(mesh);
        this.shimmerMeshes.push(mesh);
        this.owned.push(geo);
      }
    }

    /* --- emitters for the pooled light rig ------------------------ */
    for (const v of vents) {
      this.emitters.push({
        pos: new THREE.Vector3(v.pos.x, v.pos.y + v.height * 0.85, v.pos.z),
        color: lin(0xff6a26),
        intensity: 30 + 46 * v.heat,
        distance: 16 + 22 * v.heat,
        flicker: 0.55,
        phase: v.seed % 100,
      });
    }
  }

  private makeColumnMaterial(c: ColumnConfig): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      vertexShader: PLUME_VERT,
      fragmentShader: PLUME_FRAG,
      uniforms: {
        ...this.shared,
        uTime: { value: 0 },
        uHeight: { value: c.height },
        uRise: { value: c.rise },
        uSpread: { value: c.spread },
        uSize: { value: c.size },
        uCurrent: { value: new THREE.Vector3() },
        uColorHot: { value: lin(c.hot) },
        uColorCool: { value: lin(c.cool) },
        uOpacity: { value: c.opacity },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    m.name = 'props.column';
    return m;
  }

  update(dt: number, ctx: GameContext): void {
    const t = ctx.time;
    if (this.plumeMat) {
      this.plumeMat.uniforms.uTime.value = t;
      ctx.world.currentAt(ctx.camera.position.x, ctx.camera.position.y, ctx.camera.position.z, t, this.currentScratch);
      (this.plumeMat.uniforms.uCurrent.value as THREE.Vector3)
        .set(this.currentScratch.x * 0.12, 0, this.currentScratch.z * 0.12);
    }
    if (this.bubbleMat) {
      this.bubbleMat.uniforms.uTime.value = t;
      (this.bubbleMat.uniforms.uCurrent.value as THREE.Vector3)
        .set(this.currentScratch.x * 0.05, 0, this.currentScratch.z * 0.05);
    }
    if (this.shimmerMat) {
      const u = (this.shimmerMat as THREE.MeshPhysicalMaterial & {
        shimUniforms?: { uShimTime: THREE.IUniform; uShimAmp: THREE.IUniform };
      }).shimUniforms;
      if (u) u.uShimTime.value = t;
      // Only pay for the transmission pass when a vent is genuinely nearby.
      for (let i = 0; i < this.shimmerMeshes.length; i++) {
        const mesh = this.shimmerMeshes[i];
        const d = mesh.position.distanceTo(ctx.camera.position);
        mesh.visible = d < 52;
      }
    }
    void dt;
  }

  /** Distance-based LOD swap for the chimney batch. Chimneys are few. */
  applyLod(cameraPos: THREE.Vector3): void {
    const batch = this.chimneys;
    if (!batch) return;
    for (let i = 0; i < this.instanceLods.length; i++) {
      const lods = this.instanceLods[i];
      const d = cameraPos.distanceTo(this.vents[i].pos);
      const target = lods[Math.min(d > 90 ? 1 : 0, lods.length - 1)];
      if (batch.getGeometryIdAt(i) !== target) batch.setGeometryIdAt(i, target);
    }
  }

  dispose(): void {
    this.plumeMat?.dispose();
    this.bubbleMat?.dispose();
    this.shimmerMat?.dispose();
    this.chimneys?.dispose();
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.shimmerMeshes.length = 0;
  }
}
