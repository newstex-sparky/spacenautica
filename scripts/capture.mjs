/**
 * Headless capture harness. Boots the built game in Chromium, drives the
 * camera to a set of scripted vantage points, and writes PNGs used by the
 * visual-critique loop.
 *
 *   node scripts/capture.mjs [--out screenshots/ci] [--shots all]
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
const ROOT = resolve('dist');
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
  { id: '01_shallows_surface', pos: [0, -3.5, 0], yaw: 0.6, pitch: 0.25, tod: 12.5, wait: 2200,
    intent: 'Sunlit shallows just under the surface looking up-forward: Snell window, god rays, caustics.' },
  { id: '02_shallows_floor', pos: [18, -16, -22], yaw: 2.1, pitch: -0.22, tod: 12.0, wait: 1600,
    intent: 'Sea floor in the shallows: sand detail, coral, caustic dapple, fish.' },
  { id: '03_kelp_forest', pos: [-120, -42, 96], yaw: 1.1, pitch: -0.05, tod: 11.0, wait: 1800,
    intent: 'Inside a kelp forest: translucent blades, volumetric shafts, depth haze.' },
  { id: '04_reef_wall', pos: [210, -70, -150], yaw: -1.9, pitch: 0.1, tod: 13.5, wait: 1600,
    intent: 'Reef wall / drop-off: silhouette against blue, parallax, scale.' },
  { id: '05_deep_dark', pos: [-320, -240, -280], yaw: 0.3, pitch: -0.15, tod: 12.0, wait: 1600,
    intent: 'Deep zone: near-black water, bioluminescence, torch cone, marine snow.' },
  { id: '06_surface_above', pos: [0, 2.6, 0], yaw: 0.9, pitch: -0.06, tod: 17.6, wait: 2000,
    intent: 'Above water at golden hour: ocean surface, sky, sun glitter, horizon.' },
  { id: '07_night_dive', pos: [40, -28, 40], yaw: 2.6, pitch: -0.1, tod: 22.0, wait: 1800,
    intent: 'Night dive: flashlight cone, bioluminescent flora, moonlight from above.' },
  { id: '08_wreck', pos: [-60, -55, -190], yaw: 0.2, pitch: -0.05, tod: 12.0, wait: 1800,
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

async function main() {
  if (!existsSync(ROOT)) {
    console.error('dist/ missing — run `npm run build` first');
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
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

  const results = [];
  for (const shot of SHOTS) {
    await page.evaluate((s) => {
      const g = window.__GAME__;
      if (!g) return;
      const player = g.tryGet('player');
      if (player) {
        player.position.set(s.pos[0], s.pos[1], s.pos[2]);
        player.velocity.set(0, 0, 0);
        player.yaw = s.yaw;
        player.pitch = s.pitch;
      }
      const sky = g.tryGet('world.sky');
      if (sky) sky.timeOfDay = s.tod;
    }, shot);

    await page.waitForTimeout(shot.wait);
    const file = join(OUT, `${shot.id}.png`);
    await page.screenshot({ path: file });
    results.push({ id: shot.id, file, intent: shot.intent });
    console.log(`captured ${shot.id}`);
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
  if (errors.length) process.exitCode = 2;
}

main();
