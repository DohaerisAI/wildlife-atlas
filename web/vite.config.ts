import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 6000,
    rolldownOptions: { input: { index: resolve(import.meta.dirname, 'index.html'), atlas: resolve(import.meta.dirname, 'atlas.html'), engine: resolve(import.meta.dirname, 'engine.html') } },
  },
  test: { environment: 'node' },
});
