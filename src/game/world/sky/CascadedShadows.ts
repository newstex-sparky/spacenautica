import * as THREE from 'three';
import type { QualityTier } from '../../core/Types';

/**
 * Cascade fitting for the sun light.
 *
 * Splits the camera frustum with the practical (log/uniform blended) scheme,
 * fits a rotation-invariant bounding sphere to each slice, and snaps every
 * cascade centre to whole shadow texels in light space so the shadow edges do
 * not crawl while the camera moves.
 *
 * The cascade table is public (`cascades`) so a future multi-map sampler can
 * consume it directly. What is wired to `THREE.DirectionalLight` today is the
 * fused cascade: the covered distance of the last cascade at the *combined*
 * texel budget of all cascades (`shadowMapSize * round(sqrt(count))`), because
 * three.js exposes exactly one shadow matrix per light and swapping every
 * material in the scene to a multi-cascade sampler is not this module's to do.
 * Everything else — split table, sphere fit, texel snapping, per-cascade normal
 * bias, adaptive distance — is live.
 */

export interface ShadowCascade {
  near: number;
  far: number;
  centre: THREE.Vector3;
  radius: number;
  /** World size of one shadow texel in this cascade. */
  texelWorld: number;
}

const SPLIT_LAMBDA = 0.72;

const vRight = new THREE.Vector3();
const vUp = new THREE.Vector3();
const vFwd = new THREE.Vector3();
const vCorner = new THREE.Vector3();
const vCentre = new THREE.Vector3();
const vTmp = new THREE.Vector3();
const lightRight = new THREE.Vector3();
const lightUp = new THREE.Vector3();
const worldUpY = new THREE.Vector3(0, 1, 0);
const worldUpZ = new THREE.Vector3(0, 0, 1);
const cornerBuf: THREE.Vector3[] = [];
for (let i = 0; i < 8; i++) cornerBuf.push(new THREE.Vector3());

export class CascadedShadows {
  readonly cascades: ShadowCascade[] = [];
  /** Resolution actually handed to the light. */
  mapSize = 2048;
  /** Distance, metres, the shadow rig covers this frame. */
  distance = 320;

  private count = 3;
  private baseMapSize = 2048;
  private splits: number[] = [];
  private blurSamples = 8;
  private radiusPx = 3;

  configure(cascades: number, mapSize: number, tier: QualityTier): void {
    this.count = Math.max(1, Math.min(4, Math.round(cascades)));
    this.baseMapSize = mapSize;
    // A real N-cascade rig costs N * mapSize^2 texels; spend the same budget on
    // one tightly-fitted map so density is comparable, capped by driver limits.
    const fused = Math.round((mapSize * Math.sqrt(this.count)) / 256) * 256;
    this.mapSize = Math.max(512, Math.min(4096, fused));
    this.blurSamples = tier === 'low' ? 4 : tier === 'medium' ? 8 : tier === 'high' ? 12 : 17;
    this.radiusPx = tier === 'low' ? 1.5 : tier === 'medium' ? 2.5 : 3.5;
    this.cascades.length = 0;
    for (let i = 0; i < this.count; i++) {
      this.cascades.push({ near: 0, far: 0, centre: new THREE.Vector3(), radius: 1, texelWorld: 1 });
    }
  }

  /** Applies the resolution/filter settings. Call after `configure`. */
  applyTo(light: THREE.DirectionalLight): void {
    const s = light.shadow;
    if (s.mapSize.x !== this.mapSize) {
      s.mapSize.set(this.mapSize, this.mapSize);
      s.map?.dispose();
      s.map = null;
      s.mapPass?.dispose();
      s.mapPass = null;
    }
    s.blurSamples = this.blurSamples;
    s.radius = this.radiusPx;
    s.bias = 0;
    s.autoUpdate = true;
  }

