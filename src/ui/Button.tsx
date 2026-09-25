import type { ButtonHTMLAttributes, ComponentPropsWithRef, ReactNode } from 'react'
import styles from './Button.module.css'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brass'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  size?: 'normal' | 'small'
  /** Full width. */
  block?: boolean
  /** Shows a spinner, keeps the button's width, and blocks clicks. */
  loading?: boolean
  /** Optional icon before the label. */
  icon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'normal',
  block,
  loading,
  icon,
  className,
  disabled,
  children,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        size === 'small' && styles.small,
        block && styles.block,
        className,
      )}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
    >
      <span className={cx(styles.label, loading && styles.busyLabel)}>
        {icon}
        {children}
      </span>
      {loading && <span className={styles.spinner} aria-hidden="true" />}
    </button>
  )
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Accessible name. Required: icon buttons have no visible text. */
  label: string
  variant?: ButtonVariant
  children: ReactNode
}

export function IconButton({
  label,
  variant = 'ghost',
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={rest.title ?? label}
      className={cx(styles.button, styles[variant], styles.icon, className)}
    >
      {children}
    </button>
  )
}
