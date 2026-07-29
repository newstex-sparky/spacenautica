/**
 * Headless screenshot driver for the terrain smoke harness.
 *
 *   npx vite build --config src/game/world/terrain/verify/vite.terrain.config.mjs
 *   node src/game/world/terrain/verify/shoot.mjs --out /tmp/shot-terrain
 *
 * Writes one PNG per vantage point plus report.json containing every console
 * error (GLSL link failures show up there) and a per-shot terrain probe.
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

const ROOT = resolve(args.dist ?? 'dist-terrain-verify');
const OUT = resolve(args.out ?? '/tmp/shot-terrain');
const WIDTH = Number(args.width ?? 1280);
const HEIGHT = Number(args.height ?? 720);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.map': 'application/json',
};

/** Vantage points chosen to exercise every feature the brief calls for. */
const SHOTS = [
  { id: 'T1_shelf_floor', pos: [18, -24, -22], yaw: 2.1, pitch: -0.22 },
  { id: 'T2_close_sand', pos: [6, -27.4, 4], yaw: 1.0, pitch: -0.62 },
  { id: 'T3_dropoff', pos: [205, -78, -150], yaw: -1.9, pitch: -0.06 },
  // Aimed at the real set-piece coordinates in TerrainField.SET_PIECES.
  { id: 'T4_spire', pos: [132, -58, -18], yaw: 0.0, pitch: 0.06 },
  { id: 'T5_sinkhole', pos: [-92, -30, 256], yaw: 0.0, pitch: -0.22 },
  { id: 'T6_arch', pos: [-156, -48, 112], yaw: 0.0, pitch: 0.06 },
  { id: 'T7_deep', pos: [-320, -240, -280], yaw: 0.3, pitch: -0.15 },
  { id: 'T8_lod_far', pos: [0, -12, 0], yaw: 0.8, pitch: -0.32 },
];

function serve(root, port) {
  return new Promise((res) => {
    const server = createServer(async (req, resp) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p === '/' || p.endsWith('/')) p += 'index.html';
        const file = join(root, p);
        if (!existsSync(file)) {
          resp.writeHead(404).end('nope');
          return;
        }
        const body = await readFile(file);
        resp.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        resp.end(body);
      } catch (err) {
        resp.writeHead(500).end(String(err));
      }
    });
    server.listen(port, () => res(server));
  });
}

const port = 5199;
const server = await serve(ROOT, port);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage',
  ],
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`http://localhost:${port}/index.html`);
await page.waitForFunction('window.__READY__ === true', null, { timeout: Number(args.boot ?? 600000) });

const only = args.shots && args.shots !== true ? String(args.shots).split(',') : null;
const SHOT_TIMEOUT = Number(args.timeout ?? 180000);

const results = [];
for (const s of SHOTS) {
  if (only && !only.includes(s.id)) continue;
  await page.evaluate(
    ([x, y, z, yaw, pitch]) => window.__TVIEW__(x, y, z, yaw, pitch),
    [...s.pos, s.yaw, s.pitch],
  );
  // Let the streamer converge on this vantage point.
  await page.waitForTimeout(2600);
  const probe = await page.evaluate('window.__TPROBE__()');
  const views = args.views ? String(args.views).split(',').map(Number) : [0];
  for (const v of views) {
    await page.evaluate((m) => window.__TDBG__(m), v);
    await page.waitForTimeout(600);
    const suffix = v === 0 ? '' : `_dbg${v}`;
    await page.screenshot({ path: join(OUT, `${s.id}${suffix}.png`), timeout: SHOT_TIMEOUT });
  }
  await page.evaluate(() => window.__TDBG__(0));
  results.push({ id: s.id, probe: JSON.parse(probe) });
  console.log(s.id, probe);
}

await writeFile(join(OUT, 'report.json'), JSON.stringify({ results, errors }, null, 2));
console.log(`\n${errors.length} console errors/warnings -> ${join(OUT, 'report.json')}`);
await browser.close();
server.close();
