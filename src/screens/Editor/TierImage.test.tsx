// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtSlot, ResolvedArt } from '../../art/types'
import { TierImage } from './TierImage'

const state = vi.hoisted(() => ({ source: 'placeholder' as ResolvedArt['source'] }))
const engine = vi.hoisted(() => ({
  importImage: vi.fn(async () => {}),
  removeImported: vi.fn(async () => {}),
}))

vi.mock('../../art/resolve', () => ({
  useArt: (slot: ArtSlot | null) => ({
    art: slot ? { source: state.source, key: 'k', ...(state.source === 'placeholder' ? {} : { url: 'blob:mine' }) } : null,
    loading: false,
    refresh: () => {},
  }),
}))
vi.mock('../../art/generate', () => engine)

beforeEach(() => {
  state.source = 'placeholder'
  engine.importImage.mockClear()
  engine.removeImported.mockClear()
})

afterEach(cleanup)

describe("the editor's tier image", () => {
  it('adds the picked image under the tier slot', async () => {
    render(<TierImage characterId="mira" tier={3} title="Late set" name="Mira" />)
    expect(screen.getByText('No image')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tier 3 Add image' })).toBeTruthy()
    const file = new File(['png'], 'mira.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await waitFor(() => expect(engine.importImage).toHaveBeenCalledWith({ kind: 'tier', characterId: 'mira', tier: 3 }, file))
  })

  it("shows the player's image with a way to remove it; other art isn't theirs to remove", async () => {
    state.source = 'imported'
    const { unmount } = render(<TierImage characterId="mira" tier={3} title="Late set" name="Mira" />)
    expect(screen.getByRole('img', { name: 'Mira, Late set' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tier 3 Remove image' }))
    await waitFor(() => expect(engine.removeImported).toHaveBeenCalledWith({ kind: 'tier', characterId: 'mira', tier: 3 }))
    unmount()

    state.source = 'generated'
    render(<TierImage characterId="mira" tier={3} title="Late set" name="Mira" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tier 3 Remove image' })).toBeNull()
  })
})
