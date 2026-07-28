import * as THREE from 'three';
import { mulberry32 } from '../../core/Noise';

/**
 * Above-water rain. One InstancedMesh of camera-facing streaks that wrap inside
 * a box locked to the camera, so density is constant no matter where the player
 * swims. Streak length tracks wind speed, and the whole curtain is lit by the
 * sky colour handed in by the sky system, so rain in a storm is grey and rain at
 * sunset is warm.
 */

const RAIN_VERT = /* glsl */ `
attribute vec3 aSeed;      // x,z in 0..1, z channel = spawn lottery
attribute vec2 aVar;       // x = size jitter, y = speed jitter

uniform vec3  uCamPos;
uniform vec3  uBox;        // half extents (x, y, z)
uniform vec2  uWind;
uniform float uTime;
uniform float uAmount;     // 0..1 fraction of instances alive
uniform float uLength;
uniform float uWidth;
uniform float uSpeed;
uniform float uSurfaceY;

varying float vFade;
varying float vAlong;

void main() {
  if (aSeed.z > uAmount) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vFade = 0.0;
    vAlong = 0.0;
    return;
  }

  float speed = uSpeed * (0.78 + 0.44 * aVar.y);
  float h = uBox.y * 2.0;
  // Column position is stable in world space over short spans, then wraps to a
  // box around the camera so the curtain follows the player seamlessly.
  vec2 cell = floor(uCamPos.xz / (uBox.xz * 2.0) + 0.5) * (uBox.xz * 2.0);
  vec2 xz = cell + (aSeed.xz - 0.5) * uBox.xz * 2.0;
  xz += uWind * uTime * 0.35;
  xz = cell + mod(xz - cell + uBox.xz, uBox.xz * 2.0) - uBox.xz;

  float y = uCamPos.y + uBox.y - mod(aSeed.x * 137.0 + aSeed.z * 71.0 + uTime * speed, h);
  vec3 base = vec3(xz.x, y, xz.y);

  vec3 fall = normalize(vec3(uWind.x * 0.11, -1.0, uWind.y * 0.11));
  vec3 toCam = uCamPos - base;
  float dist = length(toCam);
  toCam /= max(dist, 1e-3);
  vec3 side = cross(fall, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);

  float len = uLength * (0.6 + 0.9 * aVar.x) * (0.55 + speed * 0.035);
  float wid = uWidth * (0.65 + 0.8 * aVar.x);

  vec3 world = base + side * (position.x * wid) - fall * (position.y * len);

  // Fade at the box edge, very close to the eye, and at the sea surface.
  vFade = smoothstep(uBox.x * 1.02, uBox.x * 0.55, length(base.xz - uCamPos.xz))
        * smoothstep(0.35, 1.6, dist)
        * smoothstep(-0.25, 0.7, base.y - uSurfaceY);
  vAlong = position.y + 0.5;

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const RAIN_FRAG = /* glsl */ `
precision mediump float;
uniform vec3  uColor;
uniform float uOpacity;
varying float vFade;
varying float vAlong;

void main() {
  if (vFade <= 0.0) discard;
  // Bright head, tapered tail.
  float a = vFade * uOpacity * (0.25 + 0.75 * pow(vAlong, 2.0));
  gl_FragColor = vec4(uColor * a, a);
}
`;

export class RainCurtain {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly count: number;

  constructor(count: number, seed = 4477) {
    this.count = Math.max(1, count);
    const geo = new THREE.InstancedBufferGeometry();
    // Unit quad spanning -0.5..0.5 in x and y; the vertex shader orients it.
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        3,
      ),
    );
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.instanceCount = this.count;

    const rnd = mulberry32(seed);
    const seeds = new Float32Array(this.count * 3);
    const vars = new Float32Array(this.count * 2);
    for (let i = 0; i < this.count; i++) {
      seeds[i * 3] = rnd();
      seeds[i * 3 + 1] = rnd();
      seeds[i * 3 + 2] = rnd();
      vars[i * 2] = rnd();
      vars[i * 2 + 1] = rnd();
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(vars, 2));
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: true,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(17, 11, 17) },
        uWind: { value: new THREE.Vector2(1, 0) },
        uTime: { value: 0 },
        uAmount: { value: 0 },
        uLength: { value: 0.75 },
        uWidth: { value: 0.014 },
        uSpeed: { value: 9 },
        uSurfaceY: { value: 0 },
        uColor: { value: new THREE.Color(0.7, 0.78, 0.9) },
        uOpacity: { value: 0.5 },
      },
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'sky.rain';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4000;
    this.mesh.visible = false;
  }

  update(
    camPos: THREE.Vector3,
    time: number,
    amount: number,
    wind: THREE.Vector2,
    windSpeed: number,
    tint: THREE.Color,
    surfaceY = 0,
  ): void {
    const u = this.material.uniforms;
    this.mesh.visible = amount > 0.005;
    if (!this.mesh.visible) return;
    u.uSurfaceY.value = surfaceY;
    (u.uCamPos.value as THREE.Vector3).copy(camPos);
    (u.uWind.value as THREE.Vector2).copy(wind).multiplyScalar(windSpeed);
    u.uTime.value = time;
    u.uAmount.value = amount;
    u.uSpeed.value = 8 + windSpeed * 0.35;
    u.uOpacity.value = 0.22 + 0.4 * amount;
    (u.uColor.value as THREE.Color).copy(tint);
    this.mesh.position.copy(camPos);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
