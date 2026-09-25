// @vitest-environment jsdom
// The full-screen viewer: moving between pictures (buttons, arrow keys, a swipe), the overlay
// stack (Escape and the Android back button), and the picture's actions.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtSlot, ResolvedArt } from '../../art/types'
import { bundledEntry } from '../../data/bundled'
import { closeTopOverlay, hasOpenOverlay } from '../../platform/overlays'
import { defaultSettings } from '../../store/defaults'
import { useSettings } from '../../store/settings'
import { Viewer, type ViewerItem } from './Viewer'

const state = vi.hoisted(() => ({
  sources: {} as Record<string, ResolvedArt['source']>,
  packs: {} as Record<string, string>,
  provider: true,
}))

const engine = vi.hoisted(() => ({
  setFavorite: vi.fn(async () => {}),
  generateCandidate: vi.fn(),
  acceptCandidate: vi.fn(async () => {}),
  importImage: vi.fn(async () => {}),
  removeImported: vi.fn(async () => {}),
  generateArt: vi.fn(async () => null),
}))

vi.mock('../../art/resolve', async () => {
  const { slotKey } = await import('../../art/types')
  return {
    useArt: (slot: ArtSlot | null) => {
      const key = slot ? slotKey(slot) : ''
      const source = state.sources[key] ?? 'placeholder'
      const art: ResolvedArt = { source, key, ...(source === 'placeholder' ? {} : { url: `blob:${key}` }), ...(state.packs[key] ? { pack: state.packs[key] } : {}) }
      return { art: slot ? art : null, loading: false, refresh: () => {} }
    },
  }
})

vi.mock('../../art/generate', () => ({
  ...engine,
  useArtJob: () => ({ generating: false }),
}))

vi.mock('../../art/providers', () => ({
  providerFor: () => (state.provider ? { id: 'a1111' } : null),
}))

const nova = bundledEntry('nova')!.character

function items(): ViewerItem[] {
  return ([1, 2, 3] as const).map((tier) => {
    const slot: ArtSlot = { kind: 'tier', characterId: 'nova', tier }
    const entry = nova.gallery.find((g) => g.tier === tier)!
    return { slot, key: `nova:tier-${tier}`, character: nova, title: entry.title, kicker: `Tier ${tier}`, scene: entry.scene }
  })
}

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState(true)
  if (!open) return <p>closed</p>
  return (
    <Viewer
      items={items()}
      index={index}
      onIndex={setIndex}
      favorites={new Set()}
      onClose={() => {
        setOpen(false)
        onClose()
      }}
    />
  )
}

beforeEach(() => {
  state.sources = { 'nova:tier-1': 'generated', 'nova:tier-2': 'imported', 'nova:tier-3': 'placeholder' }
  state.packs = {}
  state.provider = true
  for (const fn of Object.values(engine)) fn.mockClear()
  useSettings.setState({ settings: defaultSettings(), loaded: true })
})

afterEach(cleanup)

describe('Viewer', () => {
  it('moves with Previous and Next (no arrow glyphs), and with the arrow keys', () => {
    render(<Harness />)
    expect(screen.getByRole('dialog', { name: 'Nova Castellanos, Behind the decks' })).toBeTruthy()
    expect(screen.getByText('1 of 3')).toBeTruthy()
    const prev = screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('2 of 3')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Afterhours' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' })
    expect(screen.getByText('3 of 3')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' })
    expect(screen.getByText('2 of 3')).toBeTruthy()
    for (const b of screen.getAllByRole('button')) expect(b.textContent ?? '').not.toMatch(/[←→‹›<>]/)
  })

  it('swipes to the next picture', () => {
    const { container } = render(<Harness />)
    const stage = container.ownerDocument.querySelector('[class*="stage"]') as HTMLElement
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 300, clientY: 200, button: 0, pointerType: 'touch' })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 220, clientY: 205, pointerType: 'touch' })
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 160, clientY: 206, pointerType: 'touch' })
    expect(screen.getByText('2 of 3')).toBeTruthy()
  })

  it('registers as an overlay: the back button closes it', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    expect(hasOpenOverlay()).toBe(true)
    act(() => {
      closeTopOverlay()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(hasOpenOverlay()).toBe(false)
  })

  it('offers each action where it applies', () => {
    render(<Harness />)
    // Generated art with a provider: Regenerate; no Remove my image.
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove my image' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Save image' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use my own image' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    // The player's own image: Remove my image, no Regenerate.
    expect(screen.getByRole('button', { name: 'Remove my image' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    // The placeholder: nothing to save; Generate art with a provider.
    expect(screen.queryByRole('button', { name: 'Save image' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Generate art' })).toBeTruthy()
  })

  it('has no Regenerate without a provider', () => {
    state.provider = false
    render(<Harness />)
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull()
  })

  it('toggles a favorite', async () => {
    render(<Harness />)
    const fav = screen.getByRole('button', { name: 'Favorite' })
    expect(fav.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(fav)
    expect(fav.getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(engine.setFavorite).toHaveBeenCalledWith({ kind: 'tier', characterId: 'nova', tier: 1 }, true))
  })

  it('Regenerate keeps the current picture until the new one is kept', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:candidate')
    URL.revokeObjectURL = vi.fn()
    const candidate = { blob: new Blob(['x'], { type: 'image/png' }), prompt: 'p', seed: 7 }
    engine.generateCandidate.mockResolvedValue(candidate)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await screen.findByRole('button', { name: 'Keep new' })
    expect(screen.getByText('Current')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Nova Castellanos, Behind the decks, the new picture' })).toBeTruthy()
    expect(engine.acceptCandidate).not.toHaveBeenCalled()

    // Keep current: nothing is saved and the candidate's URL is let go.
    fireEvent.click(screen.getByRole('button', { name: 'Keep current' }))
    expect(engine.acceptCandidate).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:candidate')

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Keep new' }))
    await waitFor(() => expect(engine.acceptCandidate).toHaveBeenCalledWith({ kind: 'tier', characterId: 'nova', tier: 1 }, candidate))
  })

  it("labels pack art and offers no Remove my image for it", () => {
    state.packs = { 'nova:tier-2': 'moonlight' }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Comes with the pack')).toBeTruthy()
    expect(screen.queryByText('Your image')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove my image' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Use my own image' })).toBeTruthy()
  })

  it("keeps Grok Imagine's rewrite of the prompt with the new picture", async () => {
    URL.createObjectURL = vi.fn(() => 'blob:candidate')
    URL.revokeObjectURL = vi.fn()
    const candidate = { blob: new Blob(['x'], { type: 'image/png' }), prompt: 'p', seed: 7, revisedPrompt: 'what xAI painted' }
    engine.generateCandidate.mockResolvedValue(candidate)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Keep new' }))
    await waitFor(() => expect(engine.acceptCandidate).toHaveBeenCalledWith({ kind: 'tier', characterId: 'nova', tier: 1 }, candidate))
  })

  it("lets go of the new picture's URL when the viewer goes away mid-comparison", async () => {
    URL.createObjectURL = vi.fn(() => 'blob:candidate')
    URL.revokeObjectURL = vi.fn()
    engine.generateCandidate.mockResolvedValue({ blob: new Blob(['x'], { type: 'image/png' }), prompt: 'p', seed: 7 })
    const { unmount } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await screen.findByRole('button', { name: 'Keep new' })
    unmount()
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:candidate')
  })

  it("imports the player's own image for the slot", async () => {
    render(<Harness />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['png'], 'me.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(engine.importImage).toHaveBeenCalledWith({ kind: 'tier', characterId: 'nova', tier: 1 }, file))
  })
})
