// Exports from the sets screen and the editor. Every file goes through saveFile() (a download on
// the web, the share sheet in the Android app).

import { getImage } from '../../db/repo'
import { characterFileName, exportCharacterJson, exportPackZip, packFileName, type PackArt } from '../../mods/pack'
import { FileSaveUnavailableError, saveFile } from '../../platform/files'
import type { Character, SetManifest, TierNumber } from '../../types'
import { toast } from '../../ui/toastStore'

const TIERS: TierNumber[] = [1, 2, 3, 4, 5]

/** Imported tier art for these characters, to ride along in a pack. Missing storage means none. */
export async function collectPackArt(ids: readonly string[]): Promise<PackArt[]> {
  const out: PackArt[] = []
  for (const characterId of ids) {
    for (const tier of TIERS) {
      try {
        // The player's own image, else the art the pack came with.
        const key = `${characterId}:tier-${tier}`
        const own = await getImage(key)
        const img = own?.source === 'imported' && own.blob ? own : await getImage(`${key}#pack`)
        if (img?.source === 'imported' && img.blob) out.push({ characterId, tier, blob: img.blob })
      } catch {
        // No storage: export without art.
      }
    }
  }
  return out
}

function reportError(e: unknown) {
  if (e instanceof FileSaveUnavailableError) {
    toast("This device can't save files from crushLAB.", 'info', 6000)
  } else {
    toast(`Couldn't export: ${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

export interface ExportOptions {
  /** A set or card that ships with crushLAB: the file is a template, since every copy of the app has these ids. */
  bundled?: boolean
}

/** Save a set as a .zip pack (manifest, cards, imported art). Resolves true when handed over. */
export async function exportSetZip(manifest: SetManifest, characters: readonly Character[], opts: ExportOptions = {}): Promise<boolean> {
  try {
    const art = await collectPackArt(characters.map((c) => c.id))
    const blob = await exportPackZip(manifest, characters, art)
    const result = await saveFile(blob, packFileName(manifest), 'application/zip')
    if (result === 'cancelled') return false
    const name = manifest.name || 'The pack'
    if (opts.bundled) {
      toast(
        `${name} is saved as a template. Every copy of crushLAB already has it, so change the set id and the character ids before importing it anywhere.`,
        'info',
        9000,
      )
    } else {
      toast(`${name} is ready to share.`, 'success')
    }
    return true
  } catch (e) {
    reportError(e)
    return false
  }
}

/** Save one character as a .json file. */
export async function exportCharacterFile(character: Character, opts: ExportOptions = {}): Promise<boolean> {
  try {
    const result = await saveFile(exportCharacterJson(character), characterFileName(character), 'application/json')
    if (result === 'cancelled') return false
    const name = character.name || character.id
    if (opts.bundled) {
      toast(`${name} is saved as a template. crushLAB already has ${name}, so change the id before importing the file.`, 'info', 9000)
    } else if (character.partners?.length) {
      // A card travels alone: on import, partners who aren't there are left off it.
      toast(`${name} is ready to share. Their partners and exes aren't in the file; Export as .zip pack takes them along.`, 'success', 8000)
    } else {
      toast(`${name} is ready to share.`, 'success')
    }
    return true
  } catch (e) {
    reportError(e)
    return false
  }
}
