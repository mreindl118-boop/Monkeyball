// Importing a mod file from anywhere in the app (Settings, Character sets, the editor).

import { BUNDLED_SET_IDS, RESERVED_CHARACTER_IDS, RESERVED_SET_IDS } from '../../data/bundled'
import { importFile, type ImportResult } from '../../mods/pack'
import { CUSTOM_SET_ID, useRoster, type ImportOutcome, type PackReplacement } from '../../store/roster'
import { ensureRoster } from '../Hub/useRosterGame'
import { importReport, type ImportReport } from './setsModel'

/**
 * What the file picker offers. Many Android storage providers (and files saved without an
 * extension) report a .json file as octet-stream or plain text, and the APK's picker greys out
 * anything outside this list, so those are in it too. importFile() checks the content anyway.
 */
export const MOD_ACCEPT =
  '.json,.zip,application/json,application/zip,application/x-zip-compressed,application/octet-stream,text/plain'

/** Where an import got to: done, or waiting for the player to agree to replace a pack. */
export type ImportStep =
  | { kind: 'done'; report: ImportReport }
  | { kind: 'confirm'; replacement: PackReplacement; proceed: () => Promise<ImportReport> }

async function save(result: ImportResult): Promise<ImportStep> {
  const outcome = await useRoster.getState().importPack(result)
  if (outcome.confirm) {
    return {
      kind: 'confirm',
      replacement: outcome.confirm,
      proceed: async () => finish(result, await useRoster.getState().importPack(result, { replace: true })),
    }
  }
  return { kind: 'done', report: finish(result, outcome) }
}

function finish(result: ImportResult, outcome: ImportOutcome): ImportReport {
  const { sets, entries } = useRoster.getState()
  const setName = outcome.setId ? sets.find((s) => s.id === outcome.setId)?.name : undefined
  return importReport(result, outcome, setName, (id) => entries[id]?.character.name.trim() || id)
}

/**
 * Read a character or pack file, save what passes, and describe the outcome. Every id already
 * on the device is taken (a pack's own characters excepted, so it can be imported again), and so
 * are ids kept for sets that ship later: a clash leaves out that card, not the whole pack.
 */
export async function importModFile(file: File): Promise<ImportStep> {
  await ensureRoster()
  const { entries } = useRoster.getState()
  const all = Object.values(entries)
  const result = await importFile(file, file.name, {
    setCharacterIds: all.filter((e) => e.setId === CUSTOM_SET_ID).map((e) => e.character.id),
    existingIds: all.map((e) => e.character.id),
    packExistingIds: (setId) => all.filter((e) => e.setId !== setId || e.source === 'custom').map((e) => e.character.id),
    reservedIds: RESERVED_CHARACTER_IDS,
    existingSetIds: [...BUNDLED_SET_IDS, ...RESERVED_SET_IDS, CUSTOM_SET_ID],
  })
  return save(result)
}
