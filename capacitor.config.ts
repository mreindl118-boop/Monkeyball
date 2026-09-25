import type { CapacitorConfig } from '@capacitor/cli'

// Android is the primary target. See docs/ARCHITECTURE.md, "Android first". The android/ project
// is generated in CI (npx cap add android) and patched there, so everything the app needs from
// the native side is either here or in .github/workflows/build.yml.
const config: CapacitorConfig = {
  appId: 'app.crushlab.game',
  appName: 'crushLAB',
  webDir: 'dist',
  // Velvet behind the WebView, so no white flash before the first paint.
  backgroundColor: '#2A0F1F',
  server: {
    // http://localhost is still a secure context, and it lets the WebView reach
    // plain-http model servers on the LAN (a PC running Ollama or LM Studio).
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    // Edge to edge (Capacitor 8): Android 15+ always draws the app under the status and
    // navigation bars, and older versions do too with this setup. index.html sets
    // viewport-fit=cover, so on WebView 140+ the page is edge to edge and env(safe-area-inset-*)
    // holds the real bar sizes (src/ui/tokens.css pads screens with them). On older WebViews
    // Capacitor pads the WebView itself and the insets read 0, so content never sits under a bar.
    // 'css' also sets --safe-area-inset-* on <html> as a fallback. The soft keyboard pads the
    // WebView from the bottom (the IME inset), so the layout shrinks above it and
    // interactive-widget=resizes-content keeps the date input visible.
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      // Light icons on the velvet bars.
      style: 'DARK',
    },
    StatusBar: {
      // Light text and icons. Android 15+ ignores the color: the bar is transparent over the
      // velvet page. src/platform/statusBar.ts sets velvet again at launch for older versions.
      // overlaysWebView stays at its default (true) so every Android version lays the page out
      // the same way, edge to edge.
      style: 'DARK',
      backgroundColor: '#2A0F1F',
    },
    Keyboard: {
      // iOS only (Android resizes through SystemBars above): shrink the WebView so the focused
      // input stays above the keyboard. Keyboard.resizeOnFullScreen must stay unset with
      // SystemBars insets handling.
      resize: 'native',
      style: 'DARK',
    },
    CapacitorHttp: {
      // Don't patch window.fetch: native HTTP can't stream. src/platform/http.ts calls the plugin
      // directly, only when a WebView fetch to a model server fails (CORS, LAN).
      enabled: false,
    },
  },
}

export default config
