import * as THREE from 'three';
import { PostPass, makeTarget } from '../FrameContext';
import type { FrameContext } from '../FrameContext';

/**
 * The main scene render. Draws into a linear half-float target — three only
 * applies tone mapping and the output transfer function when the destination is
 * the default framebuffer, so everything downstream stays scene-referred and the
 * grade pass owns the single tonemap + sRGB conversion.
 */
export class ScenePass extends PostPass {
  readonly id = 'scene';
  readonly target: THREE.WebGLRenderTarget;

  constructor(frame: FrameContext, width: number, height: number) {
    super(frame);
    this.target = makeTarget(width, height, { depthBuffer: true, name: 'post.scene' });
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  protected execute(frame: FrameContext): void {
    const renderer = frame.renderer;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.target);
    renderer.render(frame.scene, frame.camera);
    renderer.autoClear = prevAutoClear;
    frame.color = this.target.texture;
  }

  override dispose(): void {
    this.target.dispose();
  }
}
