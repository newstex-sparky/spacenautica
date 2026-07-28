/**
 * Procedurally modelled first-person tools.
 *
 * Every tool is built from primitives that are tapered, eroded and greebled at
 * build time — no meshes, no textures, no animation data. Each one exposes the
 * sockets the hands attach to, a muzzle transform for lights and beams, and an
 * `update()` that drives its own moving parts (fold-out screens, spinning
 * hologram rings, pulsing coils, extending laser beams) from the shared
 * animation state.
 *
 * Tool space convention: business end toward −Z, up +Y, grip below and behind
 * the body. Two grip families:
 *   pistol — handle axis along Y (scanner, flashlight, builder, cannon, cutter)
 *   hammer — handle axis along Z (knife)
 */
import * as THREE from 'three';
import { mulberry32 } from '../core/Noise';
import type { ToolId } from './PlayerTypes';
import { VIEWMODEL_LAYER } from './PlayerTypes';
import { createViewModelMaterial } from './ViewModelMaterial';
import type { VmMaterial, VmMaterialOptions, VmStyle } from './ViewModelMaterial';
import { PartBuilder, erode, greeble, prim, roundBox, sagZ, taper, transform } from './VmGeometry';

/* ------------------------------------------------------------------ *
 * Animation state, shared by every tool
 * ------------------------------------------------------------------ */

export interface ToolAnimState {
  /** Seconds since the tool was created. */
  time: number;
  /** 0 = holstered, 1 = fully raised. */
  equip: number;
  /** 0..1 through the current use action; 0 when idle. */
  use: number;
  /** Trigger held this frame. */
  useActive: boolean;
  /** 0..1 charge-up for tools that ramp. */
  charge: number;
  /** Player depth in metres — dims the emissives near the surface. */
  depth: number;
  /** True while the flashlight beam is on. */
  lightOn: boolean;
}

/* ------------------------------------------------------------------ *
 * Grip sockets
 * ------------------------------------------------------------------ */

/** Where the closed fist's tube axis sits, in hand-local space. */
const GRIP_LOCAL = new THREE.Vector3(0, -0.02, -0.075);

export interface GripSocket {
  pos: THREE.Vector3;
  rot: THREE.Euler;
}

/** Hand wrapped around a vertical handle. `side` +1 right, −1 left. */
export function pistolGrip(handle: THREE.Vector3, side: 1 | -1): GripSocket {
  const rot = new THREE.Euler(0, 0, (side === 1 ? -1 : 1) * Math.PI * 0.5);
  const off = GRIP_LOCAL.clone().applyEuler(rot);
  return { pos: handle.clone().sub(off), rot };
}

/** Hand wrapped around a handle that runs fore-aft (knife, torch). */
export function hammerGrip(handle: THREE.Vector3, side: 1 | -1): GripSocket {
  const rot = new THREE.Euler(0, (side === 1 ? 1 : -1) * Math.PI * 0.5, 0);
  const off = GRIP_LOCAL.clone().applyEuler(rot);
  return { pos: handle.clone().sub(off), rot };
}

/* ------------------------------------------------------------------ *
 * Asset pool — tracks everything for disposal
 * ------------------------------------------------------------------ */

export class VmAssetPool {
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  constructor(private water: Record<string, THREE.IUniform> | undefined) {}

  mat(style: VmStyle, opts: VmMaterialOptions = {}): VmMaterial {
    const m = createViewModelMaterial(style, { water: this.water, ...opts });
    this.materials.push(m);
    return m;
  }

  track<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  trackAll(list: THREE.BufferGeometry[]): void {
    for (const g of list) this.geometries.push(g);
  }

