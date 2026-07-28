import * as THREE from 'three';
import { Phase } from '../../core/Types';
import type { GameContext, GameSystem } from '../../core/Types';

/** BASELINE — replaced by the sky/atmosphere agent. */
export class SkySystem implements GameSystem {
  readonly name = 'world.sky';
  readonly phase = Phase.PreRender;

  readonly sunDirection = new THREE.Vector3(0.3, 0.85, 0.42).normalize();
  readonly sunColor = new THREE.Color(1.0, 0.96, 0.88);
  sunIntensity = 3.2;
  readonly moonDirection = new THREE.Vector3(-0.3, -0.85, -0.42);
  readonly ambientColor = new THREE.Color(0.25, 0.42, 0.5);
  timeOfDay = 12.5;
  dayLength = 1200;
  stormFactor = 0;
  environment!: THREE.Texture;
  sunLight!: THREE.DirectionalLight;

  private hemi!: THREE.HemisphereLight;

  init(ctx: GameContext): void {
    this.sunLight = new THREE.DirectionalLight(this.sunColor, this.sunIntensity);
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(300);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 700;
    const c = this.sunLight.shadow.camera;
    c.left = -140; c.right = 140; c.top = 140; c.bottom = -140;
    c.updateProjectionMatrix();
    ctx.scene.add(this.sunLight, this.sunLight.target);

    this.hemi = new THREE.HemisphereLight(0x9fd8e6, 0x2b3a2a, 0.55);
    ctx.scene.add(this.hemi);

    const pmrem = new THREE.PMREMGenerator(ctx.renderer);
    const env = pmrem.fromScene(makeGradientScene(), 0.04);
    this.environment = env.texture;
    ctx.scene.environment = this.environment;
    pmrem.dispose();
  }

  update(dt: number, ctx: GameContext): void {
    this.timeOfDay = (this.timeOfDay + (dt / this.dayLength) * 24) % 24;
    const a = ((this.timeOfDay - 6) / 12) * Math.PI;
    this.sunDirection.set(Math.cos(a) * 0.55, Math.sin(a), 0.4).normalize();
    this.moonDirection.copy(this.sunDirection).negate();
    this.sunIntensity = Math.max(0, Math.sin(a)) * 3.4 + 0.05;
    this.sunLight.intensity = this.sunIntensity;
    this.sunLight.color.copy(this.sunColor);
    this.sunLight.position.copy(ctx.camera.position).addScaledVector(this.sunDirection, 260);
    this.sunLight.target.position.copy(ctx.camera.position);
    this.sunLight.target.updateMatrixWorld();
  }

  dispose(): void {
    this.environment?.dispose();
  }
}

function makeGradientScene(): THREE.Scene {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec3 vD;
      void main(){
        float t = clamp(normalize(vD).y*0.5+0.5, 0.0, 1.0);
        vec3 c = mix(vec3(0.04,0.10,0.14), vec3(0.35,0.62,0.82), pow(t,0.6));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  s.add(new THREE.Mesh(geo, mat));
  return s;
}
