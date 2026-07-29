// Build config for the sky smoke harness only (see ./main.ts).
// Usage from the repo root:
//   npx vite build --config src/game/world/sky/verify/vite.sky.config.mjs
import { defineConfig } from 'vite';

export default defineConfig({
  root: '/home/user/spacenautica/src/game/world/sky/verify',
  base: './',
  build: {
    outDir: '/home/user/spacenautica/dist-skyverify',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
});
