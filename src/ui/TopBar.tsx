import type { ReactNode } from 'react'
import { Button } from './Button'
import styles from './TopBar.module.css'

export interface TopBarProps {
  title: ReactNode
  /** Shows a "Back" text button when provided. */
  onBack?: () => void
  backLabel?: string
  /** Actions on the right. */
  right?: ReactNode
  /** Heading id, for aria-labelledby on the screen root. */
  id?: string
}

export function TopBar({ title, onBack, backLabel = 'Back', right, id }: TopBarProps) {
  return (
    <header className={styles.bar}>
      {onBack && (
        <Button variant="ghost" className={styles.back} onClick={onBack}>
          {backLabel}
        </Button>
      )}
      <h1 className={styles.title} id={id}>
        {title}
      </h1>
      {right && <div className={styles.right}>{right}</div>}
    </header>
  )
}