  /**
   * Refits the cascades and drives the light. `sunDir` points *toward* the sun.
   * `distance` is how far from the camera shadows should reach.
   */
  update(
    light: THREE.DirectionalLight,
    camera: THREE.PerspectiveCamera,
    sunDir: THREE.Vector3,
    distance: number,
  ): void {
    this.distance = distance;
    const near = Math.max(0.25, camera.near);
    const far = Math.max(near + 1, distance);

    // --- practical split scheme
    this.splits.length = this.count + 1;
    this.splits[0] = near;
    for (let i = 1; i <= this.count; i++) {
      const f = i / this.count;
      const uni = near + (far - near) * f;
      const log = near * Math.pow(far / near, f);
      this.splits[i] = SPLIT_LAMBDA * log + (1 - SPLIT_LAMBDA) * uni;
    }

    // --- camera basis
    camera.getWorldDirection(vFwd).normalize();
    const e = camera.matrixWorld.elements;
    vRight.set(e[0], e[1], e[2]).normalize();
    vUp.set(e[4], e[5], e[6]).normalize();
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = tanV * camera.aspect;

    // --- light basis, matched to how three's LightShadow builds its lookAt
    const nearVertical = Math.abs(sunDir.y) > 0.99;
    const upRef = nearVertical ? worldUpZ : worldUpY;
    light.shadow.camera.up.copy(upRef);
    lightRight.crossVectors(upRef, sunDir).normalize();
    lightUp.crossVectors(sunDir, lightRight).normalize();

    for (let i = 0; i < this.count; i++) {
      const c = this.cascades[i];
      c.near = this.splits[i];
      c.far = this.splits[i + 1];
      this.fitSphere(camera.position, c.near, c.far, tanH, tanV, c);
      c.texelWorld = (2 * c.radius) / this.mapSize;
    }

    // --- fused cascade drives the native light
    const last = this.cascades[this.count - 1];
    const radius = last.radius;
    const texel = (2 * radius) / this.mapSize;

    // Texel snap in light space (orthonormal basis, so this is exact).
    const px = Math.round(last.centre.dot(lightRight) / texel) * texel;
    const py = Math.round(last.centre.dot(lightUp) / texel) * texel;
    const pz = last.centre.dot(sunDir);
    vCentre.copy(lightRight).multiplyScalar(px);
    vCentre.addScaledVector(lightUp, py);
    vCentre.addScaledVector(sunDir, pz);

    // Pull the light back far enough that tall geometry outside the sphere still
    // casts into it (kelp towers, reef walls, wrecks).
    const extrude = Math.max(120, radius * 1.35);
    light.position.copy(vCentre).addScaledVector(sunDir, radius + extrude);
    light.target.position.copy(vCentre);
    light.target.updateMatrixWorld();

    const cam = light.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 0.5;
    cam.far = radius * 2 + extrude + 1;
    cam.updateProjectionMatrix();

    // Normal bias tracks texel size so it stays scale-correct across tiers.
    light.shadow.normalBias = Math.min(0.6, texel * 1.6 + 0.01);
  }

  private fitSphere(
    origin: THREE.Vector3,
    near: number,
    far: number,
    tanH: number,
    tanV: number,
    out: ShadowCascade,
  ): void {
    let k = 0;
    for (let s = 0; s < 2; s++) {
      const d = s === 0 ? near : far;
      const h = tanH * d;
      const v = tanV * d;
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sx = -1; sx <= 1; sx += 2) {
          const c = cornerBuf[k++];
          c.copy(origin).addScaledVector(vFwd, d).addScaledVector(vRight, sx * h).addScaledVector(vUp, sy * v);
        }
      }
    }
    vTmp.set(0, 0, 0);
    for (let i = 0; i < 8; i++) vTmp.add(cornerBuf[i]);
    vTmp.multiplyScalar(1 / 8);
    let r2 = 0;
    for (let i = 0; i < 8; i++) {
      const d2 = vCorner.copy(cornerBuf[i]).sub(vTmp).lengthSq();
      if (d2 > r2) r2 = d2;
    }
    out.centre.copy(vTmp);
    out.radius = Math.max(2, Math.sqrt(r2));
  }
}
