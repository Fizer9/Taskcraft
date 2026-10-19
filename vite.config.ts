import { defineConfig } from 'vite';

// base: './' — чтобы сборка работала на GitHub Pages по адресу /<repo>/
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 7000 },
});
