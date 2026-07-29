/**
 * Standalone smoke harness for `world.water`.
 *
 * It boots the real `WaterSystem` against deliberately minimal stand-ins for
 * sky / terrain / player / post, so the water shaders can be compiled and
 * captured without depending on modules that other agents are editing at the
 * same time. `scripts/capture.mjs` drives it exactly like the real game
 * (`window.__GAME__`, `window.__READY__`, `player.position`, `sky.timeOfDay`).
 *
 * This is a test fixture, not part of the shipped game: nothing imports it and
 * the main bundle never sees it.
 */
import * as THREE from 'three';
import { Engine } from '../../../core/Engine';
import { Settings } from '../../../core/Settings';
import { Noise } from '../../../core/Noise';
import { Phase } from '../../../core/Types';
import type { GameContext, GameSystem } from '../../../core/Types';
import { WaterSystem } from '../WaterSystem';

/* ------------------------------------------------------------------ *
 * Stand-ins
 * ------------------------------------------------------------------ */

class StubTextures implements GameSystem {
  readonly name = 'assets.textures';
  readonly phase = Phase.PreUpdate;
  blueNoise!: THREE.Texture;

  init(): void {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      // Cheap but well-distributed: R2 low-discrepancy sequence per channel.
      data[i * 4] = ((i * 0.7548776662) % 1) * 255;
      data[i * 4 + 1] = ((i * 0.5698402909) % 1) * 255;
      data[i * 4 + 2] = ((i * 0.8191725134) % 1) * 255;
      data[i * 4 + 3] = 255;
    }
    this.blueNoise = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    this.blueNoise.wrapS = this.blueNoise.wrapT = THREE.RepeatWrapping;
    this.blueNoise.needsUpdate = true;
  }

  dispose(): void {
    this.blueNoise?.dispose();
  }
}

class StubSky implements GameSystem {
  readonly name = 'world.sky';
  readonly phase = Phase.PreRender;
  readonly sunDirection = new THREE.Vector3(0.28, 0.86, 0.42).normalize();
  readonly sunColor = new THREE.Color(1, 0.96, 0.88);
  readonly ambientColor = new THREE.Color(0.22, 0.4, 0.5);
  sunIntensity = 3.2;
  stormFactor = 0;
  timeOfDay = 12.5;
  sunLight!: THREE.DirectionalLight;

  init(ctx: GameContext): void {
    this.sunLight = new THREE.DirectionalLight(this.sunColor, this.sunIntensity);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 500;
    const c = this.sunLight.shadow.camera;
    c.left = -90;
    c.right = 90;
    c.top = 90;
    c.bottom = -90;
    c.updateProjectionMatrix();
    ctx.scene.add(this.sunLight, this.sunLight.target);
    ctx.scene.add(new THREE.HemisphereLight(0x8fd0e6, 0x24382c, 0.5));
  }

  update(_dt: number, ctx: GameContext): void {
    const a = ((this.timeOfDay - 6) / 12) * Math.PI;
    this.sunDirection.set(Math.cos(a) * 0.5, Math.sin(a), 0.42).normalize();
    this.sunIntensity = Math.max(0, Math.sin(a)) * 3.4 + 0.05;
    this.sunLight.intensity = this.sunIntensity;
    this.sunLight.position.copy(ctx.camera.position).addScaledVector(this.sunDirection, 160);
    this.sunLight.target.position.copy(ctx.camera.position);
    this.sunLight.target.updateMatrixWorld();
  }
}

/** A floor plus a few boulders, all stock MeshStandardMaterial on purpose. */
class StubFloor implements GameSystem {
  readonly name = 'world.terrain';
  readonly phase = Phase.World;
  readonly biomes = new Map();
  private noise = new Noise(20260728);
  private objs: THREE.Mesh[] = [];

  heightAt(x: number, z: number): number {
    return -18 - 16 * this.noise.fbm2(x * 0.004, z * 0.004, 4) - 9 * this.noise.ridged2(x * 0.02, z * 0.02, 3);
  }

  init(ctx: GameContext): void {
    const geo = new THREE.PlaneGeometry(700, 700, 260, 260);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc9b58c, roughness: 0.94 }));
    floor.receiveShadow = true;
    ctx.scene.add(floor);
    this.objs.push(floor);

    // Boulders: they cast the shadows that carve the god rays.
    for (let i = 0; i < 26; i++) {
      const r = 2 + this.noise.noise2(i * 3.1, 7.7) * 1.5 + 2;
      const g = new THREE.IcosahedronGeometry(r, 2);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < p.count; v++) {
        const s = 1 + 0.22 * this.noise.fbm3(p.getX(v) * 0.5, p.getY(v) * 0.5, p.getZ(v) * 0.5, 3);
        p.setXYZ(v, p.getX(v) * s, p.getY(v) * s * 0.8, p.getZ(v) * s);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6d6f63, roughness: 0.88 }));
      const ang = i * 2.399;
      const rad = 8 + i * 3.5;
      m.position.set(Math.cos(ang) * rad, 0, Math.sin(ang) * rad);
      m.position.y = this.heightAt(m.position.x, m.position.z) + r * 0.4;
      m.castShadow = true;
      m.receiveShadow = true;
      ctx.scene.add(m);
      this.objs.push(m);
    }

    const water = ctx.tryGet<WaterSystem>('world.water');
    const self = this;
    ctx.world = {
      heightAt: (x, z) => self.heightAt(x, z),
      normalAt: (x, z, out) => {
        const e = 0.7;
        return out
          .set(self.heightAt(x - e, z) - self.heightAt(x + e, z), 2 * e, self.heightAt(x, z - e) - self.heightAt(x, z + e))
          .normalize();
      },
      biomeAt: () => ({ id: 'shallows', weight: 1, weights: { shallows: 0.75, kelp_forest: 0.25 } }),
      isSolid: (x, y, z) => y < self.heightAt(x, z),
      waterHeightAt: (x, z, t) => water?.surfaceHeightAt(x, z, t) ?? 0,
      currentAt: (_x, _y, _z, _t, out) => out.set(0, 0, 0),
    };
  }

  dispose(): void {
    for (const o of this.objs) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }
}

