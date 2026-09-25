// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LipstickStamps } from './LipstickStamps'
import { STAMP_COUNT, stampsFilled } from './LipstickStamps.model'

afterEach(cleanup)

describe('stampsFilled', () => {
  it('inks one stamp per stage reached', () => {
    expect(STAMP_COUNT).toBe(6)
    expect(stampsFilled('stranger')).toBe(1)
    expect(stampsFilled('friend')).toBe(3)
    expect(stampsFilled('won')).toBe(6)
  })
})

describe('LipstickStamps', () => {
  it('names the stage for assistive tech', () => {
    render(<LipstickStamps stage="crush" />)
    expect(screen.getByRole('img', { name: 'Stage: Crush, 4 of 6' })).toBeTruthy()
  })

  it('shows the label when asked', () => {
    render(<LipstickStamps stage="lover" showLabel />)
    expect(screen.getByText('Lover')).toBeTruthy()
  })

  it('presses only the newly reached stamps when the stage goes up', () => {
    const { container, rerender } = render(<LipstickStamps stage="acquaintance" />)
    const pressed = () => container.querySelectorAll('svg[class*="press"]').length
    expect(pressed()).toBe(0)
    rerender(<LipstickStamps stage="crush" />)
    expect(pressed()).toBe(2)
    rerender(<LipstickStamps stage="friend" />)
    // Going down doesn't press anything new.
    expect(container.querySelectorAll('svg').length).toBe(6)
  })

  it("doesn't press with animate off", () => {
    const { container, rerender } = render(<LipstickStamps stage="stranger" animate={false} />)
    rerender(<LipstickStamps stage="won" animate={false} />)
    expect(container.querySelectorAll('svg[class*="press"]').length).toBe(0)
  })
})
