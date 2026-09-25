// A stack of open overlays (sheets, dialogs) so Escape and the Android back button close only
// the top one. src/platform/backButton.ts calls closeTopOverlay() before navigating back.

interface OverlayEntry {
  id: number
  close: () => void
}

const stack: OverlayEntry[] = []
let nextId = 1

/** Register an open overlay. Returns an unregister function. */
export function pushOverlay(close: () => void): () => void {
  const entry = { id: nextId++, close }
  stack.push(entry)
  return () => {
    const i = stack.indexOf(entry)
    if (i >= 0) stack.splice(i, 1)
  }
}

/** True when this unregister handle belongs to the top overlay. */
export function isTopOverlay(close: () => void): boolean {
  return stack.length > 0 && stack[stack.length - 1].close === close
}

export function hasOpenOverlay(): boolean {
  return stack.length > 0
}

/** Close the top overlay if there is one. Returns true when something was closed. */
export function closeTopOverlay(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top.close()
  return true
}
