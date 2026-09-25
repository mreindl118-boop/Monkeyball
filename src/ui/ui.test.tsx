// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Field } from './Field'
import { HeatControl } from './HeatControl'
import { MaskedInput, TextInput } from './Inputs'
import { clampStep } from './numbers'
import { closeTopOverlay, hasOpenOverlay } from './overlays'
import { Segmented } from './Segmented'
import { Sheet } from './Sheet'
import { Stepper } from './Stepper'
import { Toggle } from './Toggle'
import { useLongPress } from './useLongPress'
import type { HeatLevel } from '../types'

afterEach(cleanup)

describe('Field wiring', () => {
  it('connects label, hint and error to the control', () => {
    render(
      <Field label="Name" hint="What to call you" error="Required" htmlFor="n">
        <TextInput value="" onChange={() => {}} />
      </Field>,
    )
    const input = screen.getByLabelText('Name')
    expect(input.id).toBe('n')
    expect(input.getAttribute('aria-describedby')).toBe('n-hint n-error')
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })
})

describe('MaskedInput', () => {
  it('masks by default and toggles', () => {
    render(
      <Field label="API key" htmlFor="k">
        <MaskedInput value="sk-123" onChange={() => {}} noun="API key" />
      </Field>,
    )
    const input = screen.getByLabelText('API key') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Show API key' }))
    expect(input.type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: 'Hide API key' }))
    expect(input.type).toBe('password')
  })
})

describe('Toggle', () => {
  it('is a switch', () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} label="Hints" />)
    const sw = screen.getByRole('switch', { name: 'Hints' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

function SegmentedHarness() {
  const [v, setV] = useState<'a' | 'b' | 'c'>('a')
  return (
    <Segmented
      aria-label="Pick"
      value={v}
      onChange={setV}
      options={[
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', disabled: true },
        { value: 'c', label: 'C' },
      ]}
    />
  )
}

describe('Segmented', () => {
  it('moves with arrow keys, skips disabled options and keeps one tab stop', () => {
    render(<SegmentedHarness />)
    const a = screen.getByRole('radio', { name: 'A' })
    expect(screen.getByRole('radiogroup', { name: 'Pick' })).toBeTruthy()
    expect(a.tabIndex).toBe(0)
    fireEvent.keyDown(a, { key: 'ArrowRight' })
    const c = screen.getByRole('radio', { name: 'C' })
    expect(c.getAttribute('aria-checked')).toBe('true')
    expect(c.tabIndex).toBe(0)
    expect(a.tabIndex).toBe(-1)
    fireEvent.keyDown(c, { key: 'ArrowRight' })
    expect(a.getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(a, { key: 'End' })
    expect(c.getAttribute('aria-checked')).toBe('true')
  })
})

describe('Stepper', () => {
  it('clamps and snaps', () => {
    expect(clampStep(27, 4, 20, 1)).toBe(20)
    expect(clampStep(0.93, 0, 2, 0.05)).toBe(0.95)
    expect(clampStep(Number.NaN, 5, 50, 1)).toBe(5)
    expect(clampStep(700, 512, 1536, 64)).toBe(704)
  })

  it('respects bounds with its buttons', () => {
    const onChange = vi.fn()
    render(<Stepper value={20} min={4} max={20} onChange={onChange} name="date length" />)
    const plus = screen.getByRole('button', { name: 'Increase date length' }) as HTMLButtonElement
    expect(plus.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Decrease date length' }))
    expect(onChange).toHaveBeenCalledWith(19)
  })
})

function HeatHarness() {
  const [h, setH] = useState<HeatLevel>(2)
  return <HeatControl value={h} onChange={setH} />
}

describe('HeatControl', () => {
  it('shows the level name and description and moves with keys', () => {
    render(<HeatHarness />)
    const flirty = screen.getByRole('radio', { name: '2, Flirty' })
    expect(flirty.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(/^Innuendo, teasing/)).toBeTruthy()
    fireEvent.keyDown(flirty, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: '3, Ecchi' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: '5, Raw' }))
    expect(screen.getByRole('radio', { name: '5, Raw' }).getAttribute('aria-checked')).toBe('true')
  })
})

function LongPressHarness({ onLong, onShort }: { onLong: () => void; onShort: () => void }) {
  const handlers = useLongPress(onLong, { onClick: onShort })
  return (
    <button type="button" {...handlers}>
      version
    </button>
  )
}

describe('useLongPress', () => {
  it('fires after 600ms of pointer hold, and a short press is a click', () => {
    vi.useFakeTimers()
    const onLong = vi.fn()
    const onShort = vi.fn()
    render(<LongPressHarness onLong={onLong} onShort={onShort} />)
    const btn = screen.getByRole('button', { name: 'version' })

    fireEvent.pointerDown(btn, { pointerType: 'touch', button: 0 })
    act(() => {
      vi.advanceTimersByTime(599)
    })
    expect(onLong).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(onLong).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(btn)
    fireEvent.click(btn, { detail: 1 })
    expect(onShort).not.toHaveBeenCalled()

    fireEvent.pointerDown(btn, { pointerType: 'touch', button: 0 })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    fireEvent.pointerUp(btn)
    fireEvent.click(btn, { detail: 1 })
    expect(onShort).toHaveBeenCalledTimes(1)
    expect(onLong).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('has a keyboard fallback: hold Enter', () => {
    vi.useFakeTimers()
    const onLong = vi.fn()
    const onShort = vi.fn()
    render(<LongPressHarness onLong={onLong} onShort={onShort} />)
    const btn = screen.getByRole('button', { name: 'version' })
    fireEvent.keyDown(btn, { key: 'Enter' })
    act(() => {
      vi.advanceTimersByTime(650)
    })
    fireEvent.keyUp(btn, { key: 'Enter' })
    expect(onLong).toHaveBeenCalledTimes(1)
    expect(onShort).not.toHaveBeenCalled()
    fireEvent.keyDown(btn, { key: 'Enter' })
    fireEvent.keyUp(btn, { key: 'Enter' })
    expect(onShort).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

function SheetHarness() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Hello">
        <button type="button">inside</button>
      </Sheet>
    </>
  )
}

describe('Sheet', () => {
  it('is a labelled modal dialog, registers as an overlay, and closes on Escape', async () => {
    render(<SheetHarness />)
    const dialog = screen.getByRole('dialog', { name: 'Hello' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(hasOpenOverlay()).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(hasOpenOverlay()).toBe(false)
  })

  it('closes from the back button hook', async () => {
    render(<SheetHarness />)
    let closed = false
    act(() => {
      closed = closeTopOverlay()
    })
    expect(closed).toBe(true)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(closeTopOverlay()).toBe(false)
  })
})
