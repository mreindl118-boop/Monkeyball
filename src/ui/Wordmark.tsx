import type { CSSProperties } from 'react'
import { Kiss } from './Kiss'
import styles from './Wordmark.module.css'

/** The crushLAB wordmark. */
export function Wordmark({ size = 48, as = 'span', kiss = true }: { size?: number; as?: 'span' | 'h1'; kiss?: boolean }) {
  const Tag = as
  return (
    <Tag className={styles.mark} style={{ '--wm-size': `${size}px` } as CSSProperties}
      role={as === 'span' ? 'img' : undefined}
      aria-label="crushLAB"
    >
      <span className={styles.crush} aria-hidden="true">
        crush
      </span>
      <span className={styles.lab} aria-hidden="true">
        LAB
      </span>
      {kiss && <Kiss className={styles.kiss} />}
    </Tag>
  )
}
