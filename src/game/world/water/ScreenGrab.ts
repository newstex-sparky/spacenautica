import * as THREE from 'three';

/**
 * Copies the currently bound framebuffer into a texture so a later draw in the
 * same frame can sample it. Used for screen-space refraction and total internal
 * reflection at the surface, and for the wet-lens droplets.
 *
 * The destination is allocated to match the live framebuffer's size *and* type
 * (the post stack renders to a half-float target, the bare engine to an 8-bit
 * default framebuffer) because `copyTexSubImage2D` refuses mismatched formats.
 * If a driver rejects the copy anyway we disable ourselves permanently rather
 * than spam a broken frame.
 */
export class ScreenGrab {
  private tex: THREE.FramebufferTexture | null = null;
  private w = 0;
  private h = 0;
  private type: THREE.TextureDataType = THREE.UnsignedByteType;
  private failed = false;
  readonly fallback: THREE.DataTexture;

  constructor(fallbackRGB: [number, number, number] = [10, 26, 30]) {
    this.fallback = new THREE.DataTexture(
      new Uint8Array([fallbackRGB[0], fallbackRGB[1], fallbackRGB[2], 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    this.fallback.needsUpdate = true;
  }

  get available(): boolean {
    return !this.failed;
  }

  get texture(): THREE.Texture {
    return this.tex ?? this.fallback;
  }

  /** Grabs the frame. Returns 1 when the texture is valid this frame, else 0. */
  capture(renderer: THREE.WebGLRenderer): number {
    if (this.failed) return 0;
    const target = renderer.getRenderTarget();
    const size = renderer.getDrawingBufferSize(_v2);
    const w = target ? target.width : Math.floor(size.x);
    const h = target ? target.height : Math.floor(size.y);
    const type = target ? target.texture.type : THREE.UnsignedByteType;
    if (w < 2 || h < 2) return 0;

    if (!this.tex || this.w !== w || this.h !== h || this.type !== type) {
      this.tex?.dispose();
      const t = new THREE.FramebufferTexture(w, h);
      t.type = type;
      t.format = THREE.RGBAFormat;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      this.tex = t;
      this.w = w;
      this.h = h;
      this.type = type;
    }

    try {
      renderer.copyFramebufferToTexture(this.tex);
      return 1;
    } catch (err) {
      console.warn('[water] framebuffer grab unavailable; refraction disabled', err);
      this.failed = true;
      return 0;
    }
  }

  /** Drops the texture so the next capture reallocates (call on resize). */
  invalidate(): void {
    this.tex?.dispose();
    this.tex = null;
    this.w = 0;
    this.h = 0;
  }

  dispose(): void {
    this.tex?.dispose();
    this.tex = null;
    this.fallback.dispose();
  }
}

const _v2 = new THREE.Vector2();
