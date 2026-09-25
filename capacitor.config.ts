import type { CapacitorConfig } from '@capacitor/cli'

// Android is the primary target. See docs/ARCHITECTURE.md, "Android first".
const config: CapacitorConfig = {
  appId: 'app.crushlab.game',
  appName: 'crushLAB',
  webDir: 'dist',
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
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
    },
  },
}

export default config
