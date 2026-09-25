// crushLAB Android app: service worker kill switch (crushlab-apk-sw-killswitch).
// The APK serves every file from its own assets and doesn't use a service worker. Early builds
// (24 and 25) registered the web app's worker inside the app, and it kept serving that build's
// cached files after an upgrade. CI copies this file over dist/sw.js for the APK only: when the
// old worker checks for an update it gets this one, which takes over, deletes the cached files,
// removes itself and reloads the app so the installed version runs. The web app keeps its real
// service worker.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim()
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.registration.unregister()
      const windows = await self.clients.matchAll({ type: 'window' })
      await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => undefined)))
    })(),
  )
})