class StubPlayer implements GameSystem {
  readonly name = 'player';
  readonly phase = Phase.Physics;
  readonly position = new THREE.Vector3(0, -6, 0);
  readonly velocity = new THREE.Vector3();
  yaw = 0.6;
  pitch = 0.2;
}

class StubRig implements GameSystem {
  readonly name = 'player.camera';
  readonly phase = Phase.Camera;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  update(_dt: number, ctx: GameContext): void {
    const p = ctx.get<StubPlayer>('player');
    this.euler.set(p.pitch, p.yaw, 0);
    ctx.camera.quaternion.setFromEuler(this.euler);
    ctx.camera.position.copy(p.position);
  }
}

/**
 * Minimal post stack: renders into a half-float target with a depth texture
 * (exercising both the framebuffer grab and the screen-space caustics path)
 * then blits it to the screen.
 */
class StubPost implements GameSystem {
  readonly name = 'render.post';
  readonly phase = Phase.PreRender;
  depthTexture!: THREE.DepthTexture;
  private rt!: THREE.WebGLRenderTarget;
  private quad!: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  init(ctx: GameContext): void {
    const w = Math.max(2, Math.floor(ctx.width * ctx.pixelRatio));
    const h = Math.max(2, Math.floor(ctx.height * ctx.pixelRatio));
    this.depthTexture = new THREE.DepthTexture(w, h);
    this.depthTexture.type = THREE.FloatType;
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthTexture: this.depthTexture,
    });
    const mat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: this.rt.texture } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      // three's fragment prefix already provides the tone-mapping and
      // colour-space helpers, so they must not be included again here.
      fragmentShader: `uniform sampler2D tSrc; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tSrc, vUv);
          c.rgb = ACESFilmicToneMapping(c.rgb);
          gl_FragColor = linearToOutputTexel(c);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const engine = ctx as unknown as Engine;
    engine.renderOverride = () => {
      const r = ctx.renderer;
      const tone = r.toneMapping;
      const cs = r.outputColorSpace;
      r.toneMapping = THREE.NoToneMapping;
      r.outputColorSpace = THREE.LinearSRGBColorSpace;
      r.setRenderTarget(this.rt);
      r.render(ctx.scene, ctx.camera);
      r.setRenderTarget(null);
      r.toneMapping = tone;
      r.outputColorSpace = cs;
      r.render(this.scene, this.cam);
    };
  }

  resize(w: number, h: number, ctx: GameContext): void {
    const pw = Math.max(2, Math.floor(w * ctx.pixelRatio));
    const ph = Math.max(2, Math.floor(h * ctx.pixelRatio));
    if (!this.rt) return;
    // three 0.185's RenderTarget.setSize() resizes `textures[]` but NOT an
    // attached depthTexture, so the FBO's attachments end up different sizes and
    // the driver rejects every draw into it with
    //   GL_INVALID_FRAMEBUFFER_OPERATION: Framebuffer is incomplete:
    //   Attachments are not all the same size
    // The engine's adaptive resolution changes the buffer size within the first
    // second, so this fires immediately and the frame goes pure black.
    if (this.depthTexture.image.width !== pw || this.depthTexture.image.height !== ph) {
      this.depthTexture.dispose();
      const d = new THREE.DepthTexture(pw, ph);
      d.type = THREE.FloatType;
      d.format = THREE.DepthFormat;
      d.minFilter = THREE.NearestFilter;
      d.magFilter = THREE.NearestFilter;
      this.depthTexture = d;
      this.rt.depthTexture = d;
    }
    this.rt.setSize(pw, ph);
  }

  dispose(): void {
    this.rt?.dispose();
    this.depthTexture?.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

declare global {
  interface Window {
    __GAME__?: Engine;
    __READY__?: boolean;
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const loader = document.getElementById('loading');
  const settings = new Settings();
  settings.applyPreset('high');
  const engine = new Engine({ canvas, settings });
  window.__GAME__ = engine;

  engine.register(new StubTextures());
  engine.register(new StubFloor());
  engine.register(new StubSky());
  engine.register(new WaterSystem());
  engine.register(new StubPlayer());
  engine.register(new StubRig());
  engine.register(new StubPost());

  await engine.boot();
  engine.start();

  let frames = 0;
  const mark = (): void => {
    if (++frames < 10) {
      requestAnimationFrame(mark);
      return;
    }
    window.__READY__ = true;
    loader?.classList.add('done');
  };
  requestAnimationFrame(mark);
}

boot().catch((err) => {
  console.error('[verify] fatal', err);
  const label = document.getElementById('loading-label');
  if (label) label.textContent = String(err);
});
