import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
  server: { port: 8000, host: true },
  preview: { port: 4173, host: true },
  resolve: { alias: { '@': '/src' } },
});
