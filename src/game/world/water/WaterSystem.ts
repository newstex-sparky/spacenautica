import * as THREE from 'three';
import { Phase } from '../../core/Types';
import type { GameContext, GameSystem, QualityTier } from '../../core/Types';
import type { BiomeDef } from '../terrain/Biomes';
import { WaveField } from './WaterSpectrum';
import { OceanSurface } from './OceanSurface';
import { CausticsRenderer } from './Caustics';
import { Volumetrics } from './Volumetrics';
import { Particulate } from './Particulate';
import { SurfaceOverlay } from './SurfaceOverlay';
import { WaterBackdrop } from './WaterBackdrop';
import { ProfileBlender, bandForDepth } from './WaterProfiles';
import { patchScene } from './MaterialPatch';

/* Module-scope scratch — nothing in update() allocates. */
const _v3a = new THREE.Vector3();
const _lights: Array<{ position: THREE.Vector3; color: THREE.Color; intensity: number }> = [];

/*
 * Neighbour systems are described structurally rather than imported, so this
 * module depends only on the published contract in CONTRACTS.md and cannot be
 * broken by refactors inside those directories.
 */
interface SkyLike extends GameSystem {
  readonly sunDirection: THREE.Vector3;
  readonly sunColor: THREE.Color;
  readonly sunIntensity: number;
  readonly ambientColor: THREE.Color;
  readonly stormFactor: number;
  readonly sunLight?: THREE.DirectionalLight;
}
interface TerrainLike extends GameSystem {
  readonly biomes: ReadonlyMap<string, BiomeDef>;
}
interface PostLike extends GameSystem {
  readonly depthTexture?: THREE.Texture;
}
interface TexturesLike extends GameSystem {
  readonly blueNoise?: THREE.Texture;
}

/**
 * `world.water` — the ocean surface plus every underwater volumetric effect.
 *
 * Owns:
 *  - a camera-centred polar CDLOD Gerstner surface, shaded from both sides
 *    (Snell's window / total internal reflection from below);
 *  - the Jerlov-based scattering model published through `sharedUniforms` and
 *    `applyUnderwater()`, blended per biome;
 *  - procedurally raymarched god rays, shadow-mapped and temporally reprojected;
 *  - photon-gathered caustics, published as `causticsTexture` and projected onto
 *    every underwater surface;
 *  - marine snow with near-field bokeh;
 *  - the wet-lens and colour-grade response to breaking the surface.
 */
export class WaterSystem implements GameSystem {
  readonly name = 'world.water';
  readonly phase = Phase.PreRender;

  underwater = true;
  cameraDepth = 12;
  causticsTexture: THREE.Texture | null = null;