  /** All view-model materials, so the system can refresh their uniforms. */
  get all(): readonly THREE.Material[] {
    return this.materials;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    this.materials.length = 0;
    this.geometries.length = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Tool instance
 * ------------------------------------------------------------------ */

export interface ToolInstance {
  id: ToolId;
  root: THREE.Group;
  twoHanded: boolean;
  right: GripSocket;
  left: GripSocket | null;
  /** Resting transform of the tool relative to the camera. */
  holdPos: THREE.Vector3;
  holdRot: THREE.Euler;
  /** How closed the holding hand is, 0..1. */
  gripAmount: number;
  /** Seconds for one use action. */
  useDuration: number;
  /** Does the action repeat while the trigger is held? */
  continuous: boolean;
  /** Additive kick on use: [z, y, pitch, roll]. */
  recoil: [number, number, number, number];
  /** Attach point for lights and beams (world-facing, −Z forward). */
  muzzle: THREE.Object3D | null;
  update(a: ToolAnimState, dt: number): void;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = false;
  m.layers.set(VIEWMODEL_LAYER);
  return m;
}

/** Rubber handle with finger grooves, shared by the pistol-grip tools. */
function buildPistolHandle(pool: VmAssetPool, handle: THREE.Vector3, mat: THREE.Material, seed: number): THREE.Mesh {
  const b = new PartBuilder(mulberry32(seed));
  const core = prim.cyl(0.0205, 0.0235, 0.092, 16, 3);
  taper(core, (t) => [1 - 0.06 * Math.sin(t * Math.PI), 1.18 - 0.1 * t]);
  transform(core, { pos: [handle.x, handle.y, handle.z], rot: [0.24, 0, 0] });
  erode(core, 0.0009, 55, seed % 13);
  b.add(core, { occ: 0.26, edge: 0.85, id: 0.2 });
  // Finger grooves: four rings the fingers actually land between.
  for (let i = 0; i < 4; i++) {
    const g = prim.torus(0.0212 - i * 0.0007, 0.0034, 7, 16);
    transform(g, {
      pos: [handle.x, handle.y + 0.03 - i * 0.021, handle.z - 0.0135 + i * 0.005],
      rot: [Math.PI / 2 + 0.24, 0, 0],
    });
    b.add(g, { occ: 0.4, edge: 1.3, id: 0.35 + i * 0.12 });
  }
  // Palm swell on the back of the grip.
  const swell = prim.sphere(0.016, 12, 9);
  transform(swell, { pos: [handle.x, handle.y + 0.012, handle.z + 0.017], scale: [0.85, 1.5, 0.6] });
  b.add(swell, { occ: 0.3, edge: 0.9, id: 0.7 });
  const geo = pool.track(b.build('tool.handle'));
  return mesh(geo, mat, 'handle');
}

/** Trigger + guard, shared. */
function buildTrigger(pool: VmAssetPool, at: THREE.Vector3, mat: THREE.Material, seed: number): THREE.Object3D {
  const pivot = new THREE.Object3D();
  pivot.position.copy(at);
  const b = new PartBuilder(mulberry32(seed));
  const t = prim.box(0.008, 0.026, 0.007, 1);
  roundBox(t, [0.004, 0.013, 0.0035], 3, 0.7);
  transform(t, { pos: [0, -0.012, 0], rot: [0.2, 0, 0] });
  b.add(t, { occ: 0.5, edge: 1.2, id: 0.55 });
  const geo = pool.track(b.build('tool.trigger'));
  pivot.add(mesh(geo, mat, 'trigger'));
  return pivot;
}

function guard(pool: VmAssetPool, at: THREE.Vector3, mat: THREE.Material, seed: number): THREE.Mesh {
  const b = new PartBuilder(mulberry32(seed));
  const g = prim.torus(0.026, 0.0055, 7, 18, Math.PI * 1.25);
  transform(g, { pos: [at.x, at.y, at.z], rot: [Math.PI / 2, 0.4, Math.PI * 0.62] });
  b.add(g, { occ: 0.34, edge: 1.15, id: 0.42 });
  return mesh(pool.track(b.build('tool.guard')), mat, 'guard');
}

/* ------------------------------------------------------------------ *
 * 1. Scanner
 * ------------------------------------------------------------------ */

function buildScanner(pool: VmAssetPool): ToolInstance {
  const root = new THREE.Group();
  root.name = 'tool.scanner';
  const shell = pool.mat('painted');
  const metal = pool.mat('metal');
  const rubber = pool.mat('rubber');
  const screenMat = pool.mat('emissive', { emissive: 0x4fe0ff, emissiveIntensity: 2.2 });
  const lensMat = pool.mat('glass', { emissive: 0x7fe8ff, emissiveIntensity: 0.6 });
  const handle = new THREE.Vector3(0, -0.058, 0.022);

  {
    const b = new PartBuilder(mulberry32(21));
    // Wedge body, thicker at the back where the electronics live.
    const body = prim.box(0.072, 0.052, 0.13, 3);
    roundBox(body, [0.036, 0.026, 0.065], 3.6, 0.7);
    taper(body, (t) => [0.9 + t * 0.12, 1]);
    transform(body, { pos: [0, 0.006, -0.018], rot: [0.05, 0, 0] });
    erode(body, 0.0009, 42, 4);
    b.add(body, { occ: 0.14, edge: 1, id: 0.22 });
    // Sensor snout.
    const snout = prim.cyl(0.019, 0.026, 0.05, 16, 2);
    transform(snout, { rot: [Math.PI / 2, 0, 0], pos: [0, 0.004, -0.096] });
    b.add(snout, { occ: 0.18, edge: 1.2, id: 0.61 });
    const collar = prim.torus(0.0215, 0.004, 7, 18);
    transform(collar, { pos: [0, 0.004, -0.118] });
    b.add(collar, { occ: 0.2, edge: 1.5, id: 0.77 });
    // Side rails, a battery hump and cooling vents.
    for (const s of [-1, 1]) {
      const rail = prim.box(0.008, 0.03, 0.09, 1);
      roundBox(rail, [0.004, 0.015, 0.045], 3, 0.6);
      transform(rail, { pos: [s * 0.037, 0.004, -0.02], rot: [0.05, 0, s * 0.06] });
      b.add(rail, { occ: 0.34, edge: 1.25, id: 0.3 + s * 0.1 });
    }
    greeble(b, 733, 6, { x: [-0.03, 0.03], y: [0.03, 0.032], z: [0.01, 0.038] }, [0.0028, 0.0042], 'vent');
    greeble(b, 991, 5, { x: [-0.032, 0.032], y: [-0.021, -0.019], z: [-0.06, 0.03] }, [0.0022, 0.0032], 'screw');
    root.add(mesh(pool.track(b.build('scanner.body')), shell, 'body'));
  }
  {
    const b = new PartBuilder(mulberry32(22));
    // Antenna and hinge hardware.
    const ant = prim.cyl(0.0015, 0.0028, 0.085, 8, 2);
    transform(ant, { pos: [0.026, 0.05, 0.03], rot: [-0.35, 0, -0.22] });
    b.add(ant, { occ: 0.1, edge: 1.4, id: 0.9 });
    const tip = prim.sphere(0.004, 8, 6);
    transform(tip, { pos: [0.0355, 0.09, 0.045] });
    b.add(tip, { occ: 0.05, edge: 1.6, id: 0.95 });
    const hinge = prim.cyl(0.0055, 0.0055, 0.062, 10, 1);
    transform(hinge, { rot: [0, 0, Math.PI / 2], pos: [0, 0.03, 0.03] });
    b.add(hinge, { occ: 0.45, edge: 1.1, id: 0.5 });
    root.add(mesh(pool.track(b.build('scanner.hw')), metal, 'hardware'));
  }
  root.add(buildPistolHandle(pool, handle, rubber, 41));
  const trigger = buildTrigger(pool, new THREE.Vector3(0, -0.022, -0.006), rubber, 42);
  root.add(trigger);
  root.add(guard(pool, new THREE.Vector3(0, -0.03, -0.004), metal, 43));

  // Fold-out screen on a hinge.
  const screenPivot = new THREE.Object3D();
  screenPivot.position.set(0, 0.03, 0.03);
  root.add(screenPivot);
  {
    const b = new PartBuilder(mulberry32(23));
    const frame = prim.box(0.066, 0.004, 0.052, 2);
    roundBox(frame, [0.033, 0.002, 0.026], 3, 0.5);
    transform(frame, { pos: [0, 0, -0.028] });
    b.add(frame, { occ: 0.2, edge: 1.2, id: 0.33 });
    screenPivot.add(mesh(pool.track(b.build('scanner.frame')), shell, 'frame'));
  }
  const screenGlow = (() => {
    const b = new PartBuilder(mulberry32(24));
    const g = prim.box(0.056, 0.0022, 0.042, 1);
    transform(g, { pos: [0, 0.0035, -0.028] });
    b.add(g, { occ: 0.02, edge: 0.3, id: 0.99 });
    const m = mesh(pool.track(b.build('scanner.screen')), screenMat, 'screen');
    screenPivot.add(m);
    return m;
  })();

  // Emitter disc inside the snout.
  const lens = (() => {
    const b = new PartBuilder(mulberry32(25));
    const g = prim.cyl(0.017, 0.017, 0.003, 18, 1);
    transform(g, { rot: [Math.PI / 2, 0, 0], pos: [0, 0.004, -0.1195] });
    b.add(g, { occ: 0.02, edge: 0.5, id: 0.88 });
    const m = mesh(pool.track(b.build('scanner.lens')), lensMat, 'lens');
    root.add(m);
    return m;
  })();

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.004, -0.125);
  root.add(muzzle);

  return {
    id: 'scanner',
    root,
    twoHanded: false,
    right: pistolGrip(handle, 1),
    left: null,
    holdPos: new THREE.Vector3(0.15, -0.175, -0.33),
    holdRot: new THREE.Euler(0.06, -0.2, 0.05),
    gripAmount: 0.82,
    useDuration: 1.4,
    continuous: true,
    recoil: [0.006, 0.004, 0.02, 0.01],
    muzzle,
    update(a) {
      // The screen folds out as the tool is raised and tips further while scanning.
      const open = -1.15 + a.equip * 0.95 + a.use * 0.28;
      screenPivot.rotation.x = open;
      const scan = a.use > 0 ? 1 : 0;
      const pulse = 0.5 + 0.5 * Math.sin(a.time * 14 - a.use * 9);
      (screenGlow.material as VmMaterial).emissiveIntensity = 1.4 + scan * pulse * 2.6;
      (lens.material as VmMaterial).emissiveIntensity = 0.25 + scan * (0.8 + pulse * 2.4);
      lens.scale.setScalar(1 + scan * pulse * 0.06);
      trigger.rotation.x = a.useActive ? 0.5 : 0;
    },
  };
}

/* ------------------------------------------------------------------ *
 * 2. Survival knife
 * ------------------------------------------------------------------ */

function buildKnife(pool: VmAssetPool): ToolInstance {
  const root = new THREE.Group();
  root.name = 'tool.knife';
  const steel = pool.mat('metal', { color: 0xb7c0c6, rough: [0.1, 0.4] });
  const rubber = pool.mat('rubber');
  const handle = new THREE.Vector3(0, 0, 0.055);

  {
    const b = new PartBuilder(mulberry32(31));
    // Blade: drop point, ground bevel, hollow along the flat.
    const blade = prim.box(0.03, 0.155, 0.0062, 4);
    taper(blade, (t) => [1 - Math.pow(t, 2.1) * 0.86, 1 - t * 0.55]);
    transform(blade, { rot: [-Math.PI / 2, 0, 0], pos: [0, 0.002, -0.086] });
    sagZ(blade, 0.06);
    erode(blade, 0.00035, 120, 6);
    b.add(blade, { occ: 0.05, edge: 1.35, id: 0.15 });
    // Raised spine.
    const spine = prim.box(0.007, 0.14, 0.009, 2);
    taper(spine, (t) => [1 - t * 0.6, 1 - t * 0.7]);
    transform(spine, { rot: [-Math.PI / 2, 0, 0], pos: [0, 0.006, -0.082] });
    b.add(spine, { occ: 0.14, edge: 1.5, id: 0.28 });
    // Serrations on the back third of the spine.
    for (let i = 0; i < 7; i++) {
      const s = prim.cone(0.0042, 0.008, 7);
      transform(s, { rot: [Math.PI / 2, 0, 0], pos: [0, 0.0105, -0.03 - i * 0.0105] });
      b.add(s, { occ: 0.1, edge: 1.6, id: 0.4 + i * 0.07 });
    }
    // Guard and the ricasso.
    const g = prim.box(0.044, 0.014, 0.019, 2);
    roundBox(g, [0.022, 0.007, 0.0095], 3, 0.7);
    transform(g, { pos: [0, 0, -0.004] });
    b.add(g, { occ: 0.3, edge: 1.2, id: 0.6 });
    const pommel = prim.sphere(0.0135, 12, 9);
    transform(pommel, { pos: [0, 0, 0.113], scale: [1, 0.9, 1.25] });
    b.add(pommel, { occ: 0.24, edge: 1.3, id: 0.8 });
    const lanyard = prim.torus(0.006, 0.0018, 6, 12);
    transform(lanyard, { pos: [0, 0, 0.126], rot: [0, Math.PI / 2, 0] });
    b.add(lanyard, { occ: 0.36, edge: 1.4, id: 0.9 });
    root.add(mesh(pool.track(b.build('knife.steel')), steel, 'steel'));
  }
  {
    const b = new PartBuilder(mulberry32(32));
    // Wrapped rubber handle with four scallops.
    const core = prim.capsule(0.0175, 0.082, 6, 16);
    taper(core, (t) => [1.02 - 0.1 * Math.sin(t * Math.PI * 2), 1.14 - 0.12 * t]);
    transform(core, { rot: [Math.PI / 2, 0, 0], pos: [0, 0, 0.058] });
    erode(core, 0.0008, 65, 9);
    b.add(core, { occ: 0.28, edge: 0.9, id: 0.2 });
    for (let i = 0; i < 4; i++) {
      const ring = prim.torus(0.0178 - i * 0.0004, 0.0036, 7, 16);
      transform(ring, { pos: [0, -0.0015, 0.026 + i * 0.023] });
      b.add(ring, { occ: 0.42, edge: 1.3, id: 0.3 + i * 0.15 });
    }
    greeble(b, 512, 10, { x: [-0.014, 0.014], y: [0.012, 0.014], z: [0.03, 0.1] }, [0.0018, 0.0028], 'rivet');
    root.add(mesh(pool.track(b.build('knife.grip')), rubber, 'grip'));
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.004, -0.17);
  root.add(muzzle);

  return {
    id: 'knife',
    root,
    twoHanded: false,
    right: hammerGrip(handle, 1),
    left: null,
    // Held across the body: the yaw is what makes the pose read as a knife
    // rather than a pointing stick.
    holdPos: new THREE.Vector3(0.19, -0.2, -0.3),
    holdRot: new THREE.Euler(0.12, -1.02, -0.24),
    gripAmount: 0.95,
    useDuration: 0.42,
    continuous: false,
    recoil: [0.01, 0.008, 0.05, 0.12],
    muzzle,
    update() {
      /* the slash is driven by the whole-rig animation */
    },
  };
}

/* ------------------------------------------------------------------ *
 * 3. Flashlight (pistol-grip dive light)
 * ------------------------------------------------------------------ */

export interface FlashlightTool extends ToolInstance {
  /** Where the spot light and volumetric cone attach. */
  readonly lampMount: THREE.Object3D;
}

function buildFlashlight(pool: VmAssetPool): FlashlightTool {
  const root = new THREE.Group();
  root.name = 'tool.flashlight';
  const metal = pool.mat('metal', { color: 0x8d949a });
  const rubber = pool.mat('rubber');
  const lensMat = pool.mat('glass', { emissive: 0xfff0d0, emissiveIntensity: 0.4 });
  const ledMat = pool.mat('emissive', { emissive: 0xfff4dc, emissiveIntensity: 3 });
  const handle = new THREE.Vector3(0, -0.062, 0.03);

  {
    const b = new PartBuilder(mulberry32(51));
    // Reflector bell, lathed from a profile so it is not a plain cone.
    const bell = prim.lathe(
      [
        [0.012, 0],
        [0.02, 0.006],
        [0.03, 0.015],
        [0.042, 0.028],
        [0.05, 0.042],
        [0.052, 0.05],
        [0.049, 0.052],
      ],
      22,
    );
    transform(bell, { rot: [Math.PI / 2, 0, 0], pos: [0, 0.006, -0.052] });
    erode(bell, 0.0007, 48, 12);
    b.add(bell, { occ: 0.3, edge: 1.15, id: 0.25 });
    // Barrel with knurling.
    const barrel = prim.cyl(0.026, 0.03, 0.085, 18, 3);
    taper(barrel, (t) => 1 + 0.06 * Math.sin(t * Math.PI * 3));
    transform(barrel, { rot: [Math.PI / 2, 0, 0], pos: [0, 0.006, 0.008] });
    erode(barrel, 0.0006, 70, 15);
    b.add(barrel, { occ: 0.2, edge: 1, id: 0.4 });
    for (let i = 0; i < 6; i++) {
      const ring = prim.torus(0.0292, 0.0022, 6, 20);
      transform(ring, { pos: [0, 0.006, -0.014 + i * 0.0095] });
      b.add(ring, { occ: 0.34, edge: 1.35, id: 0.5 + i * 0.06 });
    }
    // Bezel guard ring in front of the lens.
    const bezel = prim.torus(0.051, 0.005, 8, 22);
    transform(bezel, { pos: [0, 0.006, -0.1035] });
    b.add(bezel, { occ: 0.16, edge: 1.5, id: 0.85 });
    // Battery pod slung under the barrel, and its cable.
    const pod = prim.capsule(0.017, 0.05, 5, 14);
    transform(pod, { rot: [Math.PI / 2, 0, 0], pos: [0, -0.026, 0.026] });
    b.add(pod, { occ: 0.4, edge: 0.9, id: 0.62 });
    const cable = prim.tube(
      [
        [0.014, -0.026, 0.004],
        [0.026, -0.016, -0.014],
        [0.03, 0.0, -0.036],
        [0.024, 0.006, -0.05],
      ],
      0.0038,
      16,
      6,
    );
    b.add(cable, { occ: 0.44, edge: 1.05, id: 0.72 });
    greeble(b, 618, 6, { x: [-0.02, 0.02], y: [0.028, 0.032], z: [-0.02, 0.04] }, [0.0022, 0.0032], 'screw');
    root.add(mesh(pool.track(b.build('flash.body')), metal, 'body'));
  }
  root.add(buildPistolHandle(pool, handle, rubber, 52));
  const thumbSwitch = buildTrigger(pool, new THREE.Vector3(0, -0.026, 0.006), rubber, 53);
  root.add(thumbSwitch);

  const lens = (() => {
    const b = new PartBuilder(mulberry32(54));
    const g = prim.sphere(0.049, 20, 8);
    transform(g, { pos: [0, 0.006, -0.1], scale: [1, 1, 0.18] });
    b.add(g, { occ: 0.02, edge: 0.4, id: 0.93 });
    const m = mesh(pool.track(b.build('flash.lens')), lensMat, 'lens');
    root.add(m);
    return m;
  })();
  const led = (() => {
    const b = new PartBuilder(mulberry32(55));
    const g = prim.sphere(0.014, 14, 8);
    transform(g, { pos: [0, 0.006, -0.062], scale: [1, 1, 0.5] });
    b.add(g, { occ: 0, edge: 0.2, id: 0.97 });
    const m = mesh(pool.track(b.build('flash.led')), ledMat, 'led');
    root.add(m);
    return m;
  })();

  const lampMount = new THREE.Object3D();
  lampMount.position.set(0, 0.006, -0.1);
  root.add(lampMount);

  return {
    id: 'flashlight',
    root,
    twoHanded: false,
    right: pistolGrip(handle, 1),
    left: null,
    holdPos: new THREE.Vector3(0.16, -0.18, -0.3),
    holdRot: new THREE.Euler(0.02, -0.12, 0.04),
    gripAmount: 0.86,
    useDuration: 0.2,
    continuous: false,
    recoil: [0.003, 0.002, 0.012, 0.006],
    muzzle: lampMount,
    lampMount,
    update(a) {
      const on = a.lightOn ? 1 : 0;
      // Filament flicker: two incommensurate sines so it never looks periodic.
      const flick = 1 + (Math.sin(a.time * 31.3) * 0.03 + Math.sin(a.time * 7.7) * 0.02) * on;
      (led.material as VmMaterial).emissiveIntensity = on * 4.2 * flick;
      (lens.material as VmMaterial).emissiveIntensity = 0.15 + on * 1.5 * flick;
      thumbSwitch.rotation.x = a.useActive ? 0.45 : 0;
    },
  };
}

/* ------------------------------------------------------------------ *
 * 4. Habitat builder
 * ------------------------------------------------------------------ */

function buildBuilder(pool: VmAssetPool): ToolInstance {
  const root = new THREE.Group();
  root.name = 'tool.builder';
  const shell = pool.mat('painted', { color: 0xdd7a22 });
  const metal = pool.mat('metal');
  const rubber = pool.mat('rubber');
  const holoMat = pool.mat('emissive', { emissive: 0x66ddff, emissiveIntensity: 2 });
  const tankMat = pool.mat('glass', { emissive: 0x8fffc8, emissiveIntensity: 0.7 });
  const handle = new THREE.Vector3(0, -0.06, 0.045);

  {
    const b = new PartBuilder(mulberry32(61));
    const body = prim.box(0.082, 0.07, 0.115, 3);
    roundBox(body, [0.041, 0.035, 0.0575], 3.4, 0.75);
    transform(body, { pos: [0, 0.004, 0.0] });
    erode(body, 0.001, 40, 7);
    b.add(body, { occ: 0.14, edge: 1, id: 0.18 });
    // Projector throat.
    const throat = prim.lathe(
      [
        [0.014, 0],
        [0.026, 0.01],
        [0.036, 0.024],
        [0.043, 0.04],
        [0.041, 0.044],
      ],
      20,
    );
    transform(throat, { rot: [Math.PI / 2, 0, 0], pos: [0, 0.006, -0.056] });
    b.add(throat, { occ: 0.32, edge: 1.2, id: 0.44 });
    // Shoulder shroud and side plates.
    for (const s of [-1, 1]) {
      const plate = prim.box(0.009, 0.05, 0.07, 2);
      roundBox(plate, [0.0045, 0.025, 0.035], 3, 0.6);
      transform(plate, { pos: [s * 0.043, 0.006, 0.006], rot: [0, 0, s * 0.08] });
      b.add(plate, { occ: 0.36, edge: 1.25, id: 0.3 + s * 0.12 });
    }
    greeble(b, 812, 7, { x: [-0.03, 0.03], y: [0.04, 0.042], z: [0.02, 0.05] }, [0.003, 0.0044], 'vent');
    greeble(b, 813, 6, { x: [-0.036, 0.036], y: [-0.03, -0.028], z: [-0.04, 0.05] }, [0.0022, 0.0032], 'screw');
    root.add(mesh(pool.track(b.build('builder.body')), shell, 'body'));
  }
  {
    const b = new PartBuilder(mulberry32(62));
    // Material canister on top, plus its regulator.
    const can = prim.cyl(0.019, 0.019, 0.072, 16, 2);
    transform(can, { rot: [0.06, 0, Math.PI / 2], pos: [0, 0.046, 0.014] });
    b.add(can, { occ: 0.24, edge: 1.05, id: 0.5 });
    const cap = prim.cyl(0.021, 0.017, 0.012, 14, 1);
    transform(cap, { rot: [0, 0, Math.PI / 2], pos: [-0.04, 0.046, 0.014] });
    b.add(cap, { occ: 0.3, edge: 1.3, id: 0.66 });
    const hose = prim.tube(
      [
        [0.036, 0.044, 0.016],
        [0.044, 0.024, -0.006],
        [0.038, 0.012, -0.03],
        [0.024, 0.008, -0.048],
      ],
      0.0042,
      16,
      6,
    );
    b.add(hose, { occ: 0.46, edge: 1.05, id: 0.74 });
    const dial = prim.cyl(0.011, 0.011, 0.006, 12, 1);
    transform(dial, { rot: [0, 0, Math.PI / 2], pos: [0.043, 0.014, 0.042] });
    b.add(dial, { occ: 0.24, edge: 1.4, id: 0.82 });
    root.add(mesh(pool.track(b.build('builder.hw')), metal, 'hardware'));
  }
  const tank = (() => {
    const b = new PartBuilder(mulberry32(63));
    const g = prim.cyl(0.0155, 0.0155, 0.05, 14, 1);
    transform(g, { rot: [0.06, 0, Math.PI / 2], pos: [0.004, 0.046, 0.014] });
    b.add(g, { occ: 0.1, edge: 0.5, id: 0.9 });
    const m = mesh(pool.track(b.build('builder.tank')), tankMat, 'tank');
    root.add(m);
    return m;
  })();
  root.add(buildPistolHandle(pool, handle, rubber, 64));
  const trigger = buildTrigger(pool, new THREE.Vector3(0, -0.024, 0.014), rubber, 65);
  root.add(trigger);
  root.add(guard(pool, new THREE.Vector3(0, -0.032, 0.016), metal, 66));

  // Hologram projector: two counter-rotating rings and a floating core.
  const holoPivot = new THREE.Object3D();
  holoPivot.position.set(0, 0.006, -0.075);
  root.add(holoPivot);
  const ringA = new THREE.Object3D();
  const ringB = new THREE.Object3D();
  holoPivot.add(ringA, ringB);
  {
    const b = new PartBuilder(mulberry32(67));
    const g = prim.torus(0.03, 0.0022, 6, 26);
    b.add(g, { occ: 0, edge: 0.3, id: 0.95 });
    ringA.add(mesh(pool.track(b.build('builder.ringA')), holoMat, 'ringA'));
  }
  {
    const b = new PartBuilder(mulberry32(68));
    const g = prim.torus(0.021, 0.0018, 6, 22);
    b.add(g, { occ: 0, edge: 0.3, id: 0.92 });
    ringB.add(mesh(pool.track(b.build('builder.ringB')), holoMat, 'ringB'));
  }
  const holoCore = (() => {
    const b = new PartBuilder(mulberry32(69));
    const g = prim.box(0.016, 0.016, 0.016, 1);
    b.add(g, { occ: 0, edge: 0.3, id: 0.99 });
    const m = mesh(pool.track(b.build('builder.core')), holoMat, 'core');
    holoPivot.add(m);
    return m;
  })();

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.006, -0.08);
  root.add(muzzle);

