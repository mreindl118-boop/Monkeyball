// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bundledEntry } from '../data/bundled'
import { Coaster } from './Coaster'
import { coasterLabel, coasterName } from './Coaster.model'

afterEach(cleanup)

const nova = bundledEntry('nova')!.character

describe('coasterName', () => {
  it('prints the first name, or a quoted nickname', () => {
    expect(coasterName('Nova Castellanos')).toBe('Nova')
    expect(coasterName('Roxanne "Rox" Delacroix')).toBe('Rox')
    expect(coasterName('Beatriz “Bea” Almeida')).toBe('Bea')
    expect(coasterName("Dara O'Brien")).toBe('Dara')
    expect(coasterName('  ', 'sam')).toBe('sam')
  })
})

describe('coasterLabel', () => {
  it('says everything the coaster shows', () => {
    expect(coasterLabel({ character: nova, affection: 45, discovered: 3, total: 17 })).toBe(
      'Nova Castellanos, stage Friend, 3 of 17 traits discovered',
    )
    expect(coasterLabel({ character: nova, affection: 0, discovered: 0, total: 17, friendRoute: true, jealous: true })).toBe(
      "Nova Castellanos, stage Stranger, 0 of 17 traits discovered, friend route, jealous: knows you're seeing someone and minds",
    )
  })
})

describe('Coaster', () => {
  it('is one button that opens the profile', () => {
    const onClick = vi.fn()
    render(<Coaster character={nova} affection={25} discovered={2} total={17} onClick={onClick} />)
    const button = screen.getByRole('button', { name: /^Nova Castellanos, stage Acquaintance/ })
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
    expect(button.textContent).toContain('Nova')
    expect(button.textContent).toContain('2/17 traits')
  })

  it('shows the friend and jealousy marks as text', () => {
    render(<Coaster character={nova} affection={0} discovered={0} total={17} friendRoute jealous />)
    const card = screen.getByRole('img', { name: /friend route, jealous/ })
    expect(card.textContent).toContain('Friends')
    expect(card.textContent).toContain('Jealous')
  })

  it('has no marks when neither applies', () => {
    render(<Coaster character={nova} affection={0} discovered={0} total={17} />)
    const card = screen.getByRole('img', { name: /Nova Castellanos/ })
    expect(card.textContent).not.toContain('Friends')
    expect(card.textContent).not.toContain('Jealous')
  })
})
