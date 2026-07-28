/* TEMPORARY GLSL smoke test — deleted before hand-off. Not imported by the game. */
import * as THREE from 'three';
import { PropMaterialLibrary, PROP_MATERIALS } from './PropMaterials';
import type { PropMatId } from './PropMaterials';
import { makeCoralSample, makeCrystalCluster, makeEggCluster, makeRock, makeSalvage, makeVentChimney } from './RockGen';
import { makeContainer, makeEscapePod, makeHullSection, makePrecursorStructure } from './WreckGen';
import { VentField } from './VentField';

declare global {
  interface Window { __PROBE__?: string }
}

export function runProbe(canvas: HTMLCanvasElement): void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.debug.checkShaderErrors = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.setSize(1000, 620, false);
  canvas.style.width = '1000px'; canvas.style.height = '620px';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1000 / 620, 0.1, 1000);
  camera.position.set(0, 3, 14);

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.position.set(30, 60, 20);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 200;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0x88ccff, 0x223322, 0.6));
  for (let i = 0; i < 4; i++) {
    const p = new THREE.PointLight(0xff8844, 5, 20);
    p.position.set(i * 2 - 3, 2, 0);
    scene.add(p);
  }

  const shared: Record<string, THREE.IUniform> = {
    uwExtinction: { value: new THREE.Vector3(0.42, 0.09, 0.045) },
    uwInscatter: { value: new THREE.Color(0.06, 0.3, 0.38) },
    uwSurfaceY: { value: 0 },
    uwDensity: { value: 1 },
    uwSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.3) },
    uwSunColor: { value: new THREE.Color(1, 0.97, 0.9) },
    uwTime: { value: 0 },
    uwCameraDepth: { value: 12 },
  };

  const mats = new PropMaterialLibrary(shared, 'ultra');
  const errors: string[] = [];

  // --- plain meshes, one per material family -----------------------
  const rock = makeRock(11, 'boulder');
  const outcrop = makeRock(12, 'outcrop');
  const slab = makeRock(13, 'slab');
  const crystal = makeCrystalCluster(14, 4);
  const egg = makeEggCluster(15);
  const coral = makeCoralSample(16);
  const salvage = makeSalvage(17, 'panel');
  const chimney = makeVentChimney(18, 3);

  const shapes: Array<[PropMatId, THREE.BufferGeometry]> = [];
  for (const id of Object.keys(PROP_MATERIALS) as PropMatId[]) {
    const spec = PROP_MATERIALS[id];
    const geo = spec.kind === 'crystal' ? crystal.lods[0]
      : spec.kind === 'organic' ? (id === 'egg_shell' ? egg.lods[0] : coral.lods[0])
        : spec.kind === 'metal' ? salvage.lods[0]
          : spec.kind === 'alien' ? slab.lods[0]
            : id === 'rock_vent' ? chimney.lods[0] : rock.lods[0];
    shapes.push([id, geo]);
  }
  let x = -8;
  for (const [id, geo] of shapes) {
    const m = new THREE.Mesh(geo, mats.get(id));
    m.position.set(x, 0, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    x += 1.4;
  }

  // --- BatchedMesh path (USE_BATCHING) -----------------------------
  {
    let verts = 0;
    for (const g of [rock.lods[0], outcrop.lods[0], slab.lods[0]]) verts += g.getAttribute('position').count;
    const batch = new THREE.BatchedMesh(6, verts, 0, mats.get('rock_basalt'));
    batch.castShadow = true;
    batch.receiveShadow = true;
    const ids = [rock.lods[0], outcrop.lods[0], slab.lods[0]].map((g) => batch.addGeometry(g));
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 6; i++) {
      const inst = batch.addInstance(ids[i % ids.length]);
      m4.makeTranslation(i * 2 - 5, 0, -6);
      batch.setMatrixAt(inst, m4);
    }
    batch.computeBoundingSphere();
    scene.add(batch);
  }

  // --- wrecks -------------------------------------------------------
  for (const build of [makeHullSection(1), makeEscapePod(2), makePrecursorStructure(3)]) {
    const root = new THREE.Group();
    root.position.set(0, 0, -30);
    for (const part of build.parts) {
      const mesh = new THREE.Mesh(part.geo, mats.get(part.mat));
      mesh.castShadow = part.castShadow;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    scene.add(root);
  }
  {
    const c = new THREE.Mesh(makeContainer(9), mats.get('salvage_metal'));
    c.position.set(3, 0, -3);
    scene.add(c);
  }

  // --- highlight shell ---------------------------------------------
  {
    const hl = new THREE.Mesh(rock.lods[0], mats.makeHighlightMaterial());
    hl.position.set(0, 0, 4);
    scene.add(hl);
  }

  // --- vents (plume, bubbles, shimmer) ------------------------------
  const vents = new VentField(mats, shared, 'ultra');
  vents.build(
    [{ pos: new THREE.Vector3(0, -1, -12), height: 3, heat: 0.8, seed: 7 }],
    [{ pos: new THREE.Vector3(4, -1, -10), strength: 1 }],
    1,
  );
  scene.add(vents.group);
  for (const m of vents.group.children) if (m instanceof THREE.Mesh) m.visible = true;

  // sand floor so props are not floating in the void
  {
    const floorGeo = new THREE.PlaneGeometry(400, 400, 1, 1);
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: 0xbfae86, roughness: 1 }));
    floor.position.y = -0.35;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  const VIEWS: Array<[number, number, number, number, number, number]> = [
    [-1.5, 2.2, 6.5, -1.5, 0.9, 0],            // material row close-up
    [10, 6, -14, 0, 1.5, -30],                 // hull exterior
    [0, 0.6, -18.5, 0, 0.2, -34],              // hull interior looking in
    [9, 3.5, -4, 0, 1.5, -12],                 // vent + plume
    [-14, 9, -14, 0, 8, -30],                  // precursor gate
  ];
  const w = window as unknown as { __VIEW__?: number };
  const loop = () => {
    const v = VIEWS[Math.min(VIEWS.length - 1, w.__VIEW__ ?? 0)];
    camera.position.set(v[0], v[1], v[2]);
    camera.lookAt(v[3], v[4], v[5]);
    shared.uwTime.value = performance.now() * 0.001;
    vents.update(0.016, {
      time: performance.now() * 0.001, camera,
      world: { currentAt: (_x: number, _y: number, _z: number, _t: number, out: THREE.Vector3) => out.set(0.2, 0, 0.1) },
    } as never);
    try { renderer.render(scene, camera); } catch (e) { errors.push(String(e)); }
    requestAnimationFrame(loop);
  };
  try { renderer.compile(scene, camera); } catch (e) { errors.push(String(e)); }
  loop();

  const progs = renderer.info.programs?.length ?? 0;
  window.__PROBE__ = JSON.stringify({
    programs: progs,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    errors,
  });
}
