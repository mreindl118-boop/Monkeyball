import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsInlineLimit: 100000000
  },
  server: {
    host: true,
    port: 5173
  }
});
