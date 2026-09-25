/** The app version (package.json, injected at build time by vite.config.ts), shown in Settings and the debug panel. */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.0.0'
