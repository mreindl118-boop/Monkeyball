/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Only the version reaches the bundle (importing package.json would ship all of it).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// https://vite.dev/config/
export default defineConfig({
  // Relative base: works inside the Android app and under the GitHub Pages sub-path.
  base: './',
  define: {
    'import.meta.env.VITE_BUILD_NUMBER': JSON.stringify(process.env.BUILD_NUMBER ?? '0'),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
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
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
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
