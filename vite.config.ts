/// <reference types="vitest/config" />
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Only the version reaches the bundle (importing package.json would ship all of it).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

/** process.env.BUILD_NUMBER when it is a whole number, else '0' (a local or dev build). */
function buildNumber(): string {
  const n = (process.env.BUILD_NUMBER ?? '').trim()
  return /^\d+$/.test(n) ? n : '0'
}

// ---------------------------------------------------------------------------
// Bundled art (docs/SPEC.md, "Art and gallery", source 2): `virtual:bundled-art` is the sorted list
// of files under public/art/{setId}/{characterId}/ named tier-{1-5} or ending-{type} with a .webp,
// .png or .jpg extension, as paths relative to public/ ("art/afterhours/nova/tier-1.webp").
// src/art/resolve.ts reads it; nothing else is scanned or bundled. Names must be lower-case, like
// the ids, because the Android app's asset paths are case-sensitive. The dev server reloads when
// art is added or removed.

const ART_ID = /^[a-z0-9][a-z0-9-]*$/
const ART_FILE = /^(?:tier-[1-5]|ending-(?:good|open|polycule|bitter|hollow|sacrifice|reconciliation))\.(?:webp|png|jpe?g)$/

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Every bundled art file under `publicDir`/art, relative to `publicDir`, sorted. */
export function listBundledArt(publicDir: string): string[] {
  const root = join(publicDir, 'art')
  if (!publicDir || !existsSync(root)) return []
  const out: string[] = []
  for (const setId of readdirSync(root)) {
    const setDir = join(root, setId)
    if (!ART_ID.test(setId) || !isDir(setDir)) continue
    for (const characterId of readdirSync(setDir)) {
      const dir = join(setDir, characterId)
      if (!ART_ID.test(characterId) || !isDir(dir)) continue
      for (const file of readdirSync(dir)) {
        if (ART_FILE.test(file) && !isDir(join(dir, file))) out.push(`art/${setId}/${characterId}/${file}`)
      }
    }
  }
  return out.sort()
}

function bundledArtPlugin(): Plugin {
  const id = 'virtual:bundled-art'
  const resolvedId = `\0${id}`
  let publicDir = resolve('public')
  return {
    name: 'crushlab-bundled-art',
    configResolved(config) {
      publicDir = config.publicDir || ''
    },
    resolveId(source) {
      return source === id ? resolvedId : undefined
    },
    load(loadId) {
      if (loadId !== resolvedId) return undefined
      return `export default ${JSON.stringify(listBundledArt(publicDir))}\n`
    },
    configureServer(server: ViteDevServer) {
      if (!publicDir) return
      const artDir = join(publicDir, 'art')
      server.watcher.add(artDir)
      const onChange = (file: string) => {
        if (!resolve(file).startsWith(artDir)) return
        const graph = server.environments?.client?.moduleGraph
        const mod = graph?.getModuleById(resolvedId)
        if (graph && mod) graph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('add', onChange)
      server.watcher.on('unlink', onChange)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative base: works inside the Android app and under the GitHub Pages sub-path.
  base: './',
  define: {
    // CI sets BUILD_NUMBER to the workflow run number: the APK's versionCode and its release tag
    // (build-<n>) use the same number, and src/platform/updates.ts compares against it. 0 = dev.
    'import.meta.env.VITE_BUILD_NUMBER': JSON.stringify(buildNumber()),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
  },
  plugins: [
    react(),
    bundledArtPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      // src/platform/serviceWorker.ts registers sw.js on the web only (never in the Android app).
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/favicon-32.png', 'icons/apple-touch-icon-180.png'],
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
        // woff2 only: every browser that runs the app loads the woff2 fonts, so precaching the
        // .woff fallbacks would only cost mobile data on each install and update.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,webp,jpg,ico,webmanifest}'],
        // Bundled tier art isn't precached (it would all download on install); each picture is
        // cached the first time the gallery shows it.
        globIgnores: ['**/art/**'],
        runtimeCaching: [
          {
            urlPattern: /\/art\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\.(?:webp|png|jpe?g)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'crushlab-art', expiration: { maxEntries: 400 } },
          },
        ],
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
