import { describe, expect, it } from 'vitest'
import { BUNDLED_SETS } from '../../data/bundled'
import type { HeardRumor, Rumor } from '../../types'
import { RUMOR_WARNING, rumorsAbout } from './profileModel'

const rumors: Rumor[] = BUNDLED_SETS.flatMap((s) => s.rumors ?? [])
const names = { jules: 'Jules Moreau', imani: 'Imani Brooks', rook: 'Rook Adeyemi' }

const heard = (rumorId: string, at: number, heardFrom = ''): HeardRumor => ({ rumorId, heardFrom, at, relayedTo: [] })

describe('rumors heard about a character', () => {
  it('lists rumors about them, newest first, with who told you', () => {
    const rows = rumorsAbout('nova', [heard('breakup-kai-side', 1, 'jules'), heard('nova-to-berlin', 5, 'rook'), heard('staff-party', 9, 'cass')], rumors, names)
    expect(rows.map((r) => r.id)).toEqual(['nova-to-berlin', 'breakup-kai-side'])
    expect(rows[0]).toMatchObject({ teller: 'Rook', tellerId: 'rook' })
    expect(rows[0].text).toMatch(/Berlin/)
  })

  it('falls back to the rumor’s teller, and skips rumors no manifest has', () => {
    const rows = rumorsAbout('kai', [heard('breakup-nova-side', 1), heard('not-a-rumor', 2)], rumors, names)
    expect(rows).toHaveLength(1)
    expect(rows[0].teller).toBe('Imani')
  })

  it('warns that rumors can be wrong', () => {
    expect(RUMOR_WARNING).toMatch(/^Rumors can be wrong\./)
  })
})
