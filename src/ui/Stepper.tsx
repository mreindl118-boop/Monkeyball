import { useState, type KeyboardEvent } from 'react'
import { cx } from './cx'
import { useField } from './fieldContext'
import { clampStep } from './numbers'
import styles from './Stepper.module.css'

export interface StepperProps {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  /** Short unit after the number, e.g. "turns". */
  unit?: string
  /** What is being changed, for the buttons' accessible names ("date length"). */
  name?: string
  id?: string
  className?: string
  disabled?: boolean
}

/** A number with minus and plus buttons, bounded and snapped to its step. */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  name = 'value',
  id,
  className,
  disabled,
}: StepperProps) {
  const f = useField(id)
  const [draft, setDraft] = useState(String(value))
  // Follow outside changes to the value (derived during render, not in an effect).
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(String(value))
  }

  const commit = (v: number) => {
    const next = clampStep(v, min, max, step)
    setDraft(String(next))
    if (next !== value) onChange(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit(Number(draft))
    else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault()
      commit(value + step * (e.key === 'PageUp' ? 5 : 1))
    } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      e.preventDefault()
      commit(value - step * (e.key === 'PageDown' ? 5 : 1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      commit(min)
    } else if (e.key === 'End') {
      e.preventDefault()
      commit(max)
    }
  }

  return (
    <div className={cx(styles.stepper, className)}>
      <button
        type="button"
        className={styles.btn}
        aria-label={`Decrease ${name}`}
        disabled={disabled || value <= min}
        onClick={() => commit(value - step)}
      >
        −
      </button>
      <span className={styles.valueWrap}>
        <input
          id={f.id}
          className={styles.input}
          type="number"
          inputMode={step < 1 ? 'decimal' : 'numeric'}
          min={min}
          max={max}
          step={step}
          value={draft}
          disabled={disabled}
          aria-describedby={f.describedBy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(Number(draft))}
          onKeyDown={onKeyDown}
        />
        {unit && (
          <span className={styles.unit} aria-hidden="true">
            {unit}
          </span>
        )}
      </span>
      <button
        type="button"
        className={styles.btn}
        aria-label={`Increase ${name}`}
        disabled={disabled || value >= max}
        onClick={() => commit(value + step)}
      >
        +
      </button>
    </div>
  )
}
