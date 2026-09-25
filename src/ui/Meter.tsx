import { useId, type CSSProperties, type ReactNode } from 'react'
import { cx } from './cx'
import { METER_MAX, meterValue } from './Meter.model'
import styles from './Meter.module.css'

export interface MeterProps {
  /** Affection is lipstick, trust is brass. */
  kind: 'affection' | 'trust'
  /** 0 to 100 (clamped). */
  value: number
  /** Visible label; defaults to "Affection" or "Trust". */
  label?: string
  /**
   * A ceiling this relationship can't pass (the friend route stops affection at 59). Drawn as a
   * notch on the bar, with `capNote` under it.
   */
  cap?: number
  capNote?: ReactNode
  className?: string
}

/** A labelled 0-100 bar with its value as text (role meter). */
export function Meter({ kind, value, label, cap, capNote, className }: MeterProps) {
  const id = useId()
  const v = meterValue(value)
  const name = label ?? (kind === 'affection' ? 'Affection' : 'Trust')
  const showCap = cap != null && cap > 0 && cap < METER_MAX
  return (
    <div className={cx(styles.meter, styles[kind], className)}>
      <div className={styles.head}>
        <span className={styles.label} id={`${id}-label`}>
          {name}
        </span>
        <span className={styles.value} aria-hidden="true">
          {v}
          <span className={styles.of}>/{METER_MAX}</span>
        </span>
      </div>
      <div
        className={styles.track}
        role="meter"
        aria-labelledby={`${id}-label`}
        aria-valuemin={0}
        aria-valuemax={METER_MAX}
        aria-valuenow={v}
        aria-valuetext={`${v} of ${METER_MAX}${showCap ? `, capped at ${cap}` : ''}`}
        aria-describedby={showCap && capNote ? `${id}-cap` : undefined}
      >
        <span className={styles.fill} style={{ '--v': v / METER_MAX } as CSSProperties} />
        {showCap && <span className={styles.cap} style={{ left: `${cap}%` }} aria-hidden="true" />}
      </div>
      {showCap && capNote && (
        <p className={styles.capNote} id={`${id}-cap`}>
          {capNote}
        </p>
      )}
    </div>
  )
}
