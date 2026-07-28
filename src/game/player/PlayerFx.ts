/**
 * Player-attached particle effects: exhaled bubbles and surface-break spray.
 *
 * Both are world-space point fields updated on the CPU (a couple of hundred
 * particles, well inside budget) and drawn with a procedural point shader — the
 * sprite shape, the bright rim and the specular highlight are all computed from
 * `gl_PointCoord`, so there is no sprite texture anywhere.
 *
 * Bubbles are released on the player's breath cycle, wobble on a sine as they
 * rise, accelerate as they expand, and are tinted by the shared underwater
 * extinction so a bubble at 200 m is not the same colour as one at 3 m.
 */
import * as THREE from 'three';
import type { GameContext } from '../core/Types';

const MAX_BUBBLES = 160;
const MAX_SPRAY = 220;

const _tmp = new THREE.Vector3();
const _cur = new THREE.Vector3();

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  seed: number;
}

function makeField(count: number, kind: 'bubble' | 'spray', water?: Record<string, THREE.IUniform>) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uniforms: Record<string, THREE.IUniform> = {
    uPixelScale: { value: 700 },
    uTint: {
      value:
        kind === 'bubble'
          ? new THREE.Color(0.72, 0.88, 0.95)
          : new THREE.Color(0.95, 0.99, 1.0),
    },
    uRim: { value: kind === 'bubble' ? 1 : 0.35 },
    uOpacity: { value: kind === 'bubble' ? 0.55 : 0.8 },
  };
  if (water) for (const k of Object.keys(water)) uniforms[k] = water[k];

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: kind === 'bubble' ? THREE.NormalBlending : THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aSeed;
      varying float vSeed;
      varying float vDepth;
      varying vec3 vWorld;
      uniform float uPixelScale;
      void main() {
        vSeed = aSeed;
        vWorld = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uPixelScale / max(0.05, -mv.z), 1.0, 220.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying float vSeed;
      varying float vDepth;
      varying vec3 vWorld;
      uniform vec3 uTint;
      uniform float uRim;
      uniform float uOpacity;
      uniform vec3 uwExtinction;
      uniform float uwDensity;
      uniform float uwSurfaceY;
      uniform vec3 uwSunDir;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        float r = sqrt(r2);
        // Thin-shell shading: dark centre, bright rim, one specular dot.
        float shell = smoothstep(0.55, 1.0, r) * uRim;
        float body = (1.0 - r2) * 0.35;
        vec2 sp = p - normalize(uwSunDir.xz + vec2(0.001)) * 0.42;
        float spec = exp(-dot(sp, sp) * 26.0) * (0.6 + uRim * 0.8);
        float a = (body + shell * 0.9 + spec) * uOpacity * (1.0 - smoothstep(0.85, 1.0, r));
        float wdepth = max(0.0, uwSurfaceY - vWorld.y);
        vec3 ext = exp(-uwExtinction * (wdepth * 0.35 + vDepth) * uwDensity);
        gl_FragColor = vec4(uTint * ext * (0.5 + spec * 2.0), a);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  return { geo, mat, points, positions, sizes, seeds };
}

export class PlayerFx {
  private bubbles: Particle[] = [];
  private spray: Particle[] = [];
  private bubbleField: ReturnType<typeof makeField>;
  private sprayField: ReturnType<typeof makeField>;
  private lastBreath = 0;
  private group = new THREE.Group();

