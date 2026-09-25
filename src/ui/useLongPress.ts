import { useCallback, useEffect, useRef } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'

export interface LongPressOptions {
  /** Hold time in ms (default 600). */
  ms?: number
  /** Called on a normal short press/click. */
  onClick?: () => void
  /** Pointer travel (px) that cancels the press, so scrolling doesn't trigger it. */
  moveTolerance?: number
}

export interface LongPressHandlers {
  onPointerDown: (e: PointerEvent) => void
  onPointerUp: (e: PointerEvent) => void
  onPointerMove: (e: PointerEvent) => void
  onPointerLeave: () => void
  onPointerCancel: () => void
  onKeyDown: (e: KeyboardEvent) => void
  onKeyUp: (e: KeyboardEvent) => void
  onClick: (e: MouseEvent) => void
  onContextMenu: (e: MouseEvent) => void
}

/**
 * Long press via pointer events (touch, pen, mouse). Keyboard fallback: holding Enter or Space
 * for the same time triggers it too. Spread the returned handlers on a focusable element and give
 * it the `long-press` class (no text selection or callout menu).
 */
export function useLongPress(onLongPress: () => void, opts: LongPressOptions = {}): LongPressHandlers {
  const { ms = 600, onClick, moveTolerance = 10 } = opts
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)
  const keyHeld = useRef(false)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const cb = useRef(onLongPress)
  useEffect(() => {
    cb.current = onLongPress
  })

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }, [])

  useEffect(() => clear, [clear])

  const start = useCallback(() => {
    clear()
    fired.current = false
    timer.current = setTimeout(() => {
      fired.current = true
      timer.current = null
      cb.current()
    }, ms)
  }, [clear, ms])

  return {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      start()
      origin.current = { x: e.clientX, y: e.clientY }
    },
    onPointerMove: (e) => {
      const o = origin.current
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > moveTolerance) clear()
    },
    onPointerUp: () => clear(),
    onPointerLeave: () => clear(),
    onPointerCancel: () => clear(),
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      // Prevent the native click; short presses are reported from onKeyUp instead.
      e.preventDefault()
      if (!e.repeat) {
        keyHeld.current = true
        start()
      }
    },
    onKeyUp: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      const wasPending = timer.current !== null
      keyHeld.current = false
      clear()
      if (wasPending && !fired.current) onClick?.()
      fired.current = false
    },
    onClick: (e) => {
      // Keyboard presses are reported from onKeyUp. Clicks without a key held (pointer, or a
      // screen reader's virtual click) land here.
      if (keyHeld.current) return
      if (fired.current) {
        e.preventDefault()
        fired.current = false
        return
      }
      onClick?.()
    },
    onContextMenu: (e) => e.preventDefault(),
  }
}
