// Build config for the water smoke harness only (see ./main.ts).
// Usage from the repo root:
//   npx vite build --config src/game/world/water/verify/vite.water.config.mjs
import { defineConfig } from 'vite';

export default defineConfig({
  root: '/home/user/spacenautica/src/game/world/water/verify',
  base: './',
  build: {
    outDir: '/home/user/spacenautica/dist-water',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
});
