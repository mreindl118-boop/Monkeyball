// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstantFilm } from './InstantFilm'
import { DEVELOP_MS, FADE_MS } from './InstantFilm.model'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function film(el: HTMLElement): HTMLElement {
  return el.querySelector('figure')!
}

describe('InstantFilm', () => {
  it('waits undeveloped while queued, with its brass title on the margin', () => {
    const { container } = render(
      <InstantFilm title="Rain check" kicker="Tier 3" state="waiting">
        <span>picture</span>
      </InstantFilm>,
    )
    expect(film(container).dataset.state).toBe('waiting')
    expect(screen.getByText('Rain check')).toBeTruthy()
    expect(screen.getByText('Tier 3')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('develops over 2.5 seconds, then says so once', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    const { container } = render(
      <InstantFilm title="Rain check" state="developing" onDone={onDone}>
        <span>picture</span>
      </InstantFilm>,
    )
    expect(film(container).dataset.state).toBe('developing')
    act(() => {
      vi.advanceTimersByTime(DEVELOP_MS - 50)
    })
    expect(onDone).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(film(container).dataset.state).toBe('done')
    act(() => {
      vi.advanceTimersByTime(DEVELOP_MS * 2)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('holds until the art is ready', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    const { container, rerender } = render(
      <InstantFilm title="Rain check" state="developing" ready={false} onDone={onDone}>
        <span>picture</span>
      </InstantFilm>,
    )
    act(() => {
      vi.advanceTimersByTime(DEVELOP_MS * 2)
    })
    expect(onDone).not.toHaveBeenCalled()
    expect(film(container).dataset.state).toBe('waiting')
    rerender(
      <InstantFilm title="Rain check" state="developing" ready onDone={onDone}>
        <span>picture</span>
      </InstantFilm>,
    )
    expect(film(container).dataset.state).toBe('developing')
    act(() => {
      vi.advanceTimersByTime(DEVELOP_MS)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows the picture at once on a tap', () => {
    const onDone = vi.fn()
    const { container } = render(
      <InstantFilm title="Rain check" state="developing" onDone={onDone}>
        <span>picture</span>
      </InstantFilm>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Show it now/ }))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(film(container).dataset.state).toBe('done')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is a plain fade with reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('reduce'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          onchange: null,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    )
    vi.useFakeTimers()
    const onDone = vi.fn()
    const { container } = render(
      <InstantFilm title="Rain check" state="developing" onDone={onDone}>
        <span>picture</span>
      </InstantFilm>,
    )
    act(() => {
      vi.advanceTimersByTime(FADE_MS + 10)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(film(container).dataset.state).toBe('done')
  })
})
