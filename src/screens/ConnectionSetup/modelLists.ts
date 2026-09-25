import { useEffect } from 'react'
import { create } from 'zustand'
import { listModels } from '../../llm'
import { slotFor } from '../../llm/routes'
import { useSettings } from '../../store/settings'
import type { ConnectionPreset } from '../../types'
import { slotSignature, slotUsable } from './connectionHelpers'

// Model lists per preset, shared by the provider cards and the role pickers. Each list belongs to
// the address and key it was fetched with; a changed key or URL hides it until it's listed again.
// In memory only. Ready marks (a passed Test connection) work the same way.

interface Listed {
  sig: string
  ids: string[]
}

interface ModelListsState {
  lists: Partial<Record<ConnectionPreset, Listed>>
  ready: Partial<Record<ConnectionPreset, string>>
  put: (preset: ConnectionPreset, sig: string, ids: string[]) => void
  markReady: (preset: ConnectionPreset, sig: string | null) => void
}

export const useModelLists = create<ModelListsState>()((set) => ({
  lists: {},
  ready: {},
  put: (preset, sig, ids) => set((s) => ({ lists: { ...s.lists, [preset]: { sig, ids } } })),
  markReady: (preset, sig) =>
    set((s) => {
      const ready = { ...s.ready }
      if (sig) ready[preset] = sig
      else delete ready[preset]
      return { ready }
    }),
}))

function useSignature(preset: ConnectionPreset): string {
  return useSettings((s) => slotSignature(slotFor(s.settings.connection, preset)))
}

const EMPTY: string[] = []

/** The listed models for a preset's current address and key ([] until listed). */
export function usePresetModels(preset: ConnectionPreset): string[] {
  const sig = useSignature(preset)
  const listed = useModelLists((s) => s.lists[preset])
  return listed && listed.sig === sig ? listed.ids : EMPTY
}

/** True once a Test connection passed for the preset's current address and key. */
export function usePresetReady(preset: ConnectionPreset): boolean {
  const sig = useSignature(preset)
  return useModelLists((s) => s.ready[preset] === sig)
}

/**
 * Quietly list a preset's models when it has what it needs (an address, and a key when one is
 * required) and nothing is listed for its current address and key yet.
 */
export function useAutoList(preset: ConnectionPreset, enabled = true): void {
  const sig = useSignature(preset)
  const usable = useSettings((s) => slotUsable(s.settings.connection, preset))
  const have = useModelLists((s) => s.lists[preset]?.sig === sig)
  useEffect(() => {
    if (!enabled || !usable || have) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      const conn = useSettings.getState().settings.connection
      listModels(conn, preset, { signal: ctrl.signal, timeoutMs: 8000 })
        .then((ids) => {
          if (!ctrl.signal.aborted) useModelLists.getState().put(preset, sig, ids)
        })
        .catch(() => undefined)
    }, 600)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [enabled, usable, have, preset, sig])
}

/** The listed models for a preset right now, outside React (event handlers). */
export function listedNow(preset: ConnectionPreset): string[] {
  const sig = slotSignature(slotFor(useSettings.getState().settings.connection, preset))
  const listed = useModelLists.getState().lists[preset]
  return listed && listed.sig === sig ? listed.ids : []
}
