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

/** A pill: a tappable suggestion (with onClick) or a static tag. */
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
