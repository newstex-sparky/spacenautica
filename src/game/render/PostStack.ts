import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';
import type { Engine } from '../core/Engine';

/**
 * Post-processing stack. Owns the frame: the engine delegates rendering here.
 * BASELINE — replaced by the rendering agent with TAA, GTAO, SSR, god rays,
 * DOF, motion blur and a filmic grade.
 */
export class PostStack implements GameSystem {
  readonly name = 'render.post';
  readonly phase = Phase.PreRender;

  composer!: EffectComposer;
  depthTexture!: THREE.DepthTexture;
  normalTexture!: THREE.Texture;

  protected renderTarget!: THREE.WebGLRenderTarget;
  protected bloom!: UnrealBloomPass;
  protected shakeAmount = 0;
  protected shakeTime = 0;
  protected focusDistance = 12;

  init(ctx: GameContext): void {
    const w = Math.max(1, Math.floor(ctx.width * ctx.pixelRatio));
    const h = Math.max(1, Math.floor(ctx.height * ctx.pixelRatio));

    this.depthTexture = new THREE.DepthTexture(w, h);
    this.depthTexture.type = THREE.FloatType;

    this.renderTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthTexture: this.depthTexture,
      samples: 0,
    });
    this.normalTexture = new THREE.Texture();

    this.composer = new EffectComposer(ctx.renderer, this.renderTarget);
    this.composer.addPass(new RenderPass(ctx.scene, ctx.camera));

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.7, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    (ctx as unknown as Engine).renderOverride = () => this.composer.render();
  }

  setFocusDistance(d: number): void {
    this.focusDistance = d;
  }

  addScreenShake(amount: number, duration: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  update(dt: number, ctx: GameContext): void {
    this.shakeTime = Math.max(0, this.shakeTime - dt);
    if (this.shakeTime <= 0) this.shakeAmount = 0;
    this.bloom.enabled = ctx.settings.graphics.bloom;
  }

  resize(w: number, h: number, ctx: GameContext): void {
    const pw = Math.max(1, Math.floor(w * ctx.pixelRatio));
    const ph = Math.max(1, Math.floor(h * ctx.pixelRatio));
    this.composer?.setSize(pw, ph);
    this.bloom?.setSize(pw, ph);
  }

  dispose(): void {
    this.composer?.dispose();
    this.renderTarget?.dispose();
    this.depthTexture?.dispose();
  }
}
