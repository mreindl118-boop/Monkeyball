import { useId, type HTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'
import styles from './Panel.module.css'

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  description?: ReactNode
  tone?: 'default' | 'brass' | 'flat'
  /** Rendered element; sections get a heading id for aria-labelledby. */
  as?: 'section' | 'div'
  headingLevel?: 2 | 3
}

export function Panel({
  title,
  description,
  tone = 'default',
  as = 'section',
  headingLevel = 2,
  className,
  children,
  id,
  ...rest
}: PanelProps) {
  const Tag = as
  const H = headingLevel === 2 ? 'h2' : 'h3'
  const autoId = useId()
  const headingId = title ? `${id ?? autoId}-title` : undefined
  return (
    <Tag
      {...rest}
      id={id}
      aria-labelledby={as === 'section' ? headingId : undefined}
      className={cx(styles.panel, tone !== 'default' && styles[tone], className)}
    >
      {(title || description) && (
        <div className={styles.header}>
          {title && (
            <H className={styles.title} id={headingId}>
              {title}
            </H>
          )}
          {description && <p className={styles.description}>{description}</p>}
        </div>
      )}
      {children}
    </Tag>
  )
}

export interface NoteProps {
  tone?: 'default' | 'brass' | 'lipstick'
  title?: ReactNode
  children?: ReactNode
  role?: 'status' | 'alert'
  className?: string
}

/** A small callout for explanations, warnings and fix instructions. */
export function Note({ tone = 'default', title, children, role, className }: NoteProps) {
  return (
    <div
      role={role}
      className={cx(
        styles.note,
        tone === 'brass' && styles.noteBrass,
        tone === 'lipstick' && styles.noteLipstick,
        className,
      )}
    >
      {title && <p className={styles.noteTitle}>{title}</p>}
      {children && <div>{children}</div>}
    </div>
  )
}

export function Divider() {
  return <hr className={styles.divider} />
}
