/**
 * Soft contact-shadow blobs for creatures near the sea floor.
 *
 * A single instanced quad pass. Not a substitute for the real cascaded shadow
 * map (large species also cast those) — this is the grounding cue that stops
 * small fish reading as decals floating in front of the sand.
 *
 * Alpha falls off with height above the floor and washes out with distance
 * using the same extinction the water shader uses, so a blob never survives
 * further than the geometry around it.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;    // radius, alpha
varying vec2  vUvB;
varying float vAlphaB;
varying float vDistB;
void main() {
  vUvB = uv;
  vAlphaB = iSize.y;
  vec3 p = vec3(position.x * iSize.x, 0.0, position.y * iSize.x) + iPos;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDistB = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3  uwExtinction;
uniform float uwDensity;
varying vec2  vUvB;
varying float vAlphaB;
varying float vDistB;
void main() {
  vec2 d = vUvB * 2.0 - 1.0;
  float r = length(d);
  // Soft, slightly lumpy edge — a perfect circle reads as a decal.
  float lump = 1.0 + 0.14 * sin(atan(d.y, d.x) * 5.0 + vAlphaB * 21.0);
  float a = 1.0 - smoothstep(0.25, 1.0 * lump, r);
  a *= a;
  float wash = exp(-vDistB * dot(uwExtinction, vec3(0.3333)) * uwDensity * 1.6);
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * vAlphaB * wash * 0.72);
}
`;

export class ContactShadows {
  readonly mesh: THREE.InstancedMesh;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private posAttr: THREE.InstancedBufferAttribute;
  private sizeAttr: THREE.InstancedBufferAttribute;
  private n = 0;

  constructor(capacity: number, shared: Record<string, THREE.IUniform>) {
    this.geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    const pos = new Float32Array(capacity * 3);
    const size = new Float32Array(capacity * 2);
    this.posAttr = new THREE.InstancedBufferAttribute(pos, 3);
    this.sizeAttr = new THREE.InstancedBufferAttribute(size, 2);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.posAttr);
    this.geo.setAttribute('iSize', this.sizeAttr);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uwExtinction: shared.uwExtinction ?? { value: new THREE.Vector3(0.42, 0.09, 0.045) },
        uwDensity: shared.uwDensity ?? { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, capacity);
    this.mesh.name = 'fauna.contactShadows';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    // The quad geometry is unused for transforms; instance data drives it.
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  }

  begin(): void {
    this.n = 0;
  }

  /** Adds a blob under a creature. `alt` is metres above the floor. */
  add(x: number, floorY: number, z: number, radius: number, alt: number): void {
    const cap = this.sizeAttr.count;
    if (this.n >= cap) return;
    const fade = 1 - Math.min(1, alt / (radius * 5 + 2.5));
    if (fade <= 0.02) return;
    const i = this.n++;
    const p = this.posAttr.array as Float32Array;
    const s = this.sizeAttr.array as Float32Array;
    p[i * 3] = x;
    p[i * 3 + 1] = floorY + 0.06;
    p[i * 3 + 2] = z;
    s[i * 2] = radius * (1.35 + alt * 0.12);
    s[i * 2 + 1] = fade * fade;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) {
      this.posAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
