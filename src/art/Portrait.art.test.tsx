// @vitest-environment jsdom
// The portrait with real art behind it: the art comes from useArt (mocked here), the placeholder
// stays the fallback, and a portrait without a tier shows the highest one unlocked.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bundledEntry } from '../data/bundled'
import { newRelationship } from '../engine/relationship'
import { useGame } from '../store/game'
import type { TierNumber } from '../types'
import { Portrait } from './Portrait'
import { highestUnlocked, portraitAlt } from './Portrait.model'
import type { ArtSlot, ResolvedArt } from './types'

const art = vi.hoisted(() => ({ source: 'generated' as ResolvedArt['source'], asked: [] as (string | null)[] }))

vi.mock('./resolve', async () => {
  const { slotKey } = await import('./types')
  return {
    useArt: (slot: ArtSlot | null) => {
      const key = slot ? slotKey(slot) : null
      art.asked.push(key)
      if (!key) return { art: null, loading: false, refresh: () => {} }
      const url = art.source === 'placeholder' ? undefined : `blob:${key}`
      return { art: { source: art.source, key, ...(url ? { url } : {}) }, loading: false, refresh: () => {} }
    },
  }
})

const nova = bundledEntry('nova')!.character

beforeEach(() => {
  art.source = 'generated'
  art.asked = []
})

afterEach(() => {
  cleanup()
  useGame.setState({ relationships: {} })
})

describe('Portrait with art', () => {
  it('shows the tier art, named "{name}, {tier title}"', () => {
    const { container } = render(<Portrait character={nova} tier={3} size="small" />)
    const img = screen.getByRole('img', { name: 'Nova Castellanos, Rain check' })
    expect(img).toBeTruthy()
    const pic = container.querySelector('img')!
    expect(pic.getAttribute('src')).toBe('blob:nova:tier-3')
    expect(pic.getAttribute('loading')).toBe('lazy')
    expect(pic.getAttribute('alt')).toBe('Nova Castellanos, Rain check')
    expect(container.querySelector('figure')?.dataset.source).toBe('generated')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('keeps the placeholder when there is no art, or the image fails', () => {
    art.source = 'placeholder'
    const { container, unmount } = render(<Portrait character={nova} tier={2} size="small" />)
    expect(screen.getByRole('img', { name: 'Nova Castellanos, Afterhours. Placeholder art.' })).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
    unmount()

    art.source = 'bundled'
    const second = render(<Portrait character={nova} tier={2} size="small" />)
    fireEvent.error(second.container.querySelector('img')!)
    expect(second.container.querySelector('img')).toBeNull()
    expect(screen.getByRole('img', { name: 'Nova Castellanos, Afterhours. Placeholder art.' })).toBeTruthy()
  })

  it('without a tier, shows the highest one unlocked', () => {
    useGame.setState({ relationships: { nova: { ...newRelationship('nova'), tiersUnlocked: [1, 2] } } })
    const { container } = render(<Portrait character={nova} size="small" shape="round" />)
    expect(container.querySelector('figure')?.dataset.tier).toBe('2')
    expect(screen.getByRole('img', { name: 'Nova Castellanos, Afterhours' })).toBeTruthy()
    expect(art.asked).toContain('nova:tier-2')
  })

  it('without a tier and nothing unlocked, is the plain placeholder and looks nothing up', () => {
    render(<Portrait character={nova} size="small" />)
    expect(screen.getByRole('img', { name: 'Nova Castellanos. Placeholder art.' })).toBeTruthy()
    expect(art.asked.every((k) => k === null)).toBe(true)
  })

  it('shows an ending slot with its own caption', () => {
    const slot: ArtSlot = { kind: 'ending', characterId: 'nova', ending: 'good' }
    const { container } = render(<Portrait character={nova} slot={slot} caption={{ title: 'The good ending' }} size="medium" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:nova:ending-good')
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('Nova Castellanos, The good ending')
    expect(container.querySelector('figcaption')?.textContent).toContain('The good ending')
  })

  it('uses art handed in by the parent without looking it up', () => {
    render(<Portrait character={nova} tier={1} size="small" art={{ source: 'imported', key: 'nova:tier-1', url: 'blob:mine' }} />)
    expect(screen.getByRole('img', { name: 'Nova Castellanos, Behind the decks' }).getAttribute('src')).toBe('blob:mine')
    expect(art.asked.every((k) => k === null)).toBe(true)
  })
})

describe('Portrait helpers', () => {
  it('finds the highest unlocked tier', () => {
    expect(highestUnlocked({ tiersUnlocked: [2, 1, 4] as TierNumber[] })).toBe(4)
    expect(highestUnlocked({ tiersUnlocked: [] })).toBeUndefined()
    expect(highestUnlocked(undefined)).toBeUndefined()
  })

  it('names art and placeholders', () => {
    expect(portraitAlt('Nova', 'Encore', false)).toBe('Nova, Encore')
    expect(portraitAlt('Nova', '', true)).toBe('Nova. Placeholder art.')
  })
})
