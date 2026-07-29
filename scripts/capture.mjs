/**
 * Headless capture harness. Boots the built game in Chromium, drives the
 * camera to a set of scripted vantage points, and writes PNGs used by the
 * visual-critique loop.
 *
 *   node scripts/capture.mjs [--out screenshots/ci] [--shots all] [--settle 30]
 *
 * `--settle` is how many RENDERED FRAMES each vantage point is allowed to
 * converge for before it is photographed. Frames, not milliseconds: a software
 * renderer can spend seconds on one frame, and a shot photographed too early
 * catches eased and streamed systems mid-transition. Any shot that fails to
 * reach its budget is recorded as an error in report.json.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);

const OUT = resolve(args.out ?? 'screenshots/ci');
const ROOT = resolve(args.dist ?? 'dist');
const WIDTH = Number(args.width ?? 1920);
const HEIGHT = Number(args.height ?? 1080);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.map': 'application/json',
  '.wasm': 'application/wasm', '.ktx2': 'application/octet-stream',
};

/** Scripted camera vantage points — these are the frames the critics judge. */
export const SHOTS = [
  // `pos` is only a seed. What actually decides a vantage point is `biome` (the
  // camera is walked outward from the seed until it stands in that biome) and
  // `aboveFloor` (its height is then taken from the live sea floor). Hardcoded Y
  // values went stale every time terrain changed — one shot ended up 42 m above a
  // biome whose tallest species is under 2 m, which reads as an empty world and
  // is easy to mistake for a rendering bug. Give `y` instead of `aboveFloor` to
  // pin an absolute height, which is what the two surface shots need.
  { id: '01_shallows_surface', pos: [0, 0, 0], y: -3.5, biome: 'shallows', yaw: 0.6, pitch: 0.25, tod: 12.5,
    intent: 'Sunlit shallows just under the surface looking up-forward: Snell window, god rays, caustics.' },
  { id: '02_shallows_floor', pos: [18, 0, -22], aboveFloor: 2.5, biome: 'shallows', yaw: 2.1, pitch: -0.16,
    tod: 12.0,
    intent: 'Sea floor in the shallows: sand detail, coral, caustic dapple, fish.' },
  { id: '03_kelp_forest', pos: [-120, 0, 96], aboveFloor: 3.0, biome: 'kelp_forest', yaw: 1.1, pitch: -0.05,
    tod: 11.0,
    intent: 'Inside a kelp forest: translucent blades, volumetric shafts, depth haze.' },
  { id: '04_reef_wall', pos: [210, 0, -150], aboveFloor: 14, biome: 'coral_reef', yaw: -1.9, pitch: 0.1,
    tod: 13.5,
    intent: 'Reef wall / drop-off: silhouette against blue, parallax, scale.' },
  { id: '05_deep_dark', pos: [-320, 0, -280], aboveFloor: 6, biome: 'blood_kelp', yaw: 0.3, pitch: -0.15,
    tod: 12.0,
    intent: 'Deep zone: near-black water, bioluminescence, torch cone, marine snow.' },
  { id: '06_surface_above', pos: [0, 0, 0], y: 2.6, biome: 'shallows', yaw: 0.9, pitch: -0.06, tod: 17.6,
    intent: 'Above water at golden hour: ocean surface, sky, sun glitter, horizon.' },
  { id: '07_night_dive', pos: [40, 0, 40], aboveFloor: 3.0, biome: 'shallows', yaw: 2.6, pitch: -0.1,
    tod: 22.0,
    intent: 'Night dive: flashlight cone, bioluminescent flora, moonlight from above.' },
  { id: '08_wreck', pos: [-60, 0, -190], landmark: 'aurora_bow', aboveFloor: 8, yaw: 0.2, pitch: -0.05,
    tod: 12.0,
    intent: 'Man-made wreck: PBR metal, rust, barnacles, interior darkness.' },
];


function serve(root, port) {
  return new Promise((res) => {
    const server = createServer(async (req, resp) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p === '/' || p.endsWith('/')) p += 'index.html';
        const file = join(root, p);
        if (!existsSync(file)) {
          resp.writeHead(404); resp.end('nf'); return;
        }
        const body = await readFile(file);
        resp.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        resp.end(body);
      } catch (e) {
        resp.writeHead(500); resp.end(String(e));
      }
    });
    server.listen(port, () => res(server));
  });
}

