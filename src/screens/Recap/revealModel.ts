// The recap's unlock reveal: which prints develop (tiers unlocked on this date, and the ending's art
// on an epilogue's recap), in the order they sit on the screen, and which have already played.
// Pure, apart from markArtShown at the bottom.

import { slotKey, type ArtSlot } from '../../art/types'
import { db } from '../../db/db'
import type { Character, DateRecord, TierNumber } from '../../types'
import { endingArtScene, endingArtTitle, tierScene, tierTitle } from '../Gallery/galleryModel'

export interface RevealItem {
  slot: ArtSlot
  key: string
  title: string
  /** "Tier 3"; empty for the ending (its panel already says "Your ending"). */
  kicker: string
  scene: string
  /** Where it shows on the recap. */
  place: 'ending' | 'tiers'
}

/**
 * The prints to develop on this recap, in screen order: the ending's art first (it sits near the
 * top on an epilogue's recap), then the tiers unlocked on this date, lowest first.
 */
export function revealItems(
  character: Pick<Character, 'id' | 'gallery' | 'endings'>,
  record: Pick<DateRecord, 'kind' | 'endingType'>,
  tiers: readonly TierNumber[] | undefined,
): RevealItem[] {
  const out: RevealItem[] = []
  if (record.kind === 'epilogue' && record.endingType) {
    const slot: ArtSlot = { kind: 'ending', characterId: character.id, ending: record.endingType }
    out.push({
      slot,
      key: slotKey(slot),
      title: endingArtTitle(character, record.endingType),
      kicker: '',
      scene: endingArtScene(character, record.endingType),
      place: 'ending',
    })
  }
  for (const tier of [...new Set(tiers ?? [])].filter((t) => t >= 1 && t <= 5).sort((a, b) => a - b)) {
    const slot: ArtSlot = { kind: 'tier', characterId: character.id, tier }
    out.push({ slot, key: slotKey(slot), title: tierTitle(character, tier), kicker: `Tier ${tier}`, scene: tierScene(character, tier), place: 'tiers' })
  }
  return out
}

/** Reveals already played for a date: stored on the record, plus this session's. */
export function shownFor(record: Pick<DateRecord, 'id' | 'artShown'>, session: ReadonlySet<string>): Set<string> {
  const out = new Set(record.artShown ?? [])
  const prefix = `${record.id ?? 'unsaved'}|`
  for (const k of session) if (k.startsWith(prefix)) out.add(k.slice(prefix.length))
  return out
}

/** The session-set key for a reveal on a date. */
export function sessionKey(dateId: number | undefined, key: string): string {
  return `${dateId ?? 'unsaved'}|${key}`
}

/** Reveals played this session (a record read back from memory may not have them yet). */
export const sessionShown = new Set<string>()

/** Remember on the date's record that these reveals have played (storage failures are ignored). */
export async function markArtShown(dateId: number | undefined, keys: readonly string[]): Promise<void> {
  for (const k of keys) sessionShown.add(sessionKey(dateId, k))
  if (dateId == null || !keys.length) return
  try {
    await db.transaction('rw', db.dates, async () => {
      const rec = await db.dates.get(dateId)
      if (!rec) return
      const shown = [...new Set([...(rec.artShown ?? []), ...keys])]
      await db.dates.update(dateId, { artShown: shown })
    })
  } catch {
    // Without storage the session set keeps it from replaying until the app closes.
  }
}