  /**
   * Authoritative water uniforms. Every material drawing underwater geometry
   * should `Object.assign(shader.uniforms, water.sharedUniforms)` and use the
   * chunks from `UnderwaterFog.ts`.
   *
   * The first eight keys are the frozen contract. `uwCausticsMap` /
   * `uwCausticsParams` are optional extras (see `UNDERWATER_CAUSTICS_GLSL`).
   */
  readonly sharedUniforms: Record<string, THREE.IUniform> = {
    uwExtinction: { value: new THREE.Vector3(0.5, 0.092, 0.043) },
    uwInscatter: { value: new THREE.Color(0.06, 0.3, 0.38) },
    uwSurfaceY: { value: 0 },
    uwDensity: { value: 1 },
    uwSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.3) },
    uwSunColor: { value: new THREE.Color(1, 0.97, 0.9) },
    uwTime: { value: 0 },
    uwCameraDepth: { value: 0 },
    // --- optional extras ---
    uwCausticsMap: { value: null as THREE.Texture | null },
    uwCausticsParams: { value: new THREE.Vector4(1.1, 48, 0.02, 0) },
  };

  /** Sea level. Waves oscillate around this. */
  seaLevel = 0;

  /**
   * When true (default) any stock lit material in the scene that has not opted
   * into the water contract is retrofitted with wavelength-dependent
   * scattering, so one system cannot leave the frame with flat fog. Set to
   * false from `main.ts` once every module applies `applyUnderwater()` itself.
   */
  autoPatchSceneMaterials = true;

  /** Set true by `render.post` when it composites `volumetricsTexture` itself. */
  set externalVolumetricComposite(v: boolean) {
    if (this.volumetrics) this.volumetrics.externalComposite = v;
  }

  private waves = new WaveField();
  private blender = new ProfileBlender();
  private backdrop: WaterBackdrop | null = null;
  private surface: OceanSurface | null = null;
  private caustics: CausticsRenderer | null = null;
  private volumetrics: Volumetrics | null = null;
  private particulate: Particulate | null = null;
  private overlay: SurfaceOverlay | null = null;
  private group = new THREE.Group();

  private sky: SkyLike | null = null;
  private terrain: TerrainLike | null = null;
  private post: PostLike | null = null;
  private textures: TexturesLike | null = null;

  private tier: QualityTier = 'high';
  private revision = -1;
  private band = '';
  private windAngle = 0.7;
  private surfaceYCached = 0;
  private lastPatchFrame = -999;
  private causticsFrameSkip = 0;
  private pixelScale = 540;
  private frameNow = 0;
  private externalReadFrame = -999;

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  init(ctx: GameContext): void {
    this.sky = ctx.tryGet<SkyLike>('world.sky') ?? null;
    this.terrain = ctx.tryGet<TerrainLike>('world.terrain') ?? null;
    this.textures = ctx.tryGet<TexturesLike>('assets.textures') ?? null;
    // `render.post` registers in the same phase but after us, so it is resolved
    // lazily on the first frame instead.

    this.group.name = 'world.water';
    ctx.scene.add(this.group);

    // A single global fog colour is exactly what this system exists to replace.
    ctx.scene.fog = null;

    this.build(ctx);
    this.revision = ctx.settings.revision;

    ctx.bus.on('water:transition', ({ underwater }) => this.overlay?.trigger(underwater));
  }

  private build(ctx: GameContext): void {
    const g = ctx.settings.graphics;
    this.tier = g.tier;

    this.teardown();

    // Drawn before all scene geometry: the water's own far field, so nothing
    // else in the frame can disagree with the fog applied to solid surfaces.
    this.backdrop = new WaterBackdrop(this.sharedUniforms);
    this.group.add(this.backdrop.mesh);

    this.surface = new OceanSurface(this.tier, this.sharedUniforms, this.waves);
    this.surface.useGrab = ctx.settings.at('medium');
    this.group.add(this.surface.mesh);

    const causticSize = this.tier === 'ultra' ? 384 : this.tier === 'high' ? 256 : this.tier === 'medium' ? 192 : 128;
    this.caustics = new CausticsRenderer(causticSize);
    this.causticsTexture = this.caustics.texture;
    this.sharedUniforms.uwCausticsMap.value = this.causticsTexture;
    (this.sharedUniforms.uwCausticsParams.value as THREE.Vector4).y = this.caustics.tileSize;

    this.volumetrics = new Volumetrics(this.tier, this.sharedUniforms);
    this.group.add(this.volumetrics.composite);

    this.particulate = new Particulate(this.sharedUniforms, Math.max(0.08, g.particulate));
    this.group.add(this.particulate.group);

    this.overlay = new SurfaceOverlay();
    this.group.add(this.overlay.mesh);

    this.resize(ctx.width, ctx.height, ctx);
  }

  private teardown(): void {
    if (this.backdrop) {
      this.group.remove(this.backdrop.mesh);
      this.backdrop.dispose();
      this.backdrop = null;
    }
    if (this.surface) {
      this.group.remove(this.surface.mesh);
      this.surface.dispose();
      this.surface = null;
    }
    if (this.volumetrics) {
      this.group.remove(this.volumetrics.composite);
      this.volumetrics.dispose();
      this.volumetrics = null;
    }
    if (this.particulate) {
      this.group.remove(this.particulate.group);
      this.particulate.dispose();
      this.particulate = null;
    }
    if (this.overlay) {
      this.group.remove(this.overlay.mesh);
      this.overlay.dispose();
      this.overlay = null;
    }
    this.caustics?.dispose();
    this.caustics = null;
    this.causticsTexture = null;
  }

  resize(width: number, height: number, ctx: GameContext): void {
    const pw = Math.max(2, Math.floor(width * ctx.pixelRatio));
    const ph = Math.max(2, Math.floor(height * ctx.pixelRatio));
    this.surface?.setResolution(pw, ph);
    this.backdrop?.setResolution(pw, ph);
    this.volumetrics?.setSize(pw, ph);
    const fovRad = (ctx.camera.fov * Math.PI) / 180;
    this.pixelScale = (0.5 * ph) / Math.tan(fovRad * 0.5);
  }

  /* ---------------------------------------------------------------- *
   * Frame
   * ---------------------------------------------------------------- */

  update(dt: number, ctx: GameContext): void {
    this.frameNow = ctx.frame;
    if (!this.post) this.post = ctx.tryGet<PostLike>('render.post') ?? null;
    if (!this.sky) this.sky = ctx.tryGet<SkyLike>('world.sky') ?? null;

    if (ctx.settings.revision !== this.revision) {
      const tierChanged = ctx.settings.graphics.tier !== this.tier;
      this.revision = ctx.settings.revision;
      if (tierChanged) {
        this.build(ctx);
      } else {
        this.resize(ctx.width, ctx.height, ctx);
      }
    }

    const sky = this.sky;
    const storm = sky ? THREE.MathUtils.clamp(sky.stormFactor, 0, 1) : 0;
    const sunDir = sky ? sky.sunDirection : _v3a.set(0.3, 0.9, 0.3).normalize();
    const sunColor = sky ? sky.sunColor : _WHITE;
    const sunIntensity = sky ? sky.sunIntensity : 3.2;

    // --- waves -------------------------------------------------------
    // The wind veers slowly, so the sea state never looks like a loop.
    this.windAngle += dt * (0.008 + 0.02 * storm);
    this.waves.configure(this.windAngle, storm);

    const cam = ctx.camera;
    const surfaceY = this.surfaceHeightAt(cam.position.x, cam.position.z, ctx.time);
    this.surfaceYCached = surfaceY;

    const wasUnder = this.underwater;
    this.underwater = cam.position.y < surfaceY;
    this.cameraDepth = Math.max(0, surfaceY - cam.position.y);
    if (wasUnder !== this.underwater) {
      ctx.bus.emit('water:transition', { underwater: this.underwater });
    }

    const nextBand = bandForDepth(this.cameraDepth);
    if (nextBand !== this.band) {
      this.band = nextBand;
      ctx.bus.emit('depth:band', { band: nextBand, depth: this.cameraDepth });
    }

    // --- optics for this position ------------------------------------
    const profile = this.sampleProfile(ctx, cam.position.x, cam.position.z);
    const u = this.sharedUniforms;
    (u.uwExtinction.value as THREE.Vector3).copy(profile.extinction);
    u.uwSurfaceY.value = this.seaLevel;
    u.uwDensity.value = 1 + 0.3 * storm;
    (u.uwSunDir.value as THREE.Vector3).copy(sunDir);
    (u.uwSunColor.value as THREE.Color).copy(sunColor);
    u.uwTime.value = ctx.time;
    u.uwCameraDepth.value = this.cameraDepth;

    // Inscatter: the biome hue lit by the sun that actually reaches the water,
    // dimmed by storm cloud and by night.
    const daylight = THREE.MathUtils.clamp(sunDir.y * 3.2, 0.04, 1);
    const lightLevel = (0.1 + 0.9 * daylight) * (1 - 0.55 * storm) * Math.min(1.2, 0.28 + sunIntensity * 0.2);
    const insc = u.uwInscatter.value as THREE.Color;
    insc.copy(profile.tint).multiplyScalar(0.34 * lightLevel);
    if (sky) {
      insc.r += sky.ambientColor.r * 0.1;
      insc.g += sky.ambientColor.g * 0.1;
      insc.b += sky.ambientColor.b * 0.1;
    }

    // --- surface -----------------------------------------------------
    if (this.surface) {
      const su = this.surface.material.uniforms;
      su.uTime.value = ctx.time;
      (su.uSunColor.value as THREE.Color).copy(sunColor);
      su.uSunIntensity.value = sunIntensity;
      su.uStorm.value = storm;
      su.uFoamAmount.value = 0.45 + 1.1 * storm;
      su.uRippleAmp.value = 0.011 + 0.014 * storm;
      su.uSunDisc.value = Math.max(0.05, sunIntensity * 0.35);
      (su.uWindDir.value as THREE.Vector2).set(Math.cos(this.windAngle), Math.sin(this.windAngle));
      (su.uDeepColor.value as THREE.Color).copy(insc).multiplyScalar(0.85);
      this.updateSkyTint(su, sunDir, sunColor, storm);
      this.surface.follow(cam, this.seaLevel);
      // Below the depth where blue light no longer reaches the surface there is
      // nothing up there to draw — skip 100k triangles of invisible water.
      const extB = (u.uwExtinction.value as THREE.Vector3).z * (u.uwDensity.value as number);
      const visibleUp = THREE.MathUtils.clamp(4.2 / Math.max(extB, 1e-4), 45, 1200);
      this.surface.mesh.visible = this.cameraDepth < visibleUp;
    }

    // --- caustics ----------------------------------------------------
    const causticGain = THREE.MathUtils.clamp(profile.caustics * (0.35 + 0.65 * daylight), 0, 1.6);
    if (this.caustics) {
      // Regenerating every other frame on low tier is invisible in motion.
      const stride = this.tier === 'low' ? 3 : this.tier === 'medium' ? 2 : 1;
      if (this.causticsFrameSkip++ % stride === 0) {
        this.caustics.render(ctx.renderer, ctx.time, sunDir, 1);
      }
    }
    const cp = u.uwCausticsParams.value as THREE.Vector4;
    // Calibrated for a consumer that samples the tile directly and subtracts a
    // constant (world/terrain). `waterCaustics()` scales this back up by
    // UW_CAUSTIC_GAIN, since its combine is already mean-subtracted.
    cp.x = 0.45 * causticGain;
    cp.z = Math.max(0.004, (profile.downwelling.z + profile.downwelling.y) * 0.35);
    // Caustics are applied *in-material*, always (cp.w = 1).
    //
    // They used to be handed to the screen-space pass whenever `render.post`
    // exposed a depth texture, which it always does — but that pass only runs
    // when `graphics.godRays` is on, only sees valid depth once the geometry
    // prepass has been enabled by some *other* consumer, and is one frame stale.
    // Any of those failing silently removed caustics from the entire frame, which
    // is what happened in round 1. Every receiving material already implements
    // `waterCaustics()`, so the in-material path is the one that cannot fail; the
    // volumetric pass keeps only the job it is uniquely able to do, which is the
    // light shafts in the medium itself.
    cp.w = 1;

    // --- volumetrics -------------------------------------------------
    const wantRays =
      ctx.settings.graphics.godRays && this.underwater && sunDir.y > 0.02 && this.cameraDepth < 420;
    if (this.volumetrics) {
      if (wantRays) {
        const shadow = sky?.sunLight?.shadow;
        this.volumetrics.render(ctx.renderer, {
          camera: cam,
          time: ctx.time,
          frame: ctx.frame,
          sunIntensity,
          shadowMap: shadow?.map?.texture ?? null,
          shadowMatrix: shadow?.matrix ?? null,
          depthTexture: this.post?.depthTexture ?? null,
          blueNoise: this.textures?.blueNoise ?? null,
          strength: 0.85 * (1 - 0.6 * storm),
          // Surfaces get their caustics in-material now (see cp.w above), so the
          // screen-space term would only double them up.
          causticSurface: 0,
          maxDist: Math.min(320, Math.max(60, ctx.settings.graphics.viewDistance * 0.4)),
        });
        // If the post stack is pulling `volumetricTexture` for its own composite
        // slot, stay out of the way; otherwise composite in-scene ourselves.
        this.volumetrics.externalComposite = ctx.frame - this.externalReadFrame < 8;
        this.volumetrics.setCompositeAmount(1);
      } else {
        this.volumetrics.hide();
      }
    }

    // --- far field ---------------------------------------------------
    this.backdrop?.update(cam as THREE.PerspectiveCamera, this.underwater ? this.cameraDepth : 0, profile.turbidity);

    // --- particulate -------------------------------------------------
    if (this.particulate) {
      const amount = this.underwater ? THREE.MathUtils.clamp(this.cameraDepth * 0.6, 0, 1) : 0;
      this.particulate.update(cam, amount, this.pixelScale, profile.turbidity);
      if (amount > 0) {
        if (ctx.frame % 12 === 0) this.collectLights(ctx);
        this.particulate.setLights(_lights);
      }
    }

    // --- surfacing response ------------------------------------------
    if (this.overlay) {
      this.overlay.setDepth(this.underwater ? this.cameraDepth : 0);
      this.overlay.update(dt, ctx.time, Math.max(0.2, ctx.width / Math.max(1, ctx.height)));
    }

    // --- contract enforcement ----------------------------------------
    if (this.autoPatchSceneMaterials && ctx.frame - this.lastPatchFrame > 45) {
      this.lastPatchFrame = ctx.frame;
      patchScene(ctx.scene, this.sharedUniforms, (o) => o === this.group);
    }
  }

  /** Blends the optical profile across the biomes under the camera. */
  private sampleProfile(ctx: GameContext, x: number, z: number) {
    this.blender.begin();
    const sample = ctx.world.biomeAt(x, z);
    const biomes = this.terrain?.biomes;
    let any = false;
    for (const id in sample.weights) {
      const w = sample.weights[id];
      if (w > 1e-4) {
        this.blender.add(id, w, biomes?.get(id));
        any = true;
      }
    }
    if (!any) this.blender.add(sample.id, 1, biomes?.get(sample.id));
    return this.blender.end();
  }

  /** Derives sky gradient colours for the surface reflection from the sun. */
  private updateSkyTint(
    su: Record<string, THREE.IUniform>,
    sunDir: THREE.Vector3,
    sunColor: THREE.Color,
    storm: number,
  ): void {
    const h = THREE.MathUtils.clamp(sunDir.y, -0.2, 1);
    const day = THREE.MathUtils.smoothstep(h, -0.08, 0.22);
    const zen = su.uSkyZenith.value as THREE.Color;
    const hor = su.uSkyHorizon.value as THREE.Color;
    // Night -> twilight -> day, then desaturated by storm cloud.
    zen.setRGB(
      THREE.MathUtils.lerp(0.004, 0.055, day),
      THREE.MathUtils.lerp(0.008, 0.14, day),
      THREE.MathUtils.lerp(0.022, 0.36, day),
    );
    hor.setRGB(
      THREE.MathUtils.lerp(0.012, 0.44, day),
      THREE.MathUtils.lerp(0.02, 0.55, day),
      THREE.MathUtils.lerp(0.04, 0.7, day),
    );
    // Low sun spills warm light into the horizon band.
    const warm = Math.max(0, 1 - Math.abs(h - 0.12) * 5) * day;
    hor.r += warm * 0.32 * sunColor.r;
    hor.g += warm * 0.16 * sunColor.g;
    const grey = 0.16 + 0.1 * day;
    zen.lerp(_GREY.setScalar(grey), storm * 0.7);
    hor.lerp(_GREY.setScalar(grey * 1.3), storm * 0.7);
    (su.uSunColorSky.value as THREE.Color).copy(sunColor);
  }

  /** Up to four nearest point lights, so marine snow catches a flashlight. */
  private collectLights(ctx: GameContext): void {
    _lights.length = 0;
    const camPos = ctx.camera.position;
    ctx.scene.traverse((o) => {
      const l = o as THREE.PointLight;
      if (!l.isPointLight || l.intensity <= 0) return;
      if (_lights.length >= 4) return;
      _lights.push({
        position: l.getWorldPosition(_lightScratch[_lights.length]),
        color: l.color,
        intensity: l.intensity / Math.max(1, camPos.distanceTo(l.position) * 0.15),
      });
    });
  }

  /* ---------------------------------------------------------------- *
   * Public API (contract)
   * ---------------------------------------------------------------- */

  /** Wave-displaced surface height at a world XZ. */
  surfaceHeightAt(x: number, z: number, t: number): number {
    return this.seaLevel + this.waves.heightAt(x, z, t);
  }

  /** Surface normal at a world XZ; useful for buoyancy and boat alignment. */
  surfaceNormalAt(x: number, z: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    this.waves.normalAt(x, z, t, out);
    return out;
  }

  /** Extinction + inscatter for a given depth; used by every underwater shader. */
  scatteringAt(depth: number, out: { extinction: THREE.Vector3; inscatter: THREE.Color }): void {
    const ext = this.sharedUniforms.uwExtinction.value as THREE.Vector3;
    const insc = this.sharedUniforms.uwInscatter.value as THREE.Color;
    const density = this.sharedUniforms.uwDensity.value as number;
    out.extinction.copy(ext).multiplyScalar(density);
    const d = Math.max(0, depth);
    out.inscatter.setRGB(
      insc.r * (Math.exp(-ext.x * density * 0.62 * d) + 0.004),
      insc.g * (Math.exp(-ext.y * density * 0.62 * d) + 0.01),
      insc.b * (Math.exp(-ext.z * density * 0.62 * d) + 0.014),
    );
  }

  /** Half-resolution god-ray/caustics buffer, for the post stack to composite. */
  get volumetricsTexture(): THREE.Texture | null {
    return this.volumetrics?.texture ?? null;
  }

  /**
   * Same buffer under the name `render.post` looks for.
   *
   * Reading it is the handshake: `PostStack.syncFrame` polls this every frame when
   * it intends to composite the shafts itself, so a recent read means "someone
   * else is drawing this" and the in-scene additive quad stands down. If nothing
   * reads it, we composite ourselves and the shafts still appear. Either way they
   * are drawn exactly once, without needing main.ts to be told which.
   */
  get volumetricTexture(): THREE.Texture | null {
    this.externalReadFrame = this.frameNow;
    return this.volumetrics?.texture ?? null;
  }

  /** Companion to `volumetricTexture`, read by `render.post`. */
  get volumetricIntensity(): number {
    return 1;
  }

  /** Hands the water an equirectangular sky panorama for accurate reflections. */
  setSkyTexture(tex: THREE.Texture | null, amount = 1): void {
    if (!this.surface) return;
    const su = this.surface.material.uniforms;
    su.uSkyTex.value = tex ?? su.uSkyTex.value;
    su.uSkyTexAmount.value = tex ? THREE.MathUtils.clamp(amount, 0, 1) : 0;
  }

  /** Current sea state, 0 calm .. 1 storm (mirrors `world.sky.stormFactor`). */
  get seaState(): number {
    return this.waves.storm;
  }

  /** Highest crest the wave bank can produce, for AABB/camera margins. */
  get waveMaxAmplitude(): number {
    return this.waves.maxAmplitude;
  }

  /** Cached surface height under the camera this frame. */
  get surfaceYAtCamera(): number {
    return this.surfaceYCached;
  }

  dispose(): void {
    this.teardown();
    this.group.parent?.remove(this.group);
  }
}

const _WHITE = new THREE.Color(1, 0.97, 0.9);
const _GREY = new THREE.Color();
const _lightScratch = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
