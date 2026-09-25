import { useEffect, useState, type CSSProperties } from 'react'
import { stageLabel } from '../engine/stages'
import { tap } from '../platform/haptics'
import type { Stage } from '../types'
import { cx } from './cx'
import { Kiss } from './Kiss'
import { STAMP_COUNT, STAMP_TILT, stampsFilled } from './LipstickStamps.model'
import styles from './LipstickStamps.module.css'

export interface LipstickStampsProps {
  stage: Stage
  size?: 'small' | 'normal' | 'large'
  /** Show the stage name after the stamps. */
  showLabel?: boolean
  /**
   * Press the new stamps (and a light haptic in the Android app) when the stage changes after the
   * first render. Instant under reduced motion. Default true.
   */
  animate?: boolean
  /** Ink for the filled stamps on a light surface (a coaster) instead of the default lipstick. */
  tone?: 'lipstick' | 'print'
  className?: string
}

interface Press {
  from: number
  to: number
  n: number
}

/** Relationship stage as a row of six lipstick-kiss stamps, inked up to the current stage. */
export function LipstickStamps({
  stage,
  size = 'normal',
  showLabel = false,
  animate = true,
  tone = 'lipstick',
  className,
}: LipstickStampsProps) {
  const filled = stampsFilled(stage)
  const label = stageLabel(stage)
  // Follow changes during render (not in an effect) so the pressed stamps paint in the same frame.
  const [seen, setSeen] = useState(filled)
  const [press, setPress] = useState<Press | null>(null)
  if (seen !== filled) {
    setSeen(filled)
    if (animate && filled > seen) setPress({ from: seen, to: filled, n: (press?.n ?? 0) + 1 })
  }

  useEffect(() => {
    if (press) void tap()
  }, [press])

  return (
    <span className={cx(styles.root, styles[size], tone === 'print' && styles.print, className)}>
      <span className={styles.row} role="img" aria-label={`Stage: ${label}, ${filled} of ${STAMP_COUNT}`}>
        {Array.from({ length: STAMP_COUNT }, (_, i) => {
          const on = i < filled
          const pressing = !!press && on && i >= press.from && i < press.to
          return (
            <Kiss
              key={pressing ? `${i}-${press.n}` : i}
              filled={on}
              className={cx(styles.stamp, on ? styles.on : styles.off, pressing && styles.press)}
              style={
                {
                  '--tilt': `${STAMP_TILT[i % STAMP_TILT.length]}deg`,
                  '--delay': pressing ? `${(i - press.from) * 110}ms` : '0ms',
                } as CSSProperties
              }
            />
          )
        })}
      </span>
      {showLabel && (
        <span className={styles.label} aria-hidden="true">
          {label}
        </span>
      )}
    </span>
  )
}
