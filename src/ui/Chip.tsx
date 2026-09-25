import type { ReactNode } from 'react'
import { cx } from './cx'
import styles from './Chip.module.css'

export interface ChipProps {
  children: ReactNode
  /** Makes the chip a button. */
  onClick?: () => void
  /** Toggle state for button chips (aria-pressed). */
  selected?: boolean
  tone?: 'default' | 'brass' | 'lipstick'
  disabled?: boolean
  className?: string
  title?: string
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={styles.check}>
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** A pill: a tappable suggestion (with onClick) or a static tag. A selected toggle chip shows a check. */
export function Chip({ children, onClick, selected, tone = 'default', disabled, className, title }: ChipProps) {
  const cls = cx(
    styles.chip,
    tone !== 'default' && styles[tone],
    selected && styles.selected,
    !onClick && styles.static,
    className,
  )
  if (!onClick) {
    return (
      <span className={cls} title={title}>
        {children}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      aria-pressed={selected === undefined ? undefined : selected}
      disabled={disabled}
      title={title}
    >
      {selected && <CheckIcon />}
      {children}
    </button>
  )
}

export function ChipRow({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={cx(styles.row, className)} role={label ? 'group' : undefined} aria-label={label}>
      {children}
    </div>
  )
}
