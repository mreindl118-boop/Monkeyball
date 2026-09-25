import { create } from 'zustand'

export type ToastTone = 'info' | 'success' | 'error'

/** An optional button on a toast (e.g. Reload on "A new version is ready"). */
export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastItem {
  id: number
  text: string
  tone: ToastTone
  action?: ToastAction
}

interface ToastState {
  toasts: ToastItem[]
  /** `ms` 0 keeps the toast until it is dismissed or its action runs. */
  show: (text: string, tone?: ToastTone, ms?: number, action?: ToastAction) => number
  dismiss: (id: number) => void
}

let seq = 0

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  show: (text, tone = 'info', ms = 3600, action) => {
    const id = ++seq
    // Keep at most three on screen.
    set({ toasts: [...get().toasts.slice(-2), { id, text, tone, ...(action ? { action } : {}) }] })
    if (ms > 0) setTimeout(() => get().dismiss(id), ms)
    return id
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

/** Show a short message at the bottom of the screen. */
export function toast(text: string, tone: ToastTone = 'info', ms?: number, action?: ToastAction): number {
  return useToasts.getState().show(text, tone, ms, action)
}

const FLASH_KEY = 'crushlab:flash'

/** Queue a toast for the next page load (used before a deliberate reload). */
export function flashNextLoad(text: string, tone: ToastTone = 'success'): void {
  try {
    sessionStorage.setItem(FLASH_KEY, JSON.stringify({ text, tone }))
  } catch {
    // Storage unavailable: the message is simply skipped.
  }
}

/** Show and clear a queued flash message, if any. Call once at boot. */
export function consumeFlash(): void {
  try {
    const raw = sessionStorage.getItem(FLASH_KEY)
    if (!raw) return
    sessionStorage.removeItem(FLASH_KEY)
    const { text, tone } = JSON.parse(raw) as { text: string; tone: ToastTone }
    if (text) toast(text, tone)
  } catch {
    // Ignore malformed or unavailable storage.
  }
}
