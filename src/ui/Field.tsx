import { useId, type ReactNode } from 'react'
import { cx } from './cx'
import { FieldContext } from './fieldContext'
import styles from './Field.module.css'

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** Id of the control. Generated when omitted; controls inside pick it up automatically. */
  htmlFor?: string
  required?: boolean
  /** Shows "Optional" next to the label. */
  optional?: boolean
  /** Small text at the right of the label row, e.g. a current value. */
  aside?: ReactNode
  /**
   * 'control' (default) renders a <label for>. 'group' is for radio groups, switches and other
   * composite controls: the label becomes the group's accessible name via aria-labelledby.
   */
  kind?: 'control' | 'group'
  className?: string
  children: ReactNode
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  required = false,
  optional,
  aside,
  kind = 'control',
  className,
  children,
}: FieldProps) {
  const auto = useId()
  const id = htmlFor ?? `f${auto}`
  const labelId = `${id}-label`
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  const labelContent = (
    <>
      {label}
      {optional && <span className={styles.optional}> (optional)</span>}
    </>
  )

  return (
    <FieldContext.Provider value={{ id, labelId, describedBy, invalid: !!error, required }}>
      <div className={cx(styles.field, className)}>
        <div className={styles.labelRow}>
          {kind === 'control' ? (
            <label className={styles.label} htmlFor={id} id={labelId}>
              {labelContent}
            </label>
          ) : (
            <span className={styles.label} id={labelId}>
              {labelContent}
            </span>
          )}
          {aside !== undefined && <span className={styles.aside}>{aside}</span>}
        </div>
        {children}
        {hint && (
          <p className={styles.hint} id={hintId}>
            {hint}
          </p>
        )}
        {error && (
          <p className={styles.error} id={errorId} role="alert">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  )
}
