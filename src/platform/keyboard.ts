// The soft keyboard in the Android app. The layout already shrinks above the keyboard (SystemBars
// pads the WebView by the keyboard's height, and index.html asks for resizes-content); this keeps
// the focused field in view once the keyboard is up, and marks <html data-keyboard="open"> so
// screens can hide bottom chrome while the player types. src/ui/tokens.css uses it: a bottom-pinned
// bar marked data-keyboard-static stops sticking, and html's scroll-padding-bottom keeps a field
// clear of such a bar when it is scrolled into view.

import { hasPlugin, isNative } from './platform'

function setOpen(open: boolean) {
  if (typeof document === 'undefined') return
  if (open) document.documentElement.dataset.keyboard = 'open'
  else delete document.documentElement.dataset.keyboard
}

/** Scroll the focused text field into view (after the keyboard resized the page). */
export function revealFocusedField(): void {
  if (typeof document === 'undefined') return
  const el = document.activeElement
  if (!(el instanceof HTMLElement)) return
  if (!el.matches('input, textarea, select, [contenteditable="true"]')) return
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

/** Follow the keyboard in the app. Returns a function that stops. A no-op on the web. */
export async function bindKeyboard(): Promise<() => void> {
  if (!isNative() || !hasPlugin('Keyboard')) return () => {}
  const { Keyboard } = await import('@capacitor/keyboard')
  const handles = await Promise.all([
    Keyboard.addListener('keyboardDidShow', () => {
      setOpen(true)
      revealFocusedField()
    }),
    Keyboard.addListener('keyboardWillHide', () => setOpen(false)),
  ])
  return () => {
    setOpen(false)
    for (const h of handles) void h.remove()
  }
}
