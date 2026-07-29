/**
 * Procedural gloved dive-suit hands.
 *
 * Anatomy is real: 0.105 m palm, four fingers with plausible per-digit radii and
 * lengths, an opposed thumb on the medial side, knuckle pads, a sealed wrist
 * cuff and a tapered neoprene forearm. Each finger is two rigid units hinged at
 * the knuckle and the middle joint, so grip is animated in code — there are no
 * skinned meshes and no animation data anywhere in the build.
 *
 * The rig is generated once per side; the left hand is a true mirror (winding
 * and normals flipped), and both hands share the same two material instances so
 * the whole pair costs a handful of draw calls.
 */
import * as THREE from 'three';
import { mulberry32 } from '../core/Noise';
import { PartBuilder, erode, greeble, mirrorX, prim, roundBox, sagZ, taper, transform } from './VmGeometry';
import { VIEWMODEL_LAYER } from './PlayerTypes';

export interface FingerRig {
  /** Hinge at the knuckle. */
  prox: THREE.Object3D;
  /** Hinge at the middle joint, child of `prox`. */
  dist: THREE.Object3D;
  /** Curl at rest and when fully closed, radians (negative curls to the palm). */
  restProx: number;
  restDist: number;
  gripProx: number;
  gripDist: number;
  /** Splay at rest. */
  splay: number;
  /** Per-finger animation phase so digits never move in lockstep. */
  phase: number;
}

export interface HandMaterials {
  suit: THREE.Material;
  glove: THREE.Material;
  metal: THREE.Material;
  emissive: THREE.Material;
  /** High-visibility suit accent. Without it the hands read as water-coloured. */
  accent: THREE.Material;
}

export interface HandRig {
  root: THREE.Group;
  fingers: FingerRig[];
  /** Everything allocated, for disposal. */
  geometries: THREE.BufferGeometry[];
  /** Drives the whole hand from open (0) to closed fist (1). */
  setGrip(t: number, time: number): void;
  setSpread(t: number): void;
}

/** Per-finger metrics: x offset, radius, proximal len, distal len, splay. */
const FINGERS: Array<[number, number, number, number, number]> = [
  [-0.0305, 0.0126, 0.0405, 0.0375, -0.055], // index
  [-0.0102, 0.0132, 0.0435, 0.0405, -0.012], // middle
  [0.0108, 0.0119, 0.0405, 0.0365, 0.02], // ring
  [0.0308, 0.0102, 0.0345, 0.0295, 0.062], // little
];

/**
 * @param side  +1 for the right hand, -1 for the left.
 */
