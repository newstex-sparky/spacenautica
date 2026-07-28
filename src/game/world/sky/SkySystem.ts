import * as THREE from 'three';
import { Phase } from '../../core/Types';
import type { GameContext, GameSystem, QualityTier } from '../../core/Types';
import { ATMO } from './Atmosphere';
import { AtmosphereCpu } from './AtmosphereCpu';
import { AtmosphereLuts } from './AtmosphereLuts';
import { CascadedShadows } from './CascadedShadows';
import { Celestial, galacticCentre, galacticNormal } from './Celestial';
import { CloudField } from './CloudField';
import { RainCurtain } from './RainCurtain';
import { SkyDome } from './SkyDome';
import { Weather } from './Weather';

/* ------------------------------------------------------------------ *
 * Module-scope scratch — nothing in update() allocates.
 * ------------------------------------------------------------------ */

const sTrans = new THREE.Vector3();
const sDir = new THREE.Vector3();
const sColor = new THREE.Color();
const sColor2 = new THREE.Color();
const sAmbient = new THREE.Color();
const sVec2 = new THREE.Vector2();

/** Cosine-weighted hemisphere taps used to integrate ambient sky irradiance. */
const AMBIENT_TAPS: Array<[number, number, number, number]> = [
  // x, y, z, weight
  [0, 1, 0, 0.26],
  [0.72, 0.5, 0, 0.14],
  [-0.72, 0.5, 0, 0.14],
  [0, 0.5, 0.72, 0.14],
  [0, 0.5, -0.72, 0.14],
  [0, 0.19, 0, 0.09], // replaced per-frame by the sun-facing low tap
  [0, 0.62, 0, 0.09], // replaced per-frame by the sun-facing mid tap
];

interface TierProfile {
  skyViewW: number;
  skyViewH: number;
  skyViewSteps: number;
  cloudSteps: number;
  cloudLightSteps: number;
  envCube: number;
  envInterval: number;
  rainCount: number;
  starBrightness: number;
}

function profileFor(tier: QualityTier): TierProfile {
  switch (tier) {
    case 'low':
      return { skyViewW: 96, skyViewH: 48, skyViewSteps: 14, cloudSteps: 0, cloudLightSteps: 0, envCube: 32, envInterval: 1.6, rainCount: 0, starBrightness: 0.85 };
    case 'medium':
      return { skyViewW: 128, skyViewH: 64, skyViewSteps: 20, cloudSteps: 14, cloudLightSteps: 3, envCube: 48, envInterval: 0.9, rainCount: 2600, starBrightness: 0.95 };
    case 'high':
      return { skyViewW: 176, skyViewH: 88, skyViewSteps: 28, cloudSteps: 22, cloudLightSteps: 5, envCube: 64, envInterval: 0.4, rainCount: 5200, starBrightness: 1.0 };
    default:
      return { skyViewW: 224, skyViewH: 112, skyViewSteps: 40, cloudSteps: 32, cloudLightSteps: 6, envCube: 64, envInterval: 0.28, rainCount: 9000, starBrightness: 1.05 };
  }
}

/**
 * Sky, atmosphere, day/night, weather and the sun/moon light rig.
 *
 * The GPU side is a Hillaire-style precomputed atmosphere (transmittance +
 * multiple-scattering LUTs feeding a per-frame sky-view panorama) composited
 * with a raymarched volumetric cumulus deck, a procedural star field with a
 * milky-way band, a phase-correct moon and an optional aurora — all inside one
 * dome shader that is also rendered into a small cube probe and PMREM'd for IBL.
 *
 * The CPU side runs the same medium at low resolution to decide the directional
 * light colour, its intensity, the ambient term, and how much the cloud deck is
 * shading the sun *right now* (the cloud coverage field is baked into a texture
 * both sides sample identically, so the dimming lines up with the cloud you can
 * see).
 */
export class SkySystem implements GameSystem {
  readonly name = 'world.sky';
  readonly phase = Phase.PreRender;

