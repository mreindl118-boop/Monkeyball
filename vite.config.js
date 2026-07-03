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
    port: 5173,
    proxy: {
      // duel relay (run `npm run relay` alongside `npm run dev`)
      '/ws': { target: 'ws://localhost:8765', ws: true }
    }
  }
});
