// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Meter } from './Meter'
import { meterValue } from './Meter.model'

afterEach(cleanup)

describe('meterValue', () => {
  it('clamps and rounds', () => {
    expect(meterValue(42.4)).toBe(42)
    expect(meterValue(-5)).toBe(0)
    expect(meterValue(130)).toBe(100)
    expect(meterValue(Number.NaN)).toBe(0)
  })
})

describe('Meter', () => {
  it('is a labelled meter with its value as text', () => {
    render(<Meter kind="affection" value={42} />)
    const meter = screen.getByRole('meter', { name: 'Affection' })
    expect(meter.getAttribute('aria-valuenow')).toBe('42')
    expect(meter.getAttribute('aria-valuetext')).toBe('42 of 100')
    expect(screen.getByText('42')).toBeTruthy()
  })

  it('describes a cap', () => {
    render(<Meter kind="affection" value={50} cap={59} capNote="Friend route: stops at 59." />)
    const meter = screen.getByRole('meter', { name: 'Affection' })
    expect(meter.getAttribute('aria-valuetext')).toBe('50 of 100, capped at 59')
    expect(screen.getByText('Friend route: stops at 59.')).toBeTruthy()
  })

  it('labels trust', () => {
    render(<Meter kind="trust" value={7} />)
    expect(screen.getByRole('meter', { name: 'Trust' })).toBeTruthy()
  })
})
