/**
 * Dev-only build config for the material preview page. It lives beside the page
 * it builds so that `vite` resolves from the project's node_modules. The game
 * build never uses it — the game entry is the repository-root index.html.
 *
 *   npx vite build --config src/game/assets/preview/vite.preview.config.mjs
 *   npx serve dist-matpreview   # then open src/game/assets/preview/index.html
 */
import { defineConfig } from 'vite';

export default defineConfig({
  root: '/home/user/spacenautica',
  base: './',
  build: {
    outDir: 'dist-matpreview',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: { input: '/home/user/spacenautica/src/game/assets/preview/index.html' },
  },
});