/**
 * Serialises capture runs machine-wide.
 *
 * Rendering here is software (swiftshader), so one run already saturates several
 * cores. Concurrent runs do not share nicely: with eight of them going the load
 * average hit 36 on a 4-core box, a frame cost over three seconds, and some runs
 * could not get past boot at all — which makes every screenshot they produce
 * untrustworthy. Queueing is strictly faster than thrashing, and it makes frame
 * timings comparable between runs.
 *
 * The lock is a directory (mkdir is atomic) holding the owning pid. A lock whose
 * owner is gone, or which is older than STALE_MS, is reclaimed.
 */
const LOCK = join(process.env.TMPDIR ?? '/tmp', 'spacenautica-capture.lock');
const STALE_MS = 45 * 60 * 1000;

/**
 * Turns a shot spec into a concrete camera position using the live world.
 *
 * Runs in the page. Walks a spiral out from the seed XZ looking for the target
 * biome, then takes the height from the sea floor there. Returns why it settled
 * where it did, so a shot that could not find its biome is visible in the report
 * rather than silently photographing the wrong place.
 */
function resolveShotInPage(s) {
  const g = window.__GAME__;
  if (!g) return null;
  const world = g.world ?? g.tryGet('world');
  if (!world?.heightAt) return { pos: [s.pos[0], s.y ?? s.pos[1], s.pos[2]], note: 'no world query' };

  const sample = (x, z) => {
    try {
      return world.biomeAt ? world.biomeAt(x, z) : null;
    } catch {
      return null;
    }
  };

  let x = s.pos[0];
  let z = s.pos[2];
  let note = null;

  // A shot aimed at a named place should frame that place, not a coordinate that
  // was correct when it was written. Back-solve the camera position from the
  // landmark so it lands `standoff` metres away along the authored view axis.
  if (s.landmark) {
    const reg = g.tryGet('world.props')?.landmarks;
    const l = typeof reg?.get === 'function' ? reg.get(s.landmark) : null;
    const lp = l?.position ?? (l && typeof l.x === 'number' ? { x: l.x, z: l.z } : null);
    if (lp) {
      // Yaw convention follows the camera rig: right = (cos y, 0, -sin y), so
      // forward = (-sin y, 0, -cos y).
      const d = s.standoff ?? (l.radius ?? 20) + 18;
      x = lp.x + Math.sin(s.yaw) * d;
      z = lp.z + Math.cos(s.yaw) * d;
      note = `framed landmark ${s.landmark} from ${Math.round(d)} m`;
    } else {
      note = `landmark ${s.landmark} not found in the registry; using seed XZ`;
    }
  }

  if (s.biome) {
    const here = sample(x, z);
    if (here?.id !== s.biome) {
      // Golden-angle spiral: even coverage without favouring an axis.
      let best = null;
      for (let i = 1; i <= 900; i++) {
        const r = 12 * Math.sqrt(i);
        const a = i * 2.399963229728653;
        const cx = s.pos[0] + r * Math.cos(a);
        const cz = s.pos[2] + r * Math.sin(a);
        const b = sample(cx, cz);
        if (b?.id !== s.biome) continue;
        // Prefer a point well inside the region over one on a blend boundary.
        if (!best || b.weight > best.w) best = { x: cx, z: cz, w: b.weight, r };
        if (best.w > 0.85) break;
      }
      if (best) {
        x = best.x;
        z = best.z;
        note = `relocated ${Math.round(best.r)} m to reach biome ${s.biome} (weight ${best.w.toFixed(2)})`;
      } else {
        note = `biome ${s.biome} not found within ~360 m of the seed; using seed XZ (actual: ${here?.id ?? 'unknown'})`;
      }
    }
  }

  const floor = world.heightAt(x, z);
  const y = s.y !== undefined ? s.y : floor + (s.aboveFloor ?? 3);
  return { pos: [x, y, z], floor, note };
}

