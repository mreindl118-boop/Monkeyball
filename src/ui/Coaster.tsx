import type { CSSProperties } from 'react'
import { Portrait } from '../art/Portrait'
import { portraitAccent } from '../art/Portrait.model'
import { stageFor } from '../engine/stages'
import type { Character, TierNumber } from '../types'
import { FRIEND_MARK, JEALOUS_MARK, coasterLabel, coasterName } from './Coaster.model'
import styles from './Coaster.module.css'
import { cx } from './cx'
import { LipstickStamps } from './LipstickStamps'

export interface CoasterProps {
  character: Pick<Character, 'id' | 'name' | 'accent' | 'gallery'>
  affection: number
  /** Traits discovered, and the card's total across the four lists. */
  discovered: number
  total: number
  /** Realistic orientation mode and they aren't into the player's gender. */
  friendRoute?: boolean
  /** They know about someone the player is seeing and mind. */
  jealous?: boolean
  /** Highest unlocked gallery tier (art in the middle); none shows the plain placeholder. */
  tier?: TierNumber
  onClick?: () => void
  className?: string
}

function FriendIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={styles.markIcon}>
      <circle cx="6" cy="8" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="8" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function JealousIcon() {
  // An eye: they've seen something.
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={styles.markIcon}>
      <path d="M1.5 8C3.2 5 5.4 3.6 8 3.6S12.8 5 14.5 8C12.8 11 10.6 12.4 8 12.4S3.2 11 1.5 8Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  )
}

/**
 * A roster card as a round bar coaster: pulpboard texture, an accent ring, the character's art in
 * the middle, their name, stage stamps and how many traits you've found. A brass "Friends" tag
 * marks the friend route and a lipstick "Jealous" tag a jealous character.
 */
export function Coaster({
  character,
  affection,
  discovered,
  total,
  friendRoute = false,
  jealous = false,
  tier,
  onClick,
  className,
}: CoasterProps) {
  const stage = stageFor(affection)
  const style = { '--accent': portraitAccent(character.accent) } as CSSProperties
  const hasMarks = friendRoute || jealous
  const inner = (
    <>
      <span className={styles.disc} aria-hidden="true">
        <span className={styles.art}>
          <Portrait character={character} tier={tier} size="small" shape="round" />
        </span>
        <span className={styles.name}>{coasterName(character.name, character.id)}</span>
        <LipstickStamps stage={stage} size="small" tone="print" className={styles.stamps} />
        <span className={styles.count}>
          {discovered}/{total} traits
        </span>
      </span>
      {hasMarks && (
        <span className={styles.marks} aria-hidden="true">
          {friendRoute && (
            <span className={cx(styles.mark, styles.friend)} title="Friend route: this stays a friendship">
              <FriendIcon />
              {FRIEND_MARK}
            </span>
          )}
          {jealous && (
            <span className={cx(styles.mark, styles.jealous)} title="Knows you're seeing someone, and minds">
              <JealousIcon />
              {JEALOUS_MARK}
            </span>
          )}
        </span>
      )}
    </>
  )
  const label = coasterLabel({ character, affection, discovered, total, friendRoute, jealous })

  if (!onClick) {
    return (
      <div className={cx(styles.coaster, className)} style={style} role="img" aria-label={label}>
        {inner}
      </div>
    )
  }
  return (
    <button type="button" className={cx(styles.coaster, className)} style={style} aria-label={label} onClick={onClick}>
      {inner}
    </button>
  )
}
