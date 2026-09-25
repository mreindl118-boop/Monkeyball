import { useId, type ReactNode } from 'react'
import { cx } from './cx'
import styles from './Toggle.module.css'

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  id?: string
  className?: string
}

/** An on/off switch. The whole row is the control (role=switch). */
export function Toggle({ checked, onChange, label, description, disabled, id, className }: ToggleProps) {
  const auto = useId()
  const base = id ?? `t${auto}`
  return (
    <button
      type="button"
      role="switch"
      id={base}
      aria-checked={checked}
      aria-labelledby={`${base}-label`}
      aria-describedby={description ? `${base}-desc` : undefined}
      disabled={disabled}
      className={cx(styles.row, className)}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.text}>
        <span className={styles.label} id={`${base}-label`}>
          {label}
        </span>
        {description && (
          <span className={styles.description} id={`${base}-desc`}>
            {description}
          </span>
        )}
      </span>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
    </button>
  )
}
