// Build config for the terrain smoke harness only (see ./main.ts).
// Usage from the repo root:
//   npx vite build --config src/game/world/terrain/verify/vite.terrain.config.mjs
import { defineConfig } from 'vite';

export default defineConfig({
  root: '/home/user/spacenautica/src/game/world/terrain/verify',
  base: './',
  build: {
    outDir: '/home/user/spacenautica/dist-terrain-verify',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
});