async function acquireLock({ waitMs = 90 * 60 * 1000 } = {}) {
  const { mkdir: mk, writeFile: wf, readFile: rf, rm, stat } = await import('node:fs/promises');
  const startedAt = Date.now();
  let announced = false;
  for (;;) {
    try {
      await mk(LOCK);
      await wf(join(LOCK, 'pid'), String(process.pid));
      return async () => {
        try {
          await rm(LOCK, { recursive: true, force: true });
        } catch {
          /* nothing useful to do if the unlock fails */
        }
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    // Held by someone. Reclaim it if that someone is dead or it is ancient.
    let reclaim = false;
    try {
      const age = Date.now() - (await stat(LOCK)).mtimeMs;
      const owner = Number(await rf(join(LOCK, 'pid'), 'utf8').catch(() => '0'));
      const alive = owner > 0 && (() => { try { process.kill(owner, 0); return true; } catch { return false; } })();
      reclaim = age > STALE_MS || !alive;
      if (reclaim) {
        console.log(`capture: reclaiming ${alive ? 'stale' : 'abandoned'} lock from pid ${owner}`);
        await rm(LOCK, { recursive: true, force: true });
        continue;
      }
    } catch {
      continue; // lock vanished under us; retry immediately
    }
    if (Date.now() - startedAt > waitMs) {
      throw new Error(`capture: gave up waiting ${Math.round(waitMs / 60000)} min for ${LOCK}`);
    }
    if (!announced) {
      console.log('capture: another run holds the lock, queueing (software GL does not share cores)');
      announced = true;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

async function main() {
  if (!existsSync(ROOT)) {
    console.error(`${ROOT} missing — run \`npm run build\` first`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });

  // Queue behind any other capture run before spending anything.
  const releaseLock = args['no-lock'] ? async () => {} : await acquireLock();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await releaseLock();
  };
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => { release().finally(() => process.exit(130)); });
  }

  const port = 4180 + (process.pid % 400);
  const server = await serve(ROOT, port);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage',
    ],
  });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 90_000 });

  try {
    await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 180_000 });
  } catch {
    errors.push('TIMEOUT: window.__READY__ never became true');
  }

  const SETTLE = Number.isFinite(+args.settle) && +args.settle > 0 ? +args.settle : 30;
  const only = typeof args.shots === 'string' && args.shots !== 'all'
    ? new Set(args.shots.split(',').map((s) => s.trim()))
    : null;
  const results = [];
  for (const shot of SHOTS) {
    if (only && !only.has(shot.id)) continue;
    // Settling is counted in RENDERED FRAMES, not milliseconds. Under software
    // GL a frame can take well over a second, so a wall-clock wait can span a
    // single frame and photograph every eased or streamed system mid-transition
    // — that is what produced the wrong biome labels and a depth readout still
    // gliding down from the previous vantage point.
    //
    // The pose is re-pinned on every poll rather than set once, because physics
    // keeps integrating between frames and would otherwise walk the camera off
    // the mark during the settle.
    // Settle depth is tunable because the cost per frame varies enormously:
    // ~16 ms on a real GPU, seconds under software GL, and worse again when other
    // work is competing for the CPU. The deadline scales with the frame budget
    // instead of being a fixed wall-clock number.
    // Resolve the vantage point against the live world first, then pin to the
    // resolved position for the rest of the shot.
    const resolved = await page.evaluate(resolveShotInPage, shot);
    if (!resolved) {
      errors.push(`${shot.id}: window.__GAME__ missing, cannot resolve vantage point`);
      continue;
    }
    if (resolved.note) console.log(`  ${shot.id}: ${resolved.note}`);
    if (resolved.note && resolved.note.includes('not found')) errors.push(`${shot.id}: ${resolved.note}`);
    const target = { ...shot, pos: resolved.pos };

    const settleFrames = shot.settle ?? SETTLE;
    const deadlineMs = shot.timeout ?? Math.max(60000, settleFrames * 9000);
    const startedAt = Date.now();
    let settled = false;

    const pin = () =>
      page.evaluate((s) => {
        const g = window.__GAME__;
        if (!g) return -1;
        const player = g.tryGet('player');
        if (player) {
          player.position.set(s.pos[0], s.pos[1], s.pos[2]);
          player.velocity.set(0, 0, 0);
          player.yaw = s.yaw;
          player.pitch = s.pitch;
        }
        const sky = g.tryGet('world.sky');
        if (sky) sky.timeOfDay = s.tod;
        return g.frame;
      }, target);

    const frame0 = await pin();
    if (frame0 < 0) {
      errors.push(`${shot.id}: window.__GAME__ missing, cannot pose camera`);
    } else {
      while (Date.now() - startedAt < deadlineMs) {
        const f = await pin();
        if (f - frame0 >= settleFrames) {
          settled = true;
          break;
        }
        await page.waitForTimeout(50);
      }
      if (!settled) {
        const f = await pin();
        errors.push(
          `${shot.id}: only settled ${f - frame0}/${settleFrames} frames in ` +
            `${Math.round((Date.now() - startedAt) / 1000)}s — the frame is likely ` +
            `mid-transition and must not be trusted for visual review`,
        );
      }
    }
    // One last pin so the photographed frame is the pinned one.
    await pin();

    // Record where the camera actually ended up. A shot whose observed biome or
    // depth disagrees with its intent is not evidence about the renderer — it is
    // a harness bug — so make that visible in the report instead of leaving it to
    // be spotted in a HUD readout.
    const observed = await page.evaluate(() => {
      const g = window.__GAME__;
      if (!g) return null;
      const p = g.tryGet('player');
      const w = g.tryGet('world.terrain') ?? g.tryGet('world');
      let biome = null;
      try {
        biome = p && w?.biomeAt ? (w.biomeAt(p.position.x, p.position.z)?.name ?? null) : null;
      } catch {
        biome = null;
      }
      return p
        ? {
            pos: [+p.position.x.toFixed(1), +p.position.y.toFixed(1), +p.position.z.toFixed(1)],
            depth: +p.depth.toFixed(1),
            submerged: p.submerged,
            mode: p.mode,
            biome,
          }
        : null;
    });

    const file = join(OUT, `${shot.id}.png`);
    // The default 30 s timeout is not enough under software GL: a single frame can
    // take seconds, and a capture that trips this fails the whole run.
    await page.screenshot({ path: file, timeout: 180_000 });
    results.push({
      id: shot.id,
      file,
      intent: shot.intent,
      seed: shot.pos,
      resolved: resolved.pos,
      floorY: resolved.floor,
      placement: resolved.note ?? 'seed accepted',
      observed,
    });

    // Drifted off the mark: the pin failed, so say so loudly.
    if (observed && Math.hypot(...observed.pos.map((v, i) => v - resolved.pos[i])) > 1.5) {
      errors.push(
        `${shot.id}: camera drifted to ${observed.pos.join(', ')} from ` +
          `${resolved.pos.map((v) => v.toFixed(1)).join(', ')} — pose pin is not holding`,
      );
    }
    console.log(
      `captured ${shot.id}` +
        (observed ? `  depth=${observed.depth}m mode=${observed.mode}${observed.biome ? ` biome=${observed.biome}` : ''}` : ''),
    );
  }

  const fps = await page.evaluate(() => {
    const g = window.__GAME__;
    return g ? { frameMs: g.frameMs, adaptiveScale: g.adaptiveScale, tier: g.settings.graphics.tier } : null;
  });

  await writeFile(join(OUT, 'report.json'), JSON.stringify({ results, errors, fps }, null, 2));
  console.log(`\nerrors: ${errors.length}`);
  for (const e of errors.slice(0, 20)) console.log('  !', e);
  console.log('perf:', JSON.stringify(fps));

  await browser.close();
  server.close();
  await release();
  if (errors.length) process.exitCode = 2;
}

main().catch(async (e) => {
  console.error(String(e?.stack ?? e));
  // The lock must never outlive a crashed run; the reclaim path is a backstop,
  // not the normal route.
  try {
    const { rm } = await import('node:fs/promises');
    const { readFile: rf } = await import('node:fs/promises');
    const owner = Number(await rf(join(LOCK, 'pid'), 'utf8').catch(() => '0'));
    if (owner === process.pid) await rm(LOCK, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  process.exit(1);
});