  /* ---- frozen public contract ---- */
  readonly sunDirection = new THREE.Vector3(0.3, 0.85, 0.42).normalize();
  readonly sunColor = new THREE.Color(1.0, 0.96, 0.88);
  sunIntensity = 4.4;
  readonly moonDirection = new THREE.Vector3(-0.3, -0.85, -0.42);
  readonly ambientColor = new THREE.Color(0.25, 0.42, 0.5);
  timeOfDay = 12.5;
  dayLength = 1200;
  environment!: THREE.Texture;
  sunLight!: THREE.DirectionalLight;

  /** 0..1 storm level. Write `weather.stormOverride` to force it. */
  get stormFactor(): number {
    return this.weather.stormFactor;
  }

  /* ---- additions (other systems may read these) ---- */

  /** Dim blue fill light for the night side. Never casts shadows. */
  moonLight!: THREE.DirectionalLight;
  hemiLight!: THREE.HemisphereLight;
  /** Moonlight colour+intensity folded into one linear colour. */
  readonly moonColor = new THREE.Color(0.55, 0.68, 1.0);
  /** Horizontal wind direction, normalised — the water system's wave driver. */
  readonly windDirection = new THREE.Vector2(1, 0);
  /** Wind speed, m/s. Scales significant wave height. */
  windSpeed = 4;
  /** 0..1 rain above the surface. */
  rainIntensity = 0;
  /** Fraction of direct sun getting through the cloud deck, 0..1. */
  sunOcclusion = 1;
  /** Observer latitude, degrees. Drives the solar arc and the aurora. */
  latitude = 18;
  /** Day of the tropical year; sets the solar declination. */
  dayOfYear = 106;
  /** Whole in-game days elapsed; drives the lunar phase. */
  dayIndex = 3;
  /** 0..1. Auto-derived from latitude + a per-night hash; writable to force. */
  auroraStrength = 0;
  auroraOverride: number | null = null;
  /** Set false if the water system does its own Snell-window sky sampling. */
  applyUnderwaterAttenuation = true;
  readonly weather = new Weather();
  readonly shadows = new CascadedShadows();

  /** Sky-view panorama (lat-long, sqrt-warped altitude) for reflections. */
  get skyViewTexture(): THREE.Texture {
    return this.luts.skyView.texture;
  }
  get transmittanceTexture(): THREE.Texture {
    return this.luts.transmittance.texture;
  }

  /* ---- internals ---- */
  private luts!: AtmosphereLuts;
  private cpu = new AtmosphereCpu();
  private clouds!: CloudField;
  private dome!: SkyDome;
  private rain: RainCurtain | null = null;
  private celestial = new Celestial();
  private profile = profileFor('high');
  private settingsRevision = -1;

  private cubeRt: THREE.WebGLCubeRenderTarget | null = null;
  private cubeCamera: THREE.CubeCamera | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envTimer = 1e9;
  private lastEnvSunY = -99;

  private cloudOffset = new THREE.Vector2();
  private ambientTarget = new THREE.Color(0.25, 0.42, 0.5);
  private moonSkyIrradiance = new THREE.Vector3();
  private sunIrradianceVec = new THREE.Vector3();
  private galNormal = new THREE.Vector3();
  private galCentre = new THREE.Vector3();
  private moonPassCleared = false;
  private prevTod = 12.5;
  private ambientTick = 0;

  /* ---------------------------------------------------------------- */

