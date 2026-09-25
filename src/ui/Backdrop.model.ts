import type { CSSProperties } from 'react'
import type { VenueShape } from '../types'

export type ShapeVars = CSSProperties & Record<`--${string}`, string | number>

/** Shapes whose width and height match draw as true circles, whatever the box's proportions. */
export function isRound(shape: VenueShape): boolean {
  return shape.kind === 'circle' && shape.w === shape.h
}

/**
 * Inline style for one venue shape. x/y are the top-left corner and w/h the size, all in percent
 * of the backdrop box (src/data/venues.ts). Round shapes are squared off in CSS.
 */
export function shapeStyle(shape: VenueShape): ShapeVars {
  const style: ShapeVars = {
    '--x': shape.x,
    '--y': shape.y,
    '--w': shape.w,
    '--h': shape.h,
    background: shape.color,
  }
  if (shape.opacity != null) style.opacity = shape.opacity
  if (shape.blur) style.filter = `blur(${shape.blur}px)`
  if (shape.rotate) style['--rot'] = `${shape.rotate}deg`
  return style
}