  return {
    id: 'builder',
    root,
    twoHanded: false,
    right: pistolGrip(handle, 1),
    left: null,
    holdPos: new THREE.Vector3(0.16, -0.19, -0.34),
    holdRot: new THREE.Euler(0.04, -0.16, 0.03),
    gripAmount: 0.84,
    useDuration: 0.9,
    continuous: true,
    recoil: [0.008, 0.005, 0.026, 0.012],
    muzzle,
    update(a, dt) {
      const active = a.useActive ? 1 : 0;
      const spin = 0.6 + active * 5.5;
      ringA.rotation.y += dt * spin;
      ringA.rotation.x = 0.4 + Math.sin(a.time * 0.7) * 0.2;
      ringB.rotation.y -= dt * spin * 1.6;
      ringB.rotation.z = 0.9 + Math.cos(a.time * 0.9) * 0.25;
      holoCore.rotation.y += dt * (0.8 + active * 3);
      holoCore.rotation.x += dt * (0.5 + active * 2);
      const s = (0.6 + active * 0.55) * (1 + Math.sin(a.time * 6) * 0.05);
      holoPivot.scale.setScalar(THREE.MathUtils.clamp(a.equip, 0.001, 1) * s);
      (holoMat as VmMaterial).emissiveIntensity = 1.1 + active * 2.4 + Math.sin(a.time * 9) * 0.25;
      (tank.material as VmMaterial).emissiveIntensity = 0.45 + active * 0.9;
      trigger.rotation.x = a.useActive ? 0.5 : 0;
    },
  };
}

