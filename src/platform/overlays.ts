// The overlay stack the Android back button closes first. The registry itself lives in
// src/ui/overlays.ts (Sheet, and ConfirmDialog through Sheet, register a close callback while
// open, and Escape uses it to close only the top one); the platform layer reads it from here.
//
// Anything else that should swallow one back press (a screen asking "leave the date?", say) can
// register the same way: const unregister = pushOverlay(() => askToLeave()), and unregister when
// it no longer applies.

export { closeTopOverlay, hasOpenOverlay, isTopOverlay, pushOverlay } from '../ui/overlays'