export function buildHand(side: 1 | -1, mats: HandMaterials): HandRig {
  const rnd = mulberry32(side === 1 ? 7717 : 4243);
  const geometries: THREE.BufferGeometry[] = [];
  const root = new THREE.Group();
  root.name = side === 1 ? 'hand.right' : 'hand.left';

  const mirror = (g: THREE.BufferGeometry) => (side === -1 ? mirrorX(g) : g);

  /* ---------------- forearm + cuff (suit) ------------------------- */
  //
  // The visible forearm is deliberately a *stub*. A full 0.24 m forearm running
  // back toward the eye puts its elbow end ~9 cm from the lens, where a 13 cm
  // cylinder subtends most of the frame and the hand reads as a boulder in the
  // corner. Real first-person arms are cut just past the point where the frustum
  // would clip them anyway, so nothing gets closer than ~0.3 m.
  const FOREARM_LEN = 0.075;
  /** Local Z of the cut end of the forearm. */
  const FOREARM_END = FOREARM_LEN / 2 + 0.055 + 0.083;
  const ARM_R = 0.055;
  /** Half-length of the capsule's cylindrical section. */
  const ARM_HALF = FOREARM_LEN / 2;
  /** Local Z of the capsule's centre. */
  const ARM_MID = 0.083;
  /** Lower/upper local Z of the cylindrical section, i.e. off the end caps. */
  const ARM_Z0 = ARM_MID - ARM_HALF;
  const ARM_Z1 = ARM_MID + ARM_HALF;
  /** Erosion amplitude, so surface dressing can clear the displaced skin. */
  const ARM_SKIN = 0.0022;

  /**
   * X/Y half-extents of the forearm's surface at a local Z.
   *
   * Anything that must sit *on* the arm — ribs, accent bands — needs this rather
   * than a hand-guessed radius. Two traps: `taper` normalises over the capsule's
   * whole bounding box, so it squeezes the hemispherical end caps too, and the
   * capsule carries no vertex rings between the two ends of its cylindrical
   * section, so the profile cannot be recovered by sampling the built geometry
   * either. Only valid between ARM_Z0 and ARM_Z1, where the underlying radius is
   * a constant ARM_R and the taper is the whole story.
   */
  const armXY = (z: number): [number, number] => {
    const t = (z - ARM_MID + ARM_HALF + ARM_R) / (FOREARM_LEN + 2 * ARM_R);
    return [ARM_R * (0.94 + t * 0.24), ARM_R * (1.02 + t * 0.2)];
  };
  {
    const b = new PartBuilder(rnd);
    // Neoprene forearm: tapers out toward the elbow, slightly oval, eroded so
    // the silhouette is not a lathe.
    const arm = prim.capsule(ARM_R, FOREARM_LEN, 6, 16);
    taper(arm, (t) => [0.94 + t * 0.24, 1.02 + t * 0.2]);
    transform(arm, { rot: [Math.PI / 2, 0, 0], pos: [0, 0, ARM_MID] });
    erode(arm, 0.0016, 26, 3);
    b.add(arm, { occ: 0.2, edge: 0.7, id: 0.31 });

    // Sealed wrist cuff: a thick rubber collar with a raised lip.
    const collar = prim.cyl(0.062, 0.058, 0.035, 20, 2);
    transform(collar, { rot: [Math.PI / 2, 0, 0], pos: [0, 0, 0.032] });
    erode(collar, 0.0008, 40, 11);
    b.add(collar, { occ: 0.34, edge: 1.15, id: 0.62 });

    const lip = prim.torus(0.062, 0.0055, 8, 22);
    transform(lip, { pos: [0, 0, 0.0155] });
    b.add(lip, { occ: 0.26, edge: 1.4, id: 0.7 });

    // Ribbed reinforcement panel along the top of the forearm. Seated *on* the
    // real tapered surface, half-sunk, so each rib stands about its own half
    // height proud and actually catches a highlight. The old placement used a
    // flat 0.044 m and sat entirely inside the neoprene.
    for (let i = 0; i < 4; i++) {
      const z = ARM_Z0 + 0.006 + i * 0.02;
      const surfaceY = armXY(z)[1] + ARM_SKIN;
      const rib = prim.box(0.05 - i * 0.003, 0.009, 0.013, 1);
      roundBox(rib, [0.025, 0.0045, 0.0065], 3, 0.6);
      transform(rib, {
        pos: [0.004 * side, surfaceY, z],
        rot: [0.05 * i, 0, 0.04 * side],
      });
      b.add(rib, { occ: 0.3, edge: 1.3, id: 0.2 + i * 0.13 });
    }
    // Seam piping down the inner forearm.
    const seam = prim.tube(
      [
        [-0.03 * side, -0.032, 0.045],
        [-0.04 * side, -0.026, 0.09],
        [-0.045 * side, -0.016, 0.135],
        [-0.044 * side, -0.008, FOREARM_END],
      ],
      0.0035,
      18,
      6,
    );
    b.add(seam, { occ: 0.42, edge: 1.2, id: 0.83 });

    const geo = b.build('hand.forearm');
    geometries.push(geo);
    const mesh = new THREE.Mesh(mirror(geo), mats.suit);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.layers.set(VIEWMODEL_LAYER);
    root.add(mesh);
  }

  /* ---------------- hi-vis accent bands (painted) ----------------- */
  //
  // Underwater extinction pulls everything toward one hue, so a suit made only
  // of dark neoprene dissolves into the water at 15 m. Two warm accent bands
  // round the forearm survive the blue shift long enough to keep the hands
  // reading as foreground, and they give the eye something to measure the frame
  // against. Cut as shallow rings concentric with the tapered arm.
  {
    const b = new PartBuilder(rnd);
    const band = (z: number, width: number, id: number): void => {
      // Truncated cone, so the band follows the taper along its own length
      // instead of stepping off it at one end.
      const [rxA, ryA] = armXY(z + width / 2);
      const [rxB, ryB] = armXY(z - width / 2);
      // The cylinder's cross-section is its X/Z; the rotation then lays its Y
      // axis down the arm, so the Z scale becomes the vertical radius.
      const ring = prim.cyl(rxA + ARM_SKIN, rxB + ARM_SKIN, width, 22, 1);
      const ovality = (ryA + ryB + ARM_SKIN * 2) / (rxA + rxB + ARM_SKIN * 2);
      transform(ring, { rot: [Math.PI / 2, 0, 0], scale: [1, 1, ovality] });
      transform(ring, { pos: [0, 0, z] });
      b.add(ring, { occ: 0.18, edge: 1.35, id });
    };
    // Both bands stay inside the cylindrical section: out on the end caps the arm
    // is already narrowing and a constant-radius ring reads as a flange.
    band(ARM_Z0 + 0.014, 0.018, 0.15);
    band(ARM_Z1 - 0.014, 0.011, 0.55);
    const geo = b.build('hand.accent');
    geometries.push(geo);
    const m = new THREE.Mesh(mirror(geo), mats.accent);
    m.frustumCulled = false;
    m.layers.set(VIEWMODEL_LAYER);
    root.add(m);
  }

  /* ---------------- wrist unit (metal + LED) ---------------------- */
  {
    const b = new PartBuilder(rnd);
    // A small dive computer strapped to the outside of the forearm.
    const body = prim.box(0.05, 0.016, 0.062, 2);
    roundBox(body, [0.025, 0.008, 0.031], 3.2, 0.75);
    transform(body, { pos: [0.028 * side, 0.038, 0.095], rot: [0.1, -0.25 * side, 0.5 * side] });
    b.add(body, { occ: 0.24, edge: 1.1, id: 0.44 });
    greeble(
      b,
      991 + (side === 1 ? 0 : 7),
      5,
      { x: [0.014 * side, 0.042 * side], y: [0.042, 0.05], z: [0.072, 0.118] },
      [0.0022, 0.0034],
      'screw',
    );
    const geo = b.build('hand.wrist');
    geometries.push(geo);
    const mesh = new THREE.Mesh(mirror(geo), mats.metal);
    mesh.frustumCulled = false;
    mesh.layers.set(VIEWMODEL_LAYER);
    root.add(mesh);
  }
  {
    const b = new PartBuilder(rnd);
    const screen = prim.box(0.034, 0.003, 0.044, 1);
    transform(screen, { pos: [0.0335 * side, 0.0455, 0.0952], rot: [0.1, -0.25 * side, 0.5 * side] });
    b.add(screen, { occ: 0.05, edge: 0.4, id: 0.9 });
    const geo = b.build('hand.wristScreen');
    geometries.push(geo);
    const mesh = new THREE.Mesh(mirror(geo), mats.emissive);
    mesh.frustumCulled = false;
    mesh.layers.set(VIEWMODEL_LAYER);
    root.add(mesh);
  }

  /* ---------------- palm + knuckles (glove) ---------------------- */
  {
    const b = new PartBuilder(rnd);
    const palm = prim.box(0.094, 0.038, 0.108, 3);
    roundBox(palm, [0.047, 0.019, 0.054], 3.4, 0.85);
    taper(palm, (t) => 0.9 + t * 0.16);
    transform(palm, { pos: [0, 0, -0.05], rot: [0.06, 0, 0] });
    erode(palm, 0.0012, 40, 5);
    b.add(palm, { occ: 0.16, edge: 0.9, id: 0.12 });

    // Thenar (thumb) muscle mass — the bulge that makes a hand read as a hand.
    const thenar = prim.sphere(0.026, 12, 9);
    transform(thenar, { pos: [-0.03 * side, -0.004, -0.038], scale: [0.85, 0.62, 1.25] });
    b.add(thenar, { occ: 0.24, edge: 0.85, id: 0.36 });

    // Knuckle pads: reinforced patches over the metacarpal heads.
    for (let i = 0; i < FINGERS.length; i++) {
      const f = FINGERS[i];
      const pad = prim.sphere(f[1] * 1.35, 10, 8);
      transform(pad, {
        pos: [f[0] * side, 0.014, -0.098],
        scale: [1.05, 0.52, 0.95],
      });
      b.add(pad, { occ: 0.1, edge: 1.45, id: 0.5 + i * 0.11 });
    }
    // Grip pebbling across the palm face.
    greeble(
      b,
      3311,
      14,
      { x: [-0.03, 0.03], y: [-0.019, -0.017], z: [-0.095, -0.015] },
      [0.0026, 0.0042],
      'rivet',
    );
    // Cuff/glove junction seam.
    const seam = prim.torus(0.05, 0.005, 8, 20);
    transform(seam, { pos: [0, 0, 0.004], scale: [1.06, 0.74, 1] });
    b.add(seam, { occ: 0.45, edge: 1.2, id: 0.66 });

    const geo = b.build('hand.palm');
    geometries.push(geo);
    const mesh = new THREE.Mesh(mirror(geo), mats.glove);
    mesh.frustumCulled = false;
    mesh.layers.set(VIEWMODEL_LAYER);
    root.add(mesh);
  }

  /* ---------------- fingers -------------------------------------- */
  const fingers: FingerRig[] = [];

  const makeSegment = (
    radius: number,
    len: number,
    tipTaper: number,
    seed: number,
    nail: boolean,
  ): THREE.BufferGeometry => {
    const b = new PartBuilder(mulberry32(seed));
    const seg = prim.capsule(radius, Math.max(0.004, len - radius * 1.2), 5, 12);
    taper(seg, (t) => [1.0 - t * tipTaper * 0.55, 1.06 - t * tipTaper]);
    // Rotate so the segment runs along -Z from the origin.
    transform(seg, { rot: [-Math.PI / 2, 0, 0], pos: [0, 0, -len * 0.5 + radius * 0.1] });
    sagZ(seg, -0.5);
    erode(seg, 0.0006, 90, seed % 17);
    b.add(seg, { occ: 0.22, edge: 1.0, id: (seed % 97) / 97 });
    // Joint bulge at the base so knuckles read as joints, not tube welds.
    const joint = prim.sphere(radius * 1.16, 10, 7);
    transform(joint, { scale: [1, 0.86, 0.8] });
    b.add(joint, { occ: 0.32, edge: 1.25, id: 0.4 });
    if (nail) {
      // Reinforced fingertip cap.
      const cap = prim.sphere(radius * 0.95, 10, 7);
      transform(cap, { pos: [0, radius * 0.22, -len + radius * 0.35], scale: [0.95, 0.55, 1.15] });
      b.add(cap, { occ: 0.06, edge: 1.5, id: 0.95 });
    }
    return b.build('hand.finger');
  };

  const addFinger = (
    x: number,
    y: number,
    z: number,
    radius: number,
    lenA: number,
    lenB: number,
    splay: number,
    restA: number,
    restB: number,
    gripA: number,
    gripB: number,
    seed: number,
  ): void => {
    const prox = new THREE.Object3D();
    prox.position.set(x * side, y, z);
    prox.rotation.set(restA, splay * side, 0);
    const gA = makeSegment(radius, lenA, 0.1, seed, false);
    geometries.push(gA);
    const mA = new THREE.Mesh(mirror(gA), mats.glove);
    mA.frustumCulled = false;
    mA.layers.set(VIEWMODEL_LAYER);
    prox.add(mA);

    const dist = new THREE.Object3D();
    dist.position.set(0, 0, -lenA);
    dist.rotation.set(restB, 0, 0);
    const gB = makeSegment(radius * 0.88, lenB, 0.3, seed + 31, true);
    geometries.push(gB);
    const mB = new THREE.Mesh(mirror(gB), mats.glove);
    mB.frustumCulled = false;
    mB.layers.set(VIEWMODEL_LAYER);
    dist.add(mB);
    prox.add(dist);
    root.add(prox);

    fingers.push({
      prox,
      dist,
      restProx: restA,
      restDist: restB,
      gripProx: gripA,
      gripDist: gripB,
      splay,
      phase: rnd() * Math.PI * 2,
    });
  };

  for (let i = 0; i < FINGERS.length; i++) {
    const [x, radius, lenA, lenB, splay] = FINGERS[i];
    // Relaxed underwater hands hang slightly curled; the little finger curls most.
    const relax = -0.3 - i * 0.055;
    addFinger(x, 0.004, -0.1, radius, lenA, lenB, splay, relax, relax * 1.35, -1.32 - i * 0.06, -1.5, 1200 + i * 77);
  }
  // Thumb: opposed, shorter, thicker, rotated out of the palm plane.
  {
    const prox = new THREE.Object3D();
    prox.position.set(-0.041 * side, -0.006, -0.03);
    prox.rotation.set(0.2, 0.92 * side, 0.35 * side);
    const gA = makeSegment(0.0152, 0.038, 0.12, 9001, false);
    geometries.push(gA);
    const mA = new THREE.Mesh(mirror(gA), mats.glove);
    mA.frustumCulled = false;
    mA.layers.set(VIEWMODEL_LAYER);
    prox.add(mA);
    const dist = new THREE.Object3D();
    dist.position.set(0, 0, -0.038);
    dist.rotation.set(-0.25, 0, 0);
    const gB = makeSegment(0.0136, 0.032, 0.35, 9047, true);
    geometries.push(gB);
    const mB = new THREE.Mesh(mirror(gB), mats.glove);
    mB.frustumCulled = false;
    mB.layers.set(VIEWMODEL_LAYER);
    dist.add(mB);
    prox.add(dist);
    root.add(prox);
    fingers.push({
      prox,
      dist,
      restProx: 0.2,
      restDist: -0.25,
      gripProx: -0.28,
      gripDist: -0.72,
      splay: 0.92,
      phase: rnd() * Math.PI * 2,
    });
  }

  let spread = 0;

  return {
    root,
    fingers,
    geometries,
    setSpread(t: number): void {
      spread = t;
    },
    setGrip(t: number, time: number): void {
      const g = THREE.MathUtils.clamp(t, 0, 1);
      for (let i = 0; i < fingers.length; i++) {
        const f = fingers[i];
        // Cascade: the grip closes from the little finger inward, and each digit
        // gets its own slow idle drift so the hand is never frozen.
        const cascade = THREE.MathUtils.clamp(g * 1.25 - i * 0.06, 0, 1);
        const idle = Math.sin(time * 0.9 + f.phase) * 0.02 + Math.sin(time * 2.3 + f.phase * 1.7) * 0.007;
        const drift = (1 - g) * idle;
        f.prox.rotation.x = THREE.MathUtils.lerp(f.restProx, f.gripProx, cascade) + drift;
        f.dist.rotation.x = THREE.MathUtils.lerp(f.restDist, f.gripDist, cascade) + drift * 1.4;
        f.prox.rotation.y = (f.splay * side) * (1 + spread * 0.85 - g * 0.7);
      }
    },
  };
}
