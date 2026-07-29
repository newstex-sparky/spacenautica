/**
 * Captures the sky verify harness at a set of times of day and pitches.
 *
 *   npx vite build --config src/game/world/sky/verify/vite.sky.config.mjs
 *   node src/game/world/sky/verify/shoot.mjs --out /tmp/skyshots
 *
 * Flags: --out --dist --width --height --tods 6.2,12,17.6,20.5,22 --pitches 0,0.5
 *        --y 2.6  --storm -1 (leave the procedural weather alone)
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

const OUT = resolve(args.out ?? '/tmp/sky-verify');
const ROOT = resolve(args.dist ?? 'dist-skyverify');
const W = Number(args.width ?? 640);
const H = Number(args.height ?? 360);
const Y = Number(args.y ?? 2.6);
const STORM = args.storm === undefined ? 0.25 : Number(args.storm);
const TODS = String(args.tods ?? '5.8,12.0,17.6,19.4,22.0').split(',').map(Number);
const PITCHES = String(args.pitches ?? '0.0,0.5').split(',').map(Number);
const SETTLE = Number(args.settle ?? 6);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.map': 'application/json',
};

function serve(root, port) {
  return new Promise((res) => {
    const server = createServer(async (req, resp) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p === '/' || p.endsWith('/')) p += 'index.html';
        const file = join(root, p);
        if (!existsSync(file)) { resp.writeHead(404); resp.end('nf'); return; }
        const body = await readFile(file);
        resp.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        resp.end(body);
      } catch (e) { resp.writeHead(500); resp.end(String(e)); }
    });
    server.listen(port, () => res(server));
  });
}

async function main() {
  if (!existsSync(ROOT)) {
    console.error(`${ROOT} missing — build the harness first`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  const port = 4720 + (process.pid % 200);
  const server = await serve(ROOT, port);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage',
    ],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 90_000 });
  try {
    await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 180_000 });
  } catch {
    errors.push('TIMEOUT: __READY__ never became true');
  }

  const pin = (tod, pitch) => page.evaluate((s) => {
    const g = window.__GAME__;
    if (!g) return -1;
    const sky = g.tryGet('world.sky');
    const player = g.tryGet('player');
    player.position.set(0, s.y, 0);
    player.velocity.set(0, 0, 0);
    player.yaw = 0.9;
    player.pitch = s.pitch;
    sky.timeOfDay = s.tod;
    if (s.storm >= 0) sky.weather.stormOverride = s.storm;
    return g.frame;
  }, { tod, pitch, y: Y, storm: STORM });

  const shots = [];
  for (const tod of TODS) {
    for (const pitch of PITCHES) {
      const f0 = await pin(tod, pitch);
      for (let i = 0; i < 200; i++) {
        const f = await pin(tod, pitch);
        if (f - f0 >= SETTLE) break;
        await page.waitForTimeout(40);
      }
      await pin(tod, pitch);
      const name = `t${tod}_p${pitch}.png`;
      await page.screenshot({ path: join(OUT, name), timeout: 150_000 });
      shots.push(name);
      console.log('captured', name);
    }
  }

  const state = await page.evaluate(() => {
    const g = window.__GAME__;
    const sky = g.tryGet('world.sky');
    return {
      tod: sky.timeOfDay,
      sunDir: [sky.sunDirection.x, sky.sunDirection.y, sky.sunDirection.z].map((v) => +v.toFixed(4)),
      sunIntensity: +sky.sunIntensity.toFixed(3),
      sunColor: [sky.sunColor.r, sky.sunColor.g, sky.sunColor.b].map((v) => +v.toFixed(3)),
      ambient: [sky.ambientColor.r, sky.ambientColor.g, sky.ambientColor.b].map((v) => +v.toFixed(3)),
      moonDir: [sky.moonDirection.x, sky.moonDirection.y, sky.moonDirection.z].map((v) => +v.toFixed(3)),
      storm: +sky.stormFactor.toFixed(3),
      windSpeed: +sky.windSpeed.toFixed(2),
      rain: +sky.rainIntensity.toFixed(3),
      aurora: +sky.auroraStrength.toFixed(3),
      sunOcclusion: +sky.sunOcclusion.toFixed(3),
      frameMs: +g.frameMs.toFixed(1),
      pano: sky.panoramaTexture ? 'present' : 'null',
    };
  });

  await writeFile(join(OUT, 'report.json'), JSON.stringify({ shots, state, errors }, null, 2));
  console.log(JSON.stringify(state, null, 1));
  console.log(`errors: ${errors.length}`);
  for (const e of errors.slice(0, 20)) console.log('  !', e);
  await browser.close();
  server.close();
  if (errors.length) process.exitCode = 2;
}

main();