  init(ctx: GameContext): void {
    const g = ctx.settings.graphics;
    this.profile = profileFor(g.tier);
    this.settingsRevision = ctx.settings.revision;
    galacticNormal(this.galNormal);
    galacticCentre(this.galCentre);

    this.clouds = new CloudField();
    this.luts = new AtmosphereLuts(this.profile.skyViewW, this.profile.skyViewH);
    this.luts.buildStatic(ctx.renderer);

    this.dome = new SkyDome({
      cloudSteps: this.profile.cloudSteps,
      cloudLightSteps: this.profile.cloudLightSteps,
      envCubeSize: this.profile.envCube,
    });
    const u = this.dome.uniforms;
    u.uTransLut.value = this.luts.transmittance.texture;
    u.uSkyView.value = this.luts.skyView.texture;
    u.uSkyViewMoon.value = this.luts.skyViewMoon.texture;
    u.uCloudTex.value = this.clouds.texture;
    (u.uGalNormal.value as THREE.Vector3).copy(this.galNormal);
    (u.uGalCentre.value as THREE.Vector3).copy(this.galCentre);
    u.uStarBrightness.value = this.profile.starBrightness;
    this.dome.setResolution(ctx.height * ctx.pixelRatio, g.fov);

    // Blue noise for the cloud dither; fall back to a local hash pattern if the
    // texture library has not produced one.
    const texLib = ctx.tryGet<GameSystem & { blueNoise?: THREE.Texture }>('assets.textures');
    const bn = texLib?.blueNoise ?? makeFallbackNoise();
    u.uBlueNoise.value = bn;
    (u.uBlueNoiseSize.value as THREE.Vector2).set(bn.image?.width ?? 128, bn.image?.height ?? 128);

    ctx.scene.add(this.dome.mesh);

    // --- lights
    this.sunLight = new THREE.DirectionalLight(0xffffff, this.sunIntensity);
    this.sunLight.name = 'sky.sun';
    this.sunLight.castShadow = true;
    this.shadows.configure(g.shadowCascades, g.shadowMapSize, g.tier);
    this.shadows.applyTo(this.sunLight);
    ctx.scene.add(this.sunLight, this.sunLight.target);

    this.moonLight = new THREE.DirectionalLight(0x8fb0ff, 0);
    this.moonLight.name = 'sky.moon';
    this.moonLight.castShadow = false;
    ctx.scene.add(this.moonLight, this.moonLight.target);

    this.hemiLight = new THREE.HemisphereLight(0x8fc4d8, 0x1a2a26, 0.18);
    this.hemiLight.name = 'sky.hemi';
    ctx.scene.add(this.hemiLight);

    // --- rain
    if (this.profile.rainCount > 0) {
      this.rain = new RainCurtain(this.profile.rainCount);
      ctx.scene.add(this.rain.mesh);
    }

    // --- environment probe
    this.cubeRt = new THREE.WebGLCubeRenderTarget(this.profile.envCube, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    this.cubeRt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.cubeCamera = new THREE.CubeCamera(1, 400, this.cubeRt);
    this.pmrem = new THREE.PMREMGenerator(ctx.renderer);
    this.pmrem.compileCubemapShader();

    // Prime everything so frame 0 is already correct.
    this.advance(0, ctx);
    this.refreshEnvironment(ctx);
    ctx.scene.environment = this.environment;
  }

  /* ---------------------------------------------------------------- */

  update(dt: number, ctx: GameContext): void {
    if (ctx.settings.revision !== this.settingsRevision) {
      this.settingsRevision = ctx.settings.revision;
      this.reconfigure(ctx);
    }
    // Day advances even while paused-for-render so the sky never freezes mid-air.
    this.prevTod = this.timeOfDay;
    this.timeOfDay = (this.timeOfDay + (dt / Math.max(1, this.dayLength)) * 24) % 24;
    if (this.timeOfDay < this.prevTod - 12) this.dayIndex++;
    this.advance(dt, ctx);

    // --- environment probe on a timer, or immediately when the sun jumps
    this.envTimer += dt;
    const sunMoved = Math.abs(this.sunDirection.y - this.lastEnvSunY) > 0.035;
    if (this.envTimer >= this.profile.envInterval || sunMoved) {
      this.refreshEnvironment(ctx);
    }
  }

  /** Everything that has to happen whether or not dt is meaningful. */
  private advance(dt: number, ctx: GameContext): void {
    const g = ctx.settings.graphics;
    const cam = ctx.camera;

    this.weather.update(dt, ctx.time);
    this.windDirection.copy(this.weather.windDirection);
    this.windSpeed = this.weather.windSpeed;
    this.rainIntensity = this.weather.rainIntensity;

    this.celestial.update(this.timeOfDay, {
      latitude: this.latitude,
      dayOfYear: this.dayOfYear,
      dayIndex: this.dayIndex,
    });
    this.sunDirection.copy(this.celestial.sunDir);
    this.moonDirection.copy(this.celestial.moonDir);

    // Cloud advection: wind pushes the deck, in kilometres.
    this.cloudOffset.x += this.windDirection.x * this.windSpeed * dt * 0.0011;
    this.cloudOffset.y += this.windDirection.y * this.windSpeed * dt * 0.0011;

    const observerR = ATMO.groundR + Math.max(0, cam.position.y) * 0.001 + 0.0015;

    /* ---- direct sun ---- */
    this.cpu.transmittance(observerR, this.sunDirection.y, sTrans);
    this.sunOcclusion = this.cloudSunTransmittance(cam.position);
    const aboveHorizon = smoothstep(-0.035, 0.02, this.sunDirection.y);
    const sr = sTrans.x * this.sunOcclusion;
    const sg = sTrans.y * this.sunOcclusion;
    const sb = sTrans.z * this.sunOcclusion;
    const lum = Math.max(1e-5, 0.2126 * sr + 0.7152 * sg + 0.0722 * sb);
    this.sunColor.setRGB(sr / lum, sg / lum, sb / lum);
    this.sunIntensity = 6.1 * lum * aboveHorizon;

    this.sunLight.color.copy(this.sunColor);
    this.sunLight.intensity = this.sunIntensity;
    this.sunLight.visible = this.sunIntensity > 0.002;

    /* ---- moon ---- */
    this.cpu.transmittance(observerR, this.moonDirection.y, sTrans);
    const moonUp = smoothstep(-0.03, 0.06, this.moonDirection.y);
    const nightFade = 1 - smoothstep(-0.02, 0.12, this.sunDirection.y);
    const moonPower = this.celestial.moonIllum * moonUp * nightFade;
    sColor2.setRGB(sTrans.x * 0.62, sTrans.y * 0.74, sTrans.z * 1.0);
    this.moonColor.copy(sColor2);
    this.moonLight.color.copy(sColor2);
    this.moonLight.intensity = 0.17 * moonPower * this.sunOcclusion;
    this.moonLight.visible = this.moonLight.intensity > 0.0015;
    this.moonLight.position.copy(cam.position).addScaledVector(this.moonDirection, 250);
    this.moonLight.target.position.copy(cam.position);
    this.moonLight.target.updateMatrixWorld();

    /* ---- aurora gate: high latitude, and only on some nights ---- */
    const nightHash = fract(Math.sin(this.dayIndex * 12.9898 + 78.233) * 43758.5453);
    const latGate = smoothstep(10, 55, Math.abs(this.latitude));
    const auto = latGate * smoothstep(0.55, 0.95, nightHash) * nightFade * (1 - this.weather.stormFactor * 0.8);
    this.auroraStrength = this.auroraOverride ?? auto;

    /* ---- ambient / IBL-independent fill ---- */
    this.ambientTick += dt;
    if (this.ambientTick > 0.1 || dt === 0) {
      this.ambientTick = 0;
      this.computeAmbient(observerR);
    }
    const k = dt === 0 ? 1 : Math.min(1, dt * 5);
    this.ambientColor.lerp(this.ambientTarget, k);
    this.hemiLight.color.copy(this.ambientColor);
    sColor.copy(this.ambientColor).multiplyScalar(0.28);
    this.hemiLight.groundColor.setRGB(sColor.r * 0.5, sColor.g * 0.8, sColor.b * 0.75);
    this.hemiLight.intensity = 0.18;

    /* ---- sky-view LUTs ---- */
    this.sunIrradianceVec.set(1.0, 0.985, 0.955).multiplyScalar(ATMO.skyScale);
    this.luts.updateSkyView(
      ctx.renderer,
      {
        sunDir: this.sunDirection,
        sunIrradiance: this.sunIrradianceVec,
        observerR,
        steps: this.profile.skyViewSteps,
        haze: this.weather.haze,
      },
      this.luts.skyView,
    );

    const wantMoonPass = moonPower > 0.004;
    if (wantMoonPass) {
      // The moon is a 4x10^-6 sun; scattering the same medium with a tiny,
      // blue-shifted irradiance gives a physically-shaped moonlit sky.
      this.moonSkyIrradiance
        .set(0.55, 0.68, 1.0)
        .multiplyScalar(ATMO.skyScale * 0.0055 * this.celestial.moonIllum * nightFade);
      this.luts.updateSkyView(
        ctx.renderer,
        {
          sunDir: this.moonDirection,
          sunIrradiance: this.moonSkyIrradiance,
          observerR,
          steps: Math.max(10, this.profile.skyViewSteps >> 1),
          haze: this.weather.haze * 0.2,
        },
        this.luts.skyViewMoon,
      );
      this.moonPassCleared = false;
    } else if (!this.moonPassCleared) {
      this.moonSkyIrradiance.set(0, 0, 0);
      this.luts.updateSkyView(
        ctx.renderer,
        { sunDir: this.moonDirection, sunIrradiance: this.moonSkyIrradiance, observerR, steps: 4, haze: 0 },
        this.luts.skyViewMoon,
      );
      this.moonPassCleared = true;
    }

    /* ---- dome uniforms ---- */
    const u = this.dome.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(this.sunDirection);
    (u.uMoonDir.value as THREE.Vector3).copy(this.moonDirection);
    u.uObserverR.value = observerR;
    u.uSkyTime.value = ctx.time;
    u.uLightning.value = this.weather.lightning;
    u.uAurora.value = this.auroraStrength;
    (u.uStarRot.value as THREE.Matrix3).copy(this.celestial.starRot);
    u.uMoonIllum.value = this.celestial.moonIllum;

    // Sun radiance used to light the cloud deck: the sun colour as seen from
    // cloud altitude (thinner air, so less reddening than at the eye).
    this.cpu.transmittance(ATMO.groundR + this.weather.baseKm, this.sunDirection.y, sTrans);
    (u.uSunCloudRad.value as THREE.Vector3)
      .copy(sTrans)
      .multiply(sVecSet(1.0, 0.985, 0.955))
      .multiplyScalar(3.1 * aboveHorizon);
    (u.uSunRadiance.value as THREE.Vector3)
      .copy(sTrans)
      .multiply(sVecSet(1.0, 0.985, 0.955))
      .multiplyScalar(75.0 * aboveHorizon);
    (u.uMoonRadiance.value as THREE.Vector3).set(
      this.moonColor.r * 0.055,
      this.moonColor.g * 0.055,
      this.moonColor.b * 0.055,
    ).multiplyScalar(0.35 + 0.65 * moonUp);

    (u.uAmbTop.value as THREE.Vector3).set(
      this.ambientColor.r * 1.5,
      this.ambientColor.g * 1.5,
      this.ambientColor.b * 1.5,
    );
    (u.uAmbBottom.value as THREE.Vector3).set(
      this.ambientColor.r * 0.42,
      this.ambientColor.g * 0.46,
      this.ambientColor.b * 0.52,
    );

    (u.uCloudOffset.value as THREE.Vector2).copy(this.cloudOffset);
    u.uCloudCoverage.value = this.weather.coverage;
    u.uCloudBase.value = this.weather.baseKm;
    u.uCloudTop.value = this.weather.topKm;
    u.uCloudDensity.value = this.weather.density;
    u.uCloudSigmaE.value = this.weather.sigmaE;
    u.uCloudErode.value = this.weather.erode;
    // Golden-ratio rotation so TAA integrates extra march steps for free.
    u.uCloudJitter.value = g.taa ? fract(ctx.frame * 0.6180339887) : 0.5;

    /* ---- water coupling ---- */
    this.syncWater(ctx, cam);

    /* ---- dome + shadow rig follow the camera ---- */
    this.dome.follow(cam.position);

    const underwater = (u.uUnderwater.value as number) > 0.5;
    const shadowDist = underwater
      ? Math.min(g.viewDistance * 0.34, 170)
      : Math.min(g.viewDistance * 0.5, 420);
    const shadowDir = this.sunIntensity > 0.02 ? this.sunDirection : this.moonDirection;
    if (shadowDir.y > 0.01) {
      sDir.copy(shadowDir);
    } else {
      // Keep the rig pointing somewhere sane when both bodies are down.
      sDir.set(this.sunDirection.x, 0.35, this.sunDirection.z).normalize();
    }
    this.shadows.update(this.sunLight, cam, sDir, shadowDist);

    /* ---- rain ---- */
    if (this.rain) {
      const above = !underwater;
      const amount = above ? this.rainIntensity : 0;
      sColor.copy(this.ambientColor).multiplyScalar(1.6).offsetHSL(0, -0.15, 0.12);
      this.rain.update(
        cam.position,
        ctx.time,
        amount,
        this.windDirection,
        this.windSpeed,
        sColor,
        u.uwSurfaceY.value as number,
      );
    }
  }

  /* ---------------------------------------------------------------- */

  /**
   * Cloud transmittance along the sun ray from the eye, sampled from the same
   * baked coverage field the dome shader marches. Three taps across the sun's
   * apparent path give a soft penumbra instead of a hard on/off.
   */
  private cloudSunTransmittance(camPos: THREE.Vector3): number {
    if (this.profile.cloudSteps <= 0) {
      // Low tier has no volumetric deck; approximate from coverage alone.
      return 1 - 0.55 * this.weather.coverage * this.weather.stormFactor;
    }
    const sy = Math.max(0.14, this.sunDirection.y);
    const mid = (this.weather.baseKm + this.weather.topKm) * 0.5;
    const tKm = mid / sy;
    const baseX = camPos.x * 0.001;
    const baseZ = camPos.z * 0.001;
    const thr = 1 - this.weather.coverage;
    const path = ((this.weather.topKm - this.weather.baseKm) / sy) * 0.55;
    let acc = 0;
    for (let i = 0; i < 3; i++) {
      const j = (i - 1) * 0.42;
      const px = baseX + this.sunDirection.x * (tKm + j);
      const pz = baseZ + this.sunDirection.z * (tKm + j);
      const cov = this.clouds.coverageAt(px, pz, this.cloudOffset.x, this.cloudOffset.y);
      const shape = Math.max(0, Math.min(1, (cov - thr) / Math.max(1e-3, 1 - thr)));
      acc += Math.exp(-shape * this.weather.density * this.weather.sigmaE * path);
    }
    // Never let it hit zero: broken cloud always leaks some direct light.
    return Math.max(0.11, acc / 3);
  }

  /** Cosine-weighted hemisphere integration of the CPU sky model. */
  private computeAmbient(observerR: number): void {
    sAmbient.setRGB(0, 0, 0);
    const sunAz = Math.hypot(this.sunDirection.x, this.sunDirection.z);
    const ax = sunAz > 1e-4 ? this.sunDirection.x / sunAz : 1;
    const az = sunAz > 1e-4 ? this.sunDirection.z / sunAz : 0;
    for (let i = 0; i < AMBIENT_TAPS.length; i++) {
      const t = AMBIENT_TAPS[i];
      if (i === 5) sDir.set(ax * 0.98, 0.19, az * 0.98).normalize();
      else if (i === 6) sDir.set(ax * 0.78, 0.62, az * 0.78).normalize();
      else sDir.set(t[0], t[1], t[2]).normalize();
      this.cpu.skyRadiance(observerR, sDir, this.sunDirection, sColor);
      sAmbient.r += sColor.r * t[3];
      sAmbient.g += sColor.g * t[3];
      sAmbient.b += sColor.b * t[3];
    }

    // Overcast decks bounce light back down; storms grey it out.
    const storm = this.weather.stormFactor;
    const cov = this.weather.coverage;
    const bounce = 1 + 0.45 * cov * Math.max(0, this.sunDirection.y) * this.sunOcclusion;
    sAmbient.multiplyScalar(bounce);
    const grey = 0.2126 * sAmbient.r + 0.7152 * sAmbient.g + 0.0722 * sAmbient.b;
    sAmbient.lerp(sColor2.setRGB(grey * 1.02, grey * 1.04, grey * 1.1), storm * 0.55);

    // Moonlight + airglow floor so the night is blue, not black.
    const moonUp = Math.max(0, this.moonDirection.y);
    const nightFade = 1 - smoothstep(-0.02, 0.12, this.sunDirection.y);
    const m = this.celestial.moonIllum * moonUp * nightFade * 0.028;
    sAmbient.r += m * 0.5 + 0.0022 * nightFade;
    sAmbient.g += m * 0.66 + 0.0030 * nightFade;
    sAmbient.b += m * 1.0 + 0.0052 * nightFade;

    this.ambientTarget.copy(sAmbient);
  }

  /** Mirror the water system's shared uniforms so Snell's window is graded. */
  private syncWater(ctx: GameContext, cam: THREE.PerspectiveCamera): void {
    const u = this.dome.uniforms;
    const water = ctx.tryGet<GameSystem & {
      sharedUniforms?: Record<string, THREE.IUniform>;
      underwater?: boolean;
      cameraDepth?: number;
    }>('world.water');

    const shared = water?.sharedUniforms;
    if (shared) {
      copyVec3(shared.uwExtinction, u.uwExtinction);
      copyColor(shared.uwInscatter, u.uwInscatter);
      if (typeof shared.uwSurfaceY?.value === 'number') u.uwSurfaceY.value = shared.uwSurfaceY.value;
      if (typeof shared.uwDensity?.value === 'number') u.uwDensity.value = shared.uwDensity.value;
      if (typeof shared.uwCameraDepth?.value === 'number') u.uwCameraDepth.value = shared.uwCameraDepth.value;
      // The water block's own sun terms are ours to publish.
      copyInto(shared.uwSunDir, this.sunDirection);
      copyIntoColor(shared.uwSunColor, this.sunColor, this.sunIntensity);
      if (shared.uwTime) shared.uwTime.value = ctx.time;
    } else {
      u.uwSurfaceY.value = 0;
      u.uwCameraDepth.value = Math.max(0, -cam.position.y);
    }
    (u.uwSunDir.value as THREE.Vector3).copy(this.sunDirection);
    (u.uwSunColor.value as THREE.Color).copy(this.sunColor).multiplyScalar(Math.min(4, this.sunIntensity));
    u.uwTime.value = ctx.time;
    u.uEyeY.value = cam.position.y;

    const surfaceY = u.uwSurfaceY.value as number;
    const under = water?.underwater ?? cam.position.y < surfaceY;
    u.uUnderwater.value = under && this.applyUnderwaterAttenuation ? 1 : 0;
    if (under && typeof water?.cameraDepth !== 'number') {
      u.uwCameraDepth.value = Math.max(0, surfaceY - cam.position.y);
    }

    // Sea hemisphere tint tracks the water body colour so the IBL lower half and
    // any horizon gap agree with the ocean the water system actually draws.
    const insc = u.uwInscatter.value as THREE.Color;
    (u.uSeaTint.value as THREE.Vector3).set(
      insc.r * 0.16 + 0.002,
      insc.g * 0.20 + 0.004,
      insc.b * 0.24 + 0.006,
    );
  }

  /* ---------------------------------------------------------------- */

  private refreshEnvironment(ctx: GameContext): void {
    if (!this.cubeCamera || !this.cubeRt || !this.pmrem) return;
    this.envTimer = 0;
    this.lastEnvSunY = this.sunDirection.y;
    this.dome.setEnvPass(true);
    const prevUnder = this.dome.uniforms.uUnderwater.value;
    this.dome.uniforms.uUnderwater.value = 0;
    this.cubeCamera.update(ctx.renderer, this.dome.envScene);
    this.dome.uniforms.uUnderwater.value = prevUnder;
    this.dome.setEnvPass(false);
    this.envTarget = this.pmrem.fromCubemap(this.cubeRt.texture, this.envTarget);
    this.environment = this.envTarget.texture;
    if (ctx.scene.environment !== this.environment) ctx.scene.environment = this.environment;
  }

  private reconfigure(ctx: GameContext): void {
    const g = ctx.settings.graphics;
    const next = profileFor(g.tier);
    this.profile = next;
    this.dome.setCloudBudget(next.cloudSteps, next.cloudLightSteps);
    this.dome.uniforms.uStarBrightness.value = next.starBrightness;
    this.dome.setResolution(ctx.height * ctx.pixelRatio, g.fov);
    this.shadows.configure(g.shadowCascades, g.shadowMapSize, g.tier);
    this.shadows.applyTo(this.sunLight);
    if (this.rain) this.rain.mesh.visible = next.rainCount > 0 && this.rainIntensity > 0;
  }

  resize(_w: number, h: number, ctx: GameContext): void {
    this.dome.setResolution(h * ctx.pixelRatio, ctx.settings.graphics.fov);
  }

  /* ---------------------------------------------------------------- */

  /** CPU sky radiance in a direction — for fog tinting, HUD, audio moods. */
  skyRadiance(dir: THREE.Vector3, out: THREE.Color): THREE.Color {
    return this.cpu.skyRadiance(ATMO.groundR + 0.0015, dir, this.sunDirection, out);
  }

  /** Suggested significant wave height, metres, from the current wind. */
  get waveHeight(): number {
    const w = this.windSpeed;
    return Math.min(6.5, 0.0018 * w * w * 1.6 + 0.08);
  }

  dispose(): void {
    this.dome?.dispose();
    this.luts?.dispose();
    this.clouds?.dispose();
    this.rain?.dispose();
    this.sunLight?.shadow.map?.dispose();
    this.sunLight?.shadow.mapPass?.dispose();
    this.sunLight?.dispose();
    this.moonLight?.dispose();
    this.hemiLight?.dispose();
    this.cubeRt?.dispose();
    this.envTarget?.dispose();
    this.pmrem?.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function fract(x: number): number {
  return x - Math.floor(x);
}

const sVecTmp = new THREE.Vector3();
function sVecSet(x: number, y: number, z: number): THREE.Vector3 {
  return sVecTmp.set(x, y, z);
}

function copyVec3(from: THREE.IUniform | undefined, to: THREE.IUniform): void {
  const v = from?.value;
  if (v instanceof THREE.Vector3) (to.value as THREE.Vector3).copy(v);
}

function copyColor(from: THREE.IUniform | undefined, to: THREE.IUniform): void {
  const v = from?.value;
  if (v instanceof THREE.Color) (to.value as THREE.Color).copy(v);
  else if (v instanceof THREE.Vector3) (to.value as THREE.Color).setRGB(v.x, v.y, v.z);
}

function copyInto(target: THREE.IUniform | undefined, v: THREE.Vector3): void {
  const t = target?.value;
  if (t instanceof THREE.Vector3) t.copy(v);
}

function copyIntoColor(target: THREE.IUniform | undefined, c: THREE.Color, scale: number): void {
  const t = target?.value;
  const k = Math.min(4, scale);
  if (t instanceof THREE.Color) t.setRGB(c.r * k, c.g * k, c.b * k);
  else if (t instanceof THREE.Vector3) t.set(c.r * k, c.g * k, c.b * k);
}

/** 64x64 hash pattern used only if the texture library has no blue noise yet. */
function makeFallbackNoise(): THREE.Texture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const v = (fract(Math.sin(i * 12.9898) * 43758.5453) * 255) | 0;
    data[i * 4] = v;
    data[i * 4 + 1] = (fract(Math.sin(i * 78.233) * 24634.6345) * 255) | 0;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
