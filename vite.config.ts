/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Relative base: works inside the Android app and under the GitHub Pages sub-path.
  base: './',
  define: {
    'import.meta.env.VITE_BUILD_NUMBER': JSON.stringify(process.env.BUILD_NUMBER ?? '0'),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'crushLAB',
        short_name: 'crushLAB',
        description: 'An adults-only dating sim where every character is played by an LLM.',
        theme_color: '#2A0F1F',
        background_color: '#2A0F1F',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,woff,svg,png,webp,jpg,ico,webmanifest}'],
        // Model and image calls always go to the network.
        navigateFallbackDenylist: [/^\/llm/, /^\/img/],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