/* ------------------------------------------------------------------ *
 * 5. Propulsion cannon (two-handed)
 * ------------------------------------------------------------------ */

function buildPropulsion(pool: VmAssetPool): ToolInstance {
  const root = new THREE.Group();
  root.name = 'tool.propulsion';
  const shell = pool.mat('painted', { color: 0xc4c9cc });
  const metal = pool.mat('metal');
  const rubber = pool.mat('rubber');
  const coilMat = pool.mat('emissive', { emissive: 0x63b4ff, emissiveIntensity: 1.6 });
  const coreMat = pool.mat('emissive', { emissive: 0x9fd8ff, emissiveIntensity: 2.6 });
  const handle = new THREE.Vector3(0, -0.062, 0.075);
  const fore = new THREE.Vector3(-0.005, -0.055, -0.115);

  {
    const b = new PartBuilder(mulberry32(71));
    // Receiver.
    const body = prim.box(0.088, 0.086, 0.15, 3);
    roundBox(body, [0.044, 0.043, 0.075], 3.2, 0.7);
    transform(body, { pos: [0, 0.006, 0.035] });
    erode(body, 0.0012, 34, 8);
    b.add(body, { occ: 0.14, edge: 1, id: 0.16 });
    // Barrel shroud.
    const barrel = prim.cyl(0.048, 0.056, 0.19, 20, 3);
    taper(barrel, (t) => 1 + 0.05 * Math.sin(t * Math.PI * 2));
    transform(barrel, { rot: [Math.PI / 2, 0, 0], pos: [0, 0.01, -0.12] });
    erode(barrel, 0.0009, 46, 17);
    b.add(barrel, { occ: 0.2, edge: 1.05, id: 0.36 });
    // Muzzle crown with four prongs.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const prong = prim.box(0.012, 0.03, 0.014, 1);
      roundBox(prong, [0.006, 0.015, 0.007], 3, 0.6);
      transform(prong, {
        pos: [Math.cos(a) * 0.044, 0.01 + Math.sin(a) * 0.044, -0.216],
        rot: [0, 0, a],
      });
      b.add(prong, { occ: 0.22, edge: 1.5, id: 0.4 + i * 0.12 });
    }
    // Shoulder brace at the back.
    const brace = prim.box(0.05, 0.07, 0.03, 2);
    roundBox(brace, [0.025, 0.035, 0.015], 3, 0.7);
    transform(brace, { pos: [0, 0.012, 0.122], rot: [0.35, 0, 0] });
    b.add(brace, { occ: 0.4, edge: 1.15, id: 0.6 });
    greeble(b, 921, 8, { x: [-0.036, 0.036], y: [0.048, 0.05], z: [-0.02, 0.09] }, [0.003, 0.0046], 'vent');
    greeble(b, 922, 8, { x: [-0.04, 0.04], y: [-0.034, -0.032], z: [-0.03, 0.1] }, [0.0024, 0.0034], 'screw');
    root.add(mesh(pool.track(b.build('prop.body')), shell, 'body'));
  }
  {
    const b = new PartBuilder(mulberry32(72));
    // Coil formers and the core cage.
    for (let i = 0; i < 3; i++) {
      const former = prim.torus(0.055 - i * 0.001, 0.008, 8, 24);
      transform(former, { pos: [0, 0.01, -0.06 - i * 0.055] });
      b.add(former, { occ: 0.26, edge: 1.2, id: 0.2 + i * 0.2 });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const bar = prim.tube(
        [
          [Math.cos(a) * 0.02, 0.04 + Math.sin(a) * 0.02, 0.06],
          [Math.cos(a) * 0.031, 0.04 + Math.sin(a) * 0.031, 0.03],
          [Math.cos(a) * 0.02, 0.04 + Math.sin(a) * 0.02, 0.0],
        ],
        0.0035,
        12,
        6,
      );
      b.add(bar, { occ: 0.32, edge: 1.25, id: 0.45 + i * 0.1 });
    }
    const cable = prim.tube(
      [
        [0.03, 0.03, 0.04],
        [0.046, 0.0, 0.06],
        [0.04, -0.03, 0.075],
        [0.016, -0.05, 0.08],
      ],
      0.005,
      16,
      6,
    );
    b.add(cable, { occ: 0.48, edge: 1, id: 0.78 });
    root.add(mesh(pool.track(b.build('prop.hw')), metal, 'hardware'));
  }
  root.add(buildPistolHandle(pool, handle, rubber, 73));
  const trigger = buildTrigger(pool, new THREE.Vector3(0, -0.026, 0.05), rubber, 74);
  root.add(trigger);
  root.add(guard(pool, new THREE.Vector3(0, -0.034, 0.048), metal, 75));
  {
    // Fore-grip for the support hand.
    const b = new PartBuilder(mulberry32(76));
    const g = prim.cyl(0.019, 0.022, 0.08, 14, 2);
    taper(g, (t) => 1 + 0.08 * Math.sin(t * Math.PI));
    transform(g, { pos: [fore.x, fore.y, fore.z], rot: [-0.12, 0, 0] });
    b.add(g, { occ: 0.3, edge: 0.95, id: 0.28 });
    for (let i = 0; i < 3; i++) {
      const ring = prim.torus(0.0208, 0.0032, 6, 14);
      transform(ring, { pos: [fore.x, fore.y + 0.022 - i * 0.022, fore.z], rot: [Math.PI / 2, 0, 0] });
      b.add(ring, { occ: 0.42, edge: 1.3, id: 0.5 + i * 0.14 });
    }
    root.add(mesh(pool.track(b.build('prop.fore')), rubber, 'foregrip'));
  }

  const coils: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const b = new PartBuilder(mulberry32(770 + i));
    const g = prim.torus(0.05, 0.0055, 7, 24);
    transform(g, { pos: [0, 0.01, -0.06 - i * 0.055] });
    b.add(g, { occ: 0, edge: 0.3, id: 0.9 + i * 0.03 });
    const m = mesh(pool.track(b.build(`prop.coil${i}`)), coilMat, `coil${i}`);
    root.add(m);
    coils.push(m);
  }
  const core = (() => {
    const b = new PartBuilder(mulberry32(78));
    const g = prim.sphere(0.019, 16, 12);
    transform(g, { pos: [0, 0.04, 0.03] });
    b.add(g, { occ: 0, edge: 0.3, id: 0.99 });
    const m = mesh(pool.track(b.build('prop.core')), coreMat, 'core');
    root.add(m);
    return m;
  })();

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, -0.225);
  root.add(muzzle);

  return {
    id: 'propulsion',
    root,
    twoHanded: true,
    right: pistolGrip(handle, 1),
    left: pistolGrip(fore, -1),
    holdPos: new THREE.Vector3(0.1, -0.185, -0.29),
    holdRot: new THREE.Euler(0.03, -0.08, 0.02),
    gripAmount: 0.9,
    useDuration: 0.55,
    continuous: false,
    recoil: [0.045, 0.014, 0.09, 0.03],
    muzzle,
    update(a) {
      // Coils fire front-to-back as the shot leaves; charge makes them breathe.
      for (let i = 0; i < coils.length; i++) {
        const phase = a.use > 0 ? THREE.MathUtils.clamp(1 - Math.abs(a.use * 3 - (2 - i)), 0, 1) : 0;
        const idle = 0.35 + 0.25 * Math.sin(a.time * 3 + i * 1.7);
        (coils[i].material as VmMaterial).emissiveIntensity = idle + a.charge * 1.4 + phase * 6;
        coils[i].scale.setScalar(1 + phase * 0.05);
      }
      const s = 1 + a.charge * 0.25 + Math.sin(a.time * 7) * 0.03;
      core.scale.setScalar(s);
      (core.material as VmMaterial).emissiveIntensity = 1.6 + a.charge * 4 + a.use * 3;
      trigger.rotation.x = a.useActive ? 0.55 : 0;
    },
  };
}

