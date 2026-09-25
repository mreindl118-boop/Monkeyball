import type { ReactNode } from 'react'
import type { Venue } from '../types'
import { isRound, shapeStyle } from './Backdrop.model'
import styles from './Backdrop.module.css'
import { cx } from './cx'

export interface BackdropProps {
  venue: Pick<Venue, 'backdrop' | 'shapes'>
  /** Content drawn over the backdrop. */
  children?: ReactNode
  /**
   * Fill the nearest positioned parent (position absolute, inset 0). Otherwise the backdrop is a
   * block sized by its content or className.
   */
  fill?: boolean
  /** Darken toward the bottom so text laid over it stays readable. */
  scrim?: boolean
  className?: string
}

/** A venue's CSS backdrop (layered gradients) with its decorative shapes on top. */
export function Backdrop({ venue, children, fill, scrim, className }: BackdropProps) {
  return (
    <div className={cx(styles.root, fill && styles.fill, className)}>
      <div className={styles.layer} style={{ background: venue.backdrop }} aria-hidden="true">
        {(venue.shapes ?? []).map((s, i) => (
          <span
            key={i}
            className={cx(styles.shape, styles[s.kind], isRound(s) && styles.round)}
            style={shapeStyle(s)}
          />
        ))}
        {scrim && <span className={styles.scrim} />}
      </div>
      {children != null && <div className={styles.content}>{children}</div>}
    </div>
  )
}
