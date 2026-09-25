import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'
import { useField } from './fieldContext'
import styles from './Segmented.module.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export interface SegmentedProps<T extends string> {
  value: T | null
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  /** 'pills' is a compact segmented control; 'cards' shows descriptions. */
  variant?: 'pills' | 'cards'
  /** Accessible name when not inside a Field. */
  'aria-label'?: string
  /** Minimum card width before cards stack. */
  cardMin?: number
  /** Most cards per row (cards variant). */
  maxColumns?: number
  className?: string
  id?: string
}

/** A single-choice radio group with arrow-key support and a roving tab stop. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  variant = 'pills',
  cardMin = 220,
  maxColumns,
  className,
  id,
  ...aria
}: SegmentedProps<T>) {
  const f = useField(id)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  const selectedIndex = options.findIndex((o) => o.value === value)
  const tabStop = selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : enabled[0]

  const move = (from: number, dir: 1 | -1 | 'first' | 'last') => {
    if (!enabled.length) return
    let next: number
    if (dir === 'first') next = enabled[0]
    else if (dir === 'last') next = enabled[enabled.length - 1]
    else {
      const pos = enabled.indexOf(from)
      const base = pos === -1 ? 0 : pos
      next = enabled[(base + dir + enabled.length) % enabled.length]
    }
    refs.current[next]?.focus()
    onChange(options[next].value)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        move(i, 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        move(i, -1)
        break
      case 'Home':
        e.preventDefault()
        move(i, 'first')
        break
      case 'End':
        e.preventDefault()
        move(i, 'last')
        break
    }
  }

  const cardWidth = maxColumns
    ? `max(${cardMin}px, calc(${100 / maxColumns}% - 10px))`
    : `${cardMin}px`
  const style =
    variant === 'cards' ? ({ '--card-min': cardWidth } as CSSProperties) : undefined

  return (
    <div
      role="radiogroup"
      id={f.id}
      aria-labelledby={aria['aria-label'] ? undefined : f.labelId}
      aria-label={aria['aria-label']}
      aria-describedby={f.describedBy}
      data-count={options.length}
      className={cx(variant === 'cards' ? styles.cards : styles.pills, className)}
      style={style}
    >
      {options.map((o, i) => {
        const checked = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={o.disabled}
            tabIndex={i === tabStop ? 0 : -1}
            className={variant === 'cards' ? styles.card : styles.pill}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {variant === 'cards' ? (
              <>
                <span className={styles.dot} aria-hidden="true" />
                <span className={styles.cardLabel}>{o.label}</span>
                {o.description && <span className={styles.cardDescription}>{o.description}</span>}
              </>
            ) : (
              o.label
            )}
          </button>
        )
      })}
    </div>
  )
}