/* ------------------------------------------------------------------ *
 * 6. Laser cutter
 * ------------------------------------------------------------------ */

function buildLaserCutter(pool: VmAssetPool): ToolInstance {
  const root = new THREE.Group();
  root.name = 'tool.lasercutter';
  const shell = pool.mat('plastic', { color: 0xd8dade });
  const metal = pool.mat('metal');
  const rubber = pool.mat('rubber');
  const ledMat = pool.mat('emissive', { emissive: 0x9dff6a, emissiveIntensity: 1.8 });
  const beamMat = pool.mat('emissive', { emissive: 0xff5a2a, emissiveIntensity: 6 });
  const handle = new THREE.Vector3(0, -0.056, 0.028);

  {
    const b = new PartBuilder(mulberry32(81));
    const body = prim.box(0.062, 0.062, 0.1, 3);
    roundBox(body, [0.031, 0.031, 0.05], 3.6, 0.8);
    transform(body, { pos: [0, 0.006, 0.006] });
    erode(body, 0.0009, 44, 10);
    b.add(body, { occ: 0.14, edge: 1, id: 0.2 });
    // Battery pack under the barrel.
    const batt = prim.box(0.04, 0.026, 0.058, 2);
    roundBox(batt, [0.02, 0.013, 0.029], 3, 0.7);
    transform(batt, { pos: [0, -0.026, 0.03] });
    b.add(batt, { occ: 0.42, edge: 1.1, id: 0.55 });
    greeble(b, 861, 5, { x: [-0.024, 0.024], y: [0.034, 0.036], z: [0.0, 0.04] }, [0.0026, 0.0038], 'vent');
    greeble(b, 862, 5, { x: [-0.026, 0.026], y: [-0.014, -0.012], z: [-0.03, 0.04] }, [0.002, 0.003], 'screw');
    root.add(mesh(pool.track(b.build('cut.body')), shell, 'body'));
  }
  {
    const b = new PartBuilder(mulberry32(82));
    // Focusing head: a collar plus three converging prongs.
    const collar = prim.cyl(0.024, 0.028, 0.03, 16, 2);
    transform(collar, { rot: [Math.PI / 2, 0, 0], pos: [0, 0.008, -0.058] });
    b.add(collar, { occ: 0.24, edge: 1.2, id: 0.3 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const prong = prim.cyl(0.0022, 0.005, 0.042, 8, 2);
      transform(prong, {
        pos: [Math.cos(a) * 0.014, 0.008 + Math.sin(a) * 0.014, -0.086],
        rot: [Math.PI / 2 - 0.16, 0, -a],
      });
      b.add(prong, { occ: 0.16, edge: 1.5, id: 0.5 + i * 0.15 });
    }
    const ap = prim.torus(0.0085, 0.0028, 6, 16);
    transform(ap, { pos: [0, 0.008, -0.102] });
    b.add(ap, { occ: 0.1, edge: 1.6, id: 0.85 });
    root.add(mesh(pool.track(b.build('cut.head')), metal, 'head'));
  }
  root.add(buildPistolHandle(pool, handle, rubber, 83));
  const trigger = buildTrigger(pool, new THREE.Vector3(0, -0.022, 0.0), rubber, 84);
  root.add(trigger);

  const leds: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const b = new PartBuilder(mulberry32(850 + i));
    const g = prim.box(0.006, 0.0035, 0.008, 1);
    transform(g, { pos: [0.031, 0.004, -0.012 + i * 0.013] });
    b.add(g, { occ: 0, edge: 0.4, id: 0.9 });
    const m = mesh(pool.track(b.build(`cut.led${i}`)), ledMat, `led${i}`);
    root.add(m);
    leds.push(m);
  }

  // Beam: a thin tapered cylinder that grows out of the aperture while cutting,
  // plus a hot flare at the muzzle. Additive-ish via a strong emissive.
  const beam = (() => {
    const b = new PartBuilder(mulberry32(86));
    // Length 1 along −Z so the mesh's Z scale is the beam length.
    const g = prim.cyl(0.0042, 0.0016, 1, 8, 1, true);
    transform(g, { rot: [Math.PI / 2, 0, 0], pos: [0, 0, -0.5] });
    b.add(g, { occ: 0, edge: 0.2, id: 0.99 });
    const m = mesh(pool.track(b.build('cut.beam')), beamMat, 'beam');
    m.position.set(0, 0.008, -0.104);
    m.visible = false;
    root.add(m);
    return m;
  })();
  const flare = (() => {
    const b = new PartBuilder(mulberry32(87));
    const g = prim.sphere(0.011, 12, 8);
    b.add(g, { occ: 0, edge: 0.2, id: 0.98 });
    const m = mesh(pool.track(b.build('cut.flare')), beamMat, 'flare');
    m.position.set(0, 0.008, -0.104);
    m.visible = false;
    root.add(m);
    return m;
  })();

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.008, -0.108);
  root.add(muzzle);

  return {
    id: 'lasercutter',
    root,
    twoHanded: false,
    right: pistolGrip(handle, 1),
    left: null,
    holdPos: new THREE.Vector3(0.155, -0.175, -0.31),
    holdRot: new THREE.Euler(0.05, -0.18, 0.04),
    gripAmount: 0.85,
    useDuration: 0.3,
    continuous: true,
    recoil: [0.004, 0.003, 0.014, 0.02],
    muzzle,
    update(a) {
      const on = a.useActive ? 1 : 0;
      const jitter = 0.82 + Math.abs(Math.sin(a.time * 57.3)) * 0.18 + Math.sin(a.time * 23.1) * 0.06;
      beam.visible = on > 0;
      flare.visible = on > 0;
      if (on > 0) {
        // The beam length is short — this is a cutter, not a rifle.
        const len = 0.55 * jitter;
        const w = 1 + Math.sin(a.time * 40) * 0.15;
        beam.scale.set(w, w, len);
        (beam.material as VmMaterial).emissiveIntensity = 5 + jitter * 5;
        flare.scale.setScalar(0.8 + jitter * 0.6);
      }
      for (let i = 0; i < leds.length; i++) {
        const lit = i < 3 - Math.floor(a.time * 0.2) % 2 ? 1 : 0.15;
        (leds[i].material as VmMaterial).emissiveIntensity = 0.6 + lit * 1.6 + on * 0.8;
      }
      trigger.rotation.x = a.useActive ? 0.6 : 0;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Factory
 * ------------------------------------------------------------------ */

export function buildTool(id: ToolId, pool: VmAssetPool): ToolInstance | null {
  switch (id) {
    case 'scanner':
      return buildScanner(pool);
    case 'knife':
      return buildKnife(pool);
    case 'flashlight':
      return buildFlashlight(pool);
    case 'builder':
      return buildBuilder(pool);
    case 'propulsion':
      return buildPropulsion(pool);
    case 'lasercutter':
      return buildLaserCutter(pool);
    default:
      return null;
  }
}

export function isFlashlight(t: ToolInstance | null): t is FlashlightTool {
  return !!t && t.id === 'flashlight';
}
