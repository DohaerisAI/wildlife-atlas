import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // maplibre-gl v6 loads its worker as a sibling .mjs file; pre-bundling breaks that URL.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: {
    chunkSizeWarningLimit: 6000,
    rolldownOptions: { input: { index: resolve(import.meta.dirname, 'index.html'), atlas: resolve(import.meta.dirname, 'atlas.html'), map: resolve(import.meta.dirname, 'map.html') } },
  },
  test: { environment: 'node' },
});