  constructor(water?: Record<string, THREE.IUniform>) {
    this.bubbleField = makeField(MAX_BUBBLES, 'bubble', water);
    this.sprayField = makeField(MAX_SPRAY, 'spray', water);
    this.group.name = 'player.fx';
    this.group.add(this.bubbleField.points, this.sprayField.points);
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.group);
  }

  /** A burst of exhaled bubbles from the regulator. */
  emitBubbles(origin: THREE.Vector3, dir: THREE.Vector3, count: number, force: number): void {
    for (let i = 0; i < count; i++) {
      if (this.bubbles.length >= MAX_BUBBLES) this.bubbles.shift();
      const spread = 0.55;
      this.bubbles.push({
        x: origin.x + (Math.random() - 0.5) * 0.06,
        y: origin.y + (Math.random() - 0.5) * 0.04,
        z: origin.z + (Math.random() - 0.5) * 0.06,
        vx: dir.x * force + (Math.random() - 0.5) * spread,
        vy: dir.y * force * 0.4 + 0.25 + Math.random() * 0.3,
        vz: dir.z * force + (Math.random() - 0.5) * spread,
        life: 0,
        maxLife: 2.6 + Math.random() * 3.4,
        size: 0.004 + Math.random() * Math.random() * 0.016,
        seed: Math.random() * 100,
      });
    }
  }

  /** Water thrown off the mask when the head breaks the surface. */
  emitSpray(origin: THREE.Vector3, up: number, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.spray.length >= MAX_SPRAY) this.spray.shift();
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 2.4;
      this.spray.push({
        x: origin.x + Math.cos(a) * 0.12 * Math.random(),
        y: origin.y + (Math.random() - 0.2) * 0.1,
        z: origin.z + Math.sin(a) * 0.12 * Math.random(),
        vx: Math.cos(a) * s,
        vy: up * (0.6 + Math.random() * 1.4),
        vz: Math.sin(a) * s,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.7,
        size: 0.003 + Math.random() * 0.01,
        seed: Math.random() * 100,
      });
    }
  }

  update(dt: number, ctx: GameContext, eye: THREE.Vector3, breathPhase: number, submerged: boolean): void {
    // Breath-synced release: one puff per exhale, only while submerged.
    const cycle = Math.floor(breathPhase / (Math.PI * 2));
    if (submerged && cycle !== this.lastBreath) {
      this.lastBreath = cycle;
      _tmp.set(0, 0.1, 0);
      this.emitBubbles(eye, _tmp, 5 + Math.floor(Math.random() * 5), 0.35);
    } else if (!submerged) {
      this.lastBreath = cycle;
    }

    /* --- bubbles ---------------------------------------------------- */
    const bf = this.bubbleField;
    let n = 0;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const p = this.bubbles[i];
      p.life += dt;
      if (p.life >= p.maxLife || p.y > ctx.world.waterHeightAt(p.x, p.z, ctx.time) - 0.02) {
        this.bubbles.splice(i, 1);
        continue;
      }
      // Bubbles expand as pressure drops, so they rise faster as they go.
      const grow = 1 + p.life * 0.12;
      const rise = 0.55 + p.size * 26 + p.life * 0.16;
      ctx.world.currentAt(p.x, p.y, p.z, ctx.time, _cur);
      const wob = Math.sin(ctx.time * 3.1 + p.seed) * 0.35;
      p.vx += (_cur.x * 0.8 + wob * 0.2 - p.vx) * Math.min(1, dt * 1.6);
      p.vz += (_cur.z * 0.8 - Math.cos(ctx.time * 2.7 + p.seed) * 0.07 - p.vz) * Math.min(1, dt * 1.6);
      p.vy += (rise - p.vy) * Math.min(1, dt * 2.2);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (n < MAX_BUBBLES) {
        bf.positions[n * 3] = p.x;
        bf.positions[n * 3 + 1] = p.y;
        bf.positions[n * 3 + 2] = p.z;
        bf.sizes[n] = p.size * grow;
        bf.seeds[n] = p.seed;
        n++;
      }
    }
    bf.geo.setDrawRange(0, n);
    if (n > 0) {
      (bf.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (bf.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
      (bf.geo.attributes.aSeed as THREE.BufferAttribute).needsUpdate = true;
    }
    bf.points.visible = n > 0;

    /* --- spray ------------------------------------------------------ */
    const sf = this.sprayField;
    let m = 0;
    for (let i = this.spray.length - 1; i >= 0; i--) {
      const p = this.spray[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.spray.splice(i, 1);
        continue;
      }
      p.vy -= 9.81 * dt;
      const drag = Math.exp(-2.4 * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (m < MAX_SPRAY) {
        sf.positions[m * 3] = p.x;
        sf.positions[m * 3 + 1] = p.y;
        sf.positions[m * 3 + 2] = p.z;
        sf.sizes[m] = p.size * (1 - p.life / p.maxLife) * 1.4;
        sf.seeds[m] = p.seed;
        m++;
      }
    }
    sf.geo.setDrawRange(0, m);
    if (m > 0) {
      (sf.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (sf.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
      (sf.geo.attributes.aSeed as THREE.BufferAttribute).needsUpdate = true;
    }
    sf.points.visible = m > 0;

    // Point size scales with the drawing-buffer height so bubbles are the same
    // physical size at every resolution.
    const scale = ctx.height * ctx.pixelRatio * 0.6;
    bf.mat.uniforms.uPixelScale.value = scale;
    sf.mat.uniforms.uPixelScale.value = scale;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.bubbleField.geo.dispose();
    this.bubbleField.mat.dispose();
    this.sprayField.geo.dispose();
    this.sprayField.mat.dispose();
    this.bubbles.length = 0;
    this.spray.length = 0;
  }
}
