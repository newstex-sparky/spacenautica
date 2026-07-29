/**
 * Development-only material preview. Not part of the game bundle — the game's
 * entry point is the repository-root index.html, which never imports this.
 *
 * Build + shoot it with:
 *   npx vite build --config <tmp>/vite.mat.config.ts
 *   node <tmp>/shoot.mjs
 *
 * It exists because TypeScript cannot catch a GLSL compile error and because
 * "does this material actually look like rock" is only answerable by looking.
 */
import * as THREE from 'three';
import { Settings } from '../../core/Settings';
import { TEXTURE_IDS } from '../TextureIds';
import { TextureBaker } from '../TextureBaker';
import { TextureLibrary } from '../TextureLibrary';
import { TUNED_IDS, materialDef } from '../MaterialDefs';
import type { GameContext } from '../../core/Types';

const CELL = 128;
const COLS = 6;
const SPHERE = 132;

declare global {
  interface Window {
    __TEXREPORT__?: unknown;
    __TEXREADY__?: boolean;
  }
}

interface Stat {
  id: string;
  ms: number;
  albedo: [number, number, number];
  normalZ: number;
  height: [number, number];
  ao: [number, number];
  rough: [number, number];
  metal: number;
  flatFlag: string;
}

function log(msg: string): void {
  const el = document.getElementById('log');
  if (el) el.textContent += `\n${msg}`;
}

/**
 * Yield to the browser.
 *
 * This matters more than it looks. Baking N material sets under a software
 * rasteriser is seconds of unbroken GPU work, and if it runs inside the module's
 * initial synchronous execution the `load` event never fires — the page appears
 * hung, and any harness using `waitUntil: 'load'` times out before the first map
 * exists. Awaiting a frame between units of work keeps the document responsive
 * and lets the log paint as it goes. The game itself is already safe here
 * because `Engine.boot()` awaits a frame between system inits.
 */
function frame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

const BLIT_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const BLIT_FRAG = /* glsl */ `
uniform sampler2D tex;
uniform int mode;   // 0 = raw rgb, 1 = sRGB-encode rgb, 2 = alpha as grey
varying vec2 vUv;
void main(){
  vec4 c = texture2D(tex, vUv);
  vec3 o = c.rgb;
  if (mode == 2) o = vec3(c.a);
  if (mode == 1) o = pow(max(o, 0.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(o, 1.0);
}
`;

/**
 * `?only=sand_fine,rock_basalt` restricts the page to a few materials, and
 * `?size=512` overrides the bake resolution. Baking all 39 sets at 256 takes
 * minutes under a software rasteriser, which is too slow to iterate against.
 */
