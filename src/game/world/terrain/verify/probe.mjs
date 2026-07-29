/**
 * Texture-pack diagnostic. Boots the terrain harness and reads back one texel
 * per splat layer from the packed sampler2DArrays and from the source PBR maps.
 * No screenshots, so it finishes in seconds even under swiftshader.
 *
 *   npx vite build --config src/game/world/terrain/verify/vite.terrain.config.mjs
 *   node src/game/world/terrain/verify/probe.mjs
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve('dist-terrain-verify');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = await new Promise((res) => {
  const s = createServer(async (req, resp) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, p);
    if (!existsSync(file)) return resp.writeHead(404).end('nf');
    resp.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    resp.end(await readFile(file));
  });
  s.listen(5201, () => res(s));
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 160, height: 90 } });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:5201/index.html');
await page.waitForFunction('window.__READY__ === true', null, { timeout: 180000 });

console.log('PROBE:', await page.evaluate('window.__TTEX__()'));
console.log('STATE:', await page.evaluate('window.__TPROBE__()'));
console.log('\n--- console ---');
for (const l of logs) console.log(l);

await browser.close();
server.close();
