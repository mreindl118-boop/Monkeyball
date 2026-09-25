// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VENUES } from '../data/venues'
import { Backdrop } from './Backdrop'
import { isRound, shapeStyle } from './Backdrop.model'

afterEach(cleanup)

describe('shapeStyle', () => {
  it('passes geometry as percent variables with the paint', () => {
    const s = shapeStyle({ kind: 'rect', x: 6, y: 68, w: 46, h: 26, color: '#5c2f1d', opacity: 0.9, rotate: -2, blur: 3 })
    expect(s).toMatchObject({
      '--x': 6,
      '--y': 68,
      '--w': 46,
      '--h': 26,
      '--rot': '-2deg',
      background: '#5c2f1d',
      opacity: 0.9,
      filter: 'blur(3px)',
    })
  })

  it('leaves out what a shape doesn\'t set', () => {
    const s = shapeStyle({ kind: 'line', x: 0, y: 50, w: 100, h: 0.5, color: '#fff' })
    expect(s.opacity).toBeUndefined()
    expect(s.filter).toBeUndefined()
    expect(s['--rot']).toBeUndefined()
  })

  it('squares off circles with equal sides only', () => {
    expect(isRound({ kind: 'circle', x: 0, y: 0, w: 10, h: 10, color: '#fff' })).toBe(true)
    expect(isRound({ kind: 'circle', x: 0, y: 0, w: 26, h: 20, color: '#fff' })).toBe(false)
    expect(isRound({ kind: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#fff' })).toBe(false)
  })
})

describe('Backdrop', () => {
  it('draws every shape of every venue over its backdrop, and the content above', () => {
    for (const venue of VENUES) {
      const { container, unmount } = render(
        <Backdrop venue={venue}>
          <p>Over the top</p>
        </Backdrop>,
      )
      const layer = container.querySelector('[aria-hidden="true"]') as HTMLElement
      expect(layer.style.background).not.toBe('')
      expect(layer.children).toHaveLength(venue.shapes?.length ?? 0)
      expect(container.textContent).toBe('Over the top')
      unmount()
    }
  })
})