function selection(): { ids: string[]; size: number } {
  const q = new URLSearchParams(location.search);
  const only = (q.get('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ids = only.length ? TUNED_IDS.filter((id) => only.includes(id)) : [...TUNED_IDS];
  return { ids: ids.length ? ids : [...TUNED_IDS], size: Number(q.get('size') ?? 256) };
}

async function main(): Promise<void> {
  const atlas = document.getElementById('atlas') as HTMLCanvasElement;
  const lit = document.getElementById('lit') as HTMLCanvasElement;
  const sel = selection();
  const IDS = sel.ids;

  // Let the document finish loading before any GPU work starts.
  await frame();

  const rows = Math.ceil(IDS.length / COLS);
  atlas.width = COLS * CELL * 3;
  atlas.height = rows * CELL;
  lit.width = COLS * SPHERE;
  lit.height = rows * SPHERE;

  /* ---------------- pass 1: bake everything, collect stats ---------------- */
  const renderer = new THREE.WebGLRenderer({ canvas: atlas, antialias: false, alpha: false });
  renderer.debug.checkShaderErrors = true;
  renderer.setPixelRatio(1);
  renderer.setSize(atlas.width, atlas.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x101418, 1);

  const settings = new Settings();
  settings.applyPreset('high');

  // Prove the real system path boots and reports sane numbers.
  const lib = new TextureLibrary();
  const fakeCtx = {
    renderer,
    settings,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
  } as unknown as GameContext;
  lib.init(fakeCtx);
  log(`TextureLibrary.init ok: ${JSON.stringify(lib.stats)}`);
  log(`registry ids=${TEXTURE_IDS.length} tuned=${TUNED_IDS.length} shown=${IDS.length} size=${sel.size}`);

  const baker = new TextureBaker(renderer);
  const size = sel.size;
  const stats: Stat[] = [];
  const baked: Array<{ id: string; target: THREE.WebGLRenderTarget }> = [];

  const readRt = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const buf = new Uint8Array(size * size * 4);

  const blitMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, mode: { value: 0 } },
    vertexShader: BLIT_VERT,
    fragmentShader: BLIT_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const sample = (tex: THREE.Texture, mode: number): Uint8Array => {
    blitMat.uniforms.tex.value = tex;
    blitMat.uniforms.mode.value = mode;
    renderer.setRenderTarget(readRt);
    renderer.render(quadScene, quadCam);
    renderer.readRenderTargetPixels(readRt, 0, 0, size, size, buf);
    renderer.setRenderTarget(null);
    return buf;
  };

  const chan = (b: Uint8Array, c: number): { min: number; max: number; mean: number } => {
    let mn = 255;
    let mx = 0;
    let sum = 0;
    for (let i = c; i < b.length; i += 16) {
      const v = b[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      sum += v;
    }
    return { min: mn, max: mx, mean: (sum / (b.length / 16)) | 0 };
  };

  for (const id of IDS) {
    await frame();
    const def = materialDef(id);
    const r = baker.bake(id, def, { size, anisotropy: 4, aoTaps: 8 });
    baked.push({ id, target: r.target });

    const a = sample(r.albedo, 0);
    const ar = chan(a, 0);
    const ag = chan(a, 1);
    const ab = chan(a, 2);
    const nb = sample(r.normal, 0);
    const nz = chan(nb, 2);
    const hb = sample(r.normal, 2);
    const hh = chan(hb, 0);
    const ob = sample(r.orm, 0);
    const ao = chan(ob, 0);
    const ro = chan(ob, 1);
    const me = chan(ob, 2);

    const flags: string[] = [];
    if (ro.max - ro.min < 12) flags.push('FLAT_ROUGH');
    if (ar.max - ar.min < 12 && ag.max - ag.min < 12) flags.push('FLAT_ALBEDO');
    if (hh.max - hh.min < 12) flags.push('FLAT_HEIGHT');
    if (nz.mean < 90) flags.push('NORMAL_TOO_STEEP');
    if (nz.min > 250) flags.push('NORMAL_FLAT');
    if (ao.min > 245) flags.push('NO_AO');
    if (ar.max > 253 || ag.max > 253) flags.push('ALBEDO_CLIP');

    stats.push({
      id,
      ms: +r.ms.toFixed(2),
      albedo: [ar.mean, ag.mean, ab.mean],
      normalZ: nz.mean,
      height: [hh.min, hh.max],
      ao: [ao.min, ao.mean],
      rough: [ro.min, ro.max],
      metal: me.mean,
      flatFlag: flags.join(',') || 'ok',
    });
  }

  /* ---------------- pass 2: atlas of raw maps ---------------- */
  renderer.setRenderTarget(null);
  renderer.setScissorTest(true);
  renderer.clear();
  baked.forEach(({ target }, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const y = atlas.height - (row + 1) * CELL;
    const maps: Array<[THREE.Texture, number]> = [
      [target.textures[0], 1],
      [target.textures[1], 0],
      [target.textures[2], 0],
    ];
    maps.forEach(([tex, mode], m) => {
      const x = (col * 3 + m) * CELL;
      renderer.setViewport(x, y, CELL, CELL);
      renderer.setScissor(x, y, CELL, CELL);
      blitMat.uniforms.tex.value = tex;
      blitMat.uniforms.mode.value = mode;
      renderer.render(quadScene, quadCam);
    });
  });
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, atlas.width, atlas.height);

  /* ---------------- pass 3: lit spheres ---------------- */
  const r2 = new THREE.WebGLRenderer({ canvas: lit, antialias: true, alpha: false });
  r2.setPixelRatio(1);
  r2.setSize(lit.width, lit.height, false);
  r2.outputColorSpace = THREE.SRGBColorSpace;
  r2.toneMapping = THREE.ACESFilmicToneMapping;
  r2.setClearColor(0x0b1013, 1);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  cam.position.set(0, 0, 4.1);
  const sun = new THREE.DirectionalLight(0xfff2dd, 3.1);
  sun.position.set(-1.1, 1.5, 1.6);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x5b86a8, 0x1a2a26, 0.85));
  const geo = new THREE.SphereGeometry(1, 96, 64);
  geo.setAttribute('uv1', geo.getAttribute('uv'));

  // Re-bake through the public API so the lit preview exercises get()/applyPbrMaps.
  const litBaker = new TextureBaker(r2);
  const mats: THREE.MeshStandardMaterial[] = [];

  // Bake with a yield between materials, but draw every sphere in ONE
  // uninterrupted pass: this canvas has no preserveDrawingBuffer, so any yield
  // between the scissored draws discards everything already rendered and the
  // sheet comes out with only the last sphere on it.
  for (const id of IDS) {
    await frame();
    const r = litBaker.bake(id, materialDef(id), { size, anisotropy: 4, aoTaps: 8 });
    mats.push(
      new THREE.MeshStandardMaterial({
        map: r.albedo,
        normalMap: r.normal,
        roughnessMap: r.orm,
        aoMap: r.orm,
        metalnessMap: r.orm,
        roughness: 1,
        metalness: 1,
      }),
    );
  }

  r2.setScissorTest(true);
  r2.clear();
  mats.forEach((mat, i) => {
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    r2.setViewport(col * SPHERE, lit.height - (row + 1) * SPHERE, SPHERE, SPHERE);
    r2.setScissor(col * SPHERE, lit.height - (row + 1) * SPHERE, SPHERE, SPHERE);
    r2.render(scene, cam);
    scene.remove(mesh);
  });
  r2.setScissorTest(false);

  const worst = [...stats].sort((a, b) => b.ms - a.ms).slice(0, 5);
  const bad = stats.filter((s) => s.flatFlag !== 'ok');
  window.__TEXREPORT__ = {
    libStats: lib.stats,
    totalMs: +stats.reduce((a, s) => a + s.ms, 0).toFixed(1),
    slowest: worst.map((s) => `${s.id}=${s.ms}ms`),
    flagged: bad.map((s) => `${s.id}: ${s.flatFlag}`),
    stats,
  };
  log(`baked ${stats.length} materials, ${stats.reduce((a, s) => a + s.ms, 0).toFixed(0)} ms total`);
  log(`flagged: ${bad.length ? bad.map((s) => `${s.id}[${s.flatFlag}]`).join(' ') : 'none'}`);
  window.__TEXREADY__ = true;
}

main().catch((err) => {
  log(`FATAL ${String(err)}`);
  window.__TEXREADY__ = true;
  console.error(err);
});
