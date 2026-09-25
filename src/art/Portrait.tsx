// A character's art for one gallery tier. Phase 2 always draws the placeholder the spec describes
// (docs/SPEC.md, "Art and gallery", source 4): an accent-tinted card with a silhouette, the tier
// title and the scene line as a caption. Phase 5 resolves imported, bundled and generated art
// behind these same props and falls back to this placeholder.

import type { CSSProperties } from 'react'
import type { Character, TierNumber } from '../types'
import { cx } from '../ui/cx'
import { portraitAccent, tierOf } from './Portrait.model'
import styles from './Portrait.module.css'

export interface PortraitProps {
  character: Pick<Character, 'name' | 'accent' | 'gallery'>
  /** The gallery tier to show. Without one, the plain placeholder (no caption). */
  tier?: TierNumber
  /**
   * small: art only (coasters, thumbnails). medium: art and the tier title. large: art, title and
   * the scene line.
   */
  size?: 'small' | 'medium' | 'large'
  /** card: a 4:5 card. round: a circle, for coasters. */
  shape?: 'card' | 'round'
  className?: string
}

export function Portrait({ character, tier, size = 'medium', shape = 'card', className }: PortraitProps) {
  const entry = tierOf(character, tier)
  const title = entry?.title.trim() || (tier ? `Tier ${tier}` : '')
  const scene = entry?.scene.trim() ?? ''
  const showTitle = !!title && size !== 'small' && shape === 'card'
  const showScene = !!scene && size === 'large' && shape === 'card'
  const name = character.name.trim() || 'This character'
  const label = tier ? `${name}, ${title}. Placeholder art.` : `${name}. Placeholder art.`

  return (
    <figure
      className={cx(styles.portrait, styles[size], styles[shape], className)}
      style={{ '--accent': portraitAccent(character.accent) } as CSSProperties}
      data-tier={tier ?? undefined}
      aria-label={showTitle ? undefined : label}
      role={showTitle ? undefined : 'img'}
    >
      <svg className={styles.silhouette} viewBox="0 0 100 125" aria-hidden="true" focusable="false">
        <path
          className={styles.body}
          d="M50 26c9.9 0 17.6 8.3 17.6 19.4 0 8.2-3.9 15.4-9.6 18.8v6.1c13.6 3 25.1 11.6 29.3 27.4 1.8 6.9 2.7 16.2 2.7 27.3H10c0-11.1.9-20.4 2.7-27.3 4.2-15.8 15.7-24.4 29.3-27.4v-6.1c-5.7-3.4-9.6-10.6-9.6-18.8C32.4 34.3 40.1 26 50 26Z"
        />
        <path className={styles.rim} d="M67.6 45.4c0 8.2-3.9 15.4-9.6 18.8M87.3 97.7c1.8 6.9 2.7 16.2 2.7 27.3" />
      </svg>
      {tier != null && shape === 'card' && size !== 'small' && (
        <span className={styles.badge} aria-hidden="true">
          Tier {tier}
        </span>
      )}
      {showTitle && (
        <figcaption className={styles.caption}>
          <span className="visually-hidden">{name}, placeholder art: </span>
          <span className={styles.title}>{title}</span>
          {showScene && <span className={styles.scene}>{scene}</span>}
        </figcaption>
      )}
    </figure>
  )
}
