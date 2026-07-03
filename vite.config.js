import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  define: {
    // CI stamps the Actions run number in; local dev builds get 0 (updater stays quiet)
    __BUILD_NUM__: JSON.stringify(Number(process.env.BUILD_NUM) || 0)
  },
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
