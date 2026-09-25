// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bundledEntry } from '../data/bundled'
import { Portrait } from './Portrait'
import { portraitAccent, tierOf } from './Portrait.model'

afterEach(cleanup)

const nova = bundledEntry('nova')!.character

describe('helpers', () => {
  it('uses the card accent when it is a hex color', () => {
    expect(portraitAccent('#3FB8AF')).toBe('#3FB8AF')
    expect(portraitAccent('teal')).toBe('#E0245E')
    expect(portraitAccent(undefined)).toBe('#E0245E')
  })

  it('finds a tier by number', () => {
    expect(tierOf(nova, 3)?.title).toBe('Rain check')
    expect(tierOf(nova, undefined)).toBeUndefined()
  })
})

describe('Portrait placeholder', () => {
  it('is a named image without a tier', () => {
    render(<Portrait character={nova} />)
    expect(screen.getByRole('img', { name: 'Nova Castellanos. Placeholder art.' })).toBeTruthy()
  })

  it('small shows art only, named with the tier title', () => {
    render(<Portrait character={nova} tier={2} size="small" />)
    expect(screen.getByRole('img', { name: 'Nova Castellanos, Afterhours. Placeholder art.' })).toBeTruthy()
  })

  it('medium captions the tier title, large adds the scene', () => {
    const { container, rerender } = render(<Portrait character={nova} tier={1} size="medium" />)
    expect(container.querySelector('figcaption')?.textContent).toContain('Behind the decks')
    expect(container.textContent).not.toContain('one headphone cup on')
    rerender(<Portrait character={nova} tier={1} size="large" />)
    expect(container.textContent).toContain('one headphone cup on')
  })
})
