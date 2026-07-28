/**
 * The dive light: a real `THREE.SpotLight` plus a raymarch-free volumetric cone.
 *
 * The cone is a single additive mesh whose fragment shader integrates a
 * plausible medium along the view ray: radial and axial falloff, inverse-square
 * intensity, Henyey–Greenstein forward scatter so the beam blooms when you look
 * down it, drifting particulate inside the beam, and wavelength-dependent
 * extinction taken from the water system's shared uniforms so the beam turns
 * teal with depth exactly like the rest of the frame.
 *
 * The spot light is created once and never toggled structurally — turning the
 * lamp off drops its intensity and parks its shadow update, which avoids the
 * full shader recompile that adding/removing a light would cause.
 */
import * as THREE from 'three';
import { NOISE_GLSL } from '../core/Noise';
import type { GameContext } from '../core/Types';

const CONE_HEIGHT = 8;
const CONE_ANGLE = 0.42;

export class Flashlight {
  readonly light: THREE.SpotLight;
  readonly cone: THREE.Mesh;
  private coneMat: THREE.ShaderMaterial;
  private coneGeo: THREE.ConeGeometry;
  private target = new THREE.Object3D();
  private on = false;
  private lit = 0;
  private flicker = 0;

  constructor(water: Record<string, THREE.IUniform> | undefined, shadows: boolean, shadowSize: number) {
    this.light = new THREE.SpotLight(0xfff2d8, 0, 34, CONE_ANGLE * 1.08, 0.42, 1.6);
    this.light.name = 'player.flashlight';
    this.light.position.set(0, 0, 0);
    this.target.position.set(0, 0, -6);
    this.light.target = this.target;
    this.light.castShadow = shadows;
    if (shadows) {
      this.light.shadow.mapSize.set(Math.min(1024, shadowSize), Math.min(1024, shadowSize));
      this.light.shadow.camera.near = 0.4;
      this.light.shadow.camera.far = 30;
      this.light.shadow.bias = -0.0006;
      this.light.shadow.normalBias = 0.03;
      this.light.shadow.autoUpdate = false;
    }

    // Cone: apex at the origin, opening toward −Z.
    const baseRadius = CONE_HEIGHT * Math.tan(CONE_ANGLE);
    this.coneGeo = new THREE.ConeGeometry(baseRadius, CONE_HEIGHT, 28, 6, true);
    this.coneGeo.rotateX(Math.PI / 2);
    this.coneGeo.translate(0, 0, -CONE_HEIGHT / 2);

    const uniforms: Record<string, THREE.IUniform> = {
      uConeHeight: { value: CONE_HEIGHT },
      uConeRadius: { value: baseRadius },
      uConeColor: { value: new THREE.Color(0xffeccd).convertSRGBToLinear() },
      uConeIntensity: { value: 0 },
      uParticulate: { value: 1 },
      uTime: { value: 0 },
      uSubmerged: { value: 1 },
    };
    if (water) for (const k of Object.keys(water)) uniforms[k] = water[k];

    this.coneMat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec3 vLocal;
        varying vec3 vWorld;
        varying vec3 vView;
        void main() {
          vLocal = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = mv.xyz;
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vLocal;
        varying vec3 vWorld;
        varying vec3 vView;
        uniform float uConeHeight;
        uniform float uConeRadius;
        uniform vec3  uConeColor;
        uniform float uConeIntensity;
        uniform float uParticulate;
        uniform float uTime;
        uniform float uSubmerged;
        uniform vec3  uwExtinction;
        uniform float uwDensity;
        uniform float uwSurfaceY;
        ${NOISE_GLSL}
        void main() {
          float t = clamp(-vLocal.z / uConeHeight, 0.0, 1.0);
          float rMax = max(1e-4, t * uConeRadius);
          float r = length(vLocal.xy) / rMax;

          // Soft shoulder across the cone and a soft cap at the far end.
          float radial = pow(clamp(1.0 - r, 0.0, 1.0), 2.4);
          float axial = 1.0 / (1.0 + pow(t * uConeHeight, 1.85) * 0.09);
          float near = smoothstep(0.0, 0.06, t);
          float far = 1.0 - smoothstep(0.55, 1.0, t);

          // Looking down the beam scatters more light toward the eye.
          vec3 vd = normalize(vView);
          float cosT = clamp(dot(vd, vec3(0.0, 0.0, -1.0)), -1.0, 1.0);
          float g = 0.6;
          float hg = (1.0 - g * g) / (4.0 * 3.14159265 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));

          // Particulate drifting through the beam: this is what makes it read
          // as a volume instead of a decal.
          vec3 dp = vWorld * 1.35 + vec3(0.0, uTime * 0.16, uTime * 0.05);
          float dust = fbm3(dp, 3) * 0.5 + 0.5;
          dust = mix(1.0, 0.35 + dust * 1.5, clamp(uParticulate, 0.0, 2.0) * 0.7);

          // Wavelength-dependent loss along the beam path.
          float pathLen = t * uConeHeight;
          vec3 ext = exp(-uwExtinction * pathLen * uwDensity * uSubmerged);

          float a = radial * axial * near * far * (0.55 + hg * 2.2) * dust;
          vec3 col = uConeColor * ext * a * uConeIntensity;
          gl_FragColor = vec4(col, a * uConeIntensity * 0.85);
        }
      `,
    });

    this.cone = new THREE.Mesh(this.coneGeo, this.coneMat);
    this.cone.name = 'player.flashlight.cone';
    this.cone.frustumCulled = false;
    this.cone.renderOrder = 6;
    this.cone.visible = false;
    this.light.add(this.target);
  }

  /** Attach the lamp to a mount (the tool's lamp socket). */
  attach(mount: THREE.Object3D): void {
    if (this.light.parent !== mount) mount.add(this.light);
    if (this.cone.parent !== mount) mount.add(this.cone);
  }

  detach(): void {
    this.light.removeFromParent();
    this.cone.removeFromParent();
  }

  setOn(on: boolean): void {
    this.on = on;
    if (this.light.castShadow) this.light.shadow.autoUpdate = on;
  }

  get isOn(): boolean {
    return this.on;
  }

  update(dt: number, ctx: GameContext, submerged: boolean, depth: number): void {
    // Ramp so the lamp warms up instead of popping.
    this.lit += ((this.on ? 1 : 0) - this.lit) * Math.min(1, dt * 9);
    this.flicker += dt;
    const flick = 1 + Math.sin(this.flicker * 27.7) * 0.018 + Math.sin(this.flicker * 6.3) * 0.012;

    // A dive light reads brighter the deeper you are because the ambient falls
    // away; keep the physical intensity constant and let exposure do the work.
    this.light.intensity = this.lit * 34 * flick;
    this.light.distance = 34;
    this.light.visible = this.lit > 0.01;

    const g = ctx.settings.graphics;
    const showCone = this.lit > 0.02 && g.particulate > 0.05;
    this.cone.visible = showCone;
    if (showCone) {
      const u = this.coneMat.uniforms;
      u.uConeIntensity.value = this.lit * (submerged ? 1 : 0.35) * flick;
      u.uParticulate.value = g.particulate * (1 + Math.min(1, depth / 320));
      u.uTime.value = ctx.time;
      u.uSubmerged.value = submerged ? 1 : 0.15;
    }
  }

  dispose(): void {
    this.detach();
    this.coneGeo.dispose();
    this.coneMat.dispose();
    this.light.dispose();
  }
}
