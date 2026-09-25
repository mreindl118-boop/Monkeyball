// A character's art for one gallery slot (docs/SPEC.md, "Art and gallery"). The art comes from
// src/art/resolve.ts (the player's imported image, then bundled, then generated); without any, it
// draws the spec's placeholder (source 4): an accent-tinted card with a silhouette, the tier title
// and the scene line as a caption.
//
// Without a `tier`, a character with an id shows their highest unlocked tier (the hub, the date and
// the recap all show where the player has got to), or the plain placeholder before anything is
// unlocked. The art is looked up only once the portrait is near the screen, the image decodes off
// the main thread, and the object URL is released when the portrait goes (useArt).

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useGame } from '../store/game'
import type { Character, TierNumber } from '../types'
import { cx } from '../ui/cx'
import { highestUnlocked, portraitAccent, portraitAlt, tierOf } from './Portrait.model'
import styles from './Portrait.module.css'
import { useArt } from './resolve'
import { slotKey, type ArtSlot, type ResolvedArt } from './types'

export interface PortraitProps {
  /** The card (an id lets the portrait find the art and the highest unlocked tier). */
  character: Pick<Character, 'name' | 'accent' | 'gallery'> & { id?: string }
  /**
   * The gallery tier to show. Without one: the highest tier unlocked with this character, or the
   * plain placeholder (no caption) when nothing is unlocked yet.
   */
  tier?: TierNumber
  /**
   * small: art only (coasters, thumbnails). medium: art and the tier title. large: art, title and
   * the scene line.
   */
  size?: 'small' | 'medium' | 'large'
  /** card: a 4:5 card. round: a circle, for coasters. */
  shape?: 'card' | 'round'
  className?: string
  /** Another slot than the tier's (ending or group art); `caption` gives its title and scene. */
  slot?: ArtSlot
  /** Title and scene for a slot that isn't a tier, or to override the tier's. */
  caption?: { title: string; scene?: string }
  /** Art a parent already resolved (skips the lookup). null: show the placeholder. */
  art?: ResolvedArt | null
  /** Look the art up right away instead of when the portrait nears the screen. */
  eager?: boolean
  /**
   * Show a stored picture's thumbnail (src/art/compress.ts): for coasters and gallery tiles, where
   * many show at once. Default: round portraits (coasters, avatars) and small ones (the recap's
   * hero), so a phone doesn't decode a full picture for a small avatar.
   */
  thumb?: boolean
}

/** The same slot object for as long as it names the same slot (parents may build a new one each render). */
function useStableSlot(slot: ArtSlot | null): ArtSlot | null {
  const key = slot ? slotKey(slot) : null
  const [kept, setKept] = useState<{ key: string | null; slot: ArtSlot | null }>({ key, slot })
  if (kept.key !== key) {
    setKept({ key, slot })
    return slot
  }
  return kept.slot
}

/** True once the element has been near the viewport (always true where there's no observer). */
function useNearScreen(eager: boolean): [(el: Element | null) => void, boolean] {
  const [el, setEl] = useState<Element | null>(null)
  const [near, setNear] = useState(() => eager || typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near || !el) return
    const io = new IntersectionObserver(
      (list) => {
        if (list.some((e) => e.isIntersecting)) setNear(true)
      },
      { rootMargin: '240px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [el, near])
  return [setEl, near]
}

export function Portrait(props: PortraitProps) {
  const { character, tier: tierProp, slot: slotProp, art: given, eager = false, thumb = props.shape === 'round' || props.size === 'small' } = props
  const id = character.id?.trim() || ''
  // No tier asked for: the highest unlocked one (the game store knows; nothing unlocked, none).
  const highest = useGame((s) => (tierProp == null && !slotProp && id ? highestUnlocked(s.relationships[id]) : undefined))
  const tier = tierProp ?? (slotProp ? undefined : highest)
  const slot = useStableSlot(slotProp ?? (id && tier != null ? { kind: 'tier', characterId: id, tier } : null))
  const [nearRef, near] = useNearScreen(eager)
  const looked = useArt(given !== undefined || !near ? null : slot, { thumb })
  const art = given !== undefined ? given : looked.art
  const [failed, setFailed] = useState<string | null>(null)
  const url = art && art.source !== 'placeholder' && art.url && art.url !== failed ? art.url : undefined

  return (
    <PortraitFrame {...props} tier={tier} frameRef={nearRef} source={url ? art?.source : undefined}>
      {url && (
        <img
          key={url}
          className={styles.image}
          src={url}
          alt={portraitAlt(character.name.trim() || 'This character', frameTitle(character, tier, props.caption), false)}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onError={() => setFailed(url)}
        />
      )}
    </PortraitFrame>
  )
}

/**
 * The placeholder the spec describes, with no lookup: an accent-tinted card with a silhouette, the
 * title and (large) the scene line. The instant film and the gallery use it as the fallback art.
 */
export function PortraitPlaceholder(props: Omit<PortraitProps, 'art' | 'eager' | 'thumb'>) {
  return <PortraitFrame {...props} />
}

/** The title a frame shows: the caption's, the tier's, or "Tier n". */
function frameTitle(character: PortraitProps['character'], tier: TierNumber | undefined, caption: PortraitProps['caption']): string {
  return caption?.title.trim() || tierOf(character, tier)?.title.trim() || (tier ? `Tier ${tier}` : '')
}

interface FrameProps extends PortraitProps {
  frameRef?: (el: Element | null) => void
  /** Where the image inside came from; unset while the placeholder shows. */
  source?: ResolvedArt['source']
  children?: ReactNode
}

function PortraitFrame({
  character,
  tier,
  size = 'medium',
  shape = 'card',
  className,
  caption,
  frameRef,
  source,
  children,
}: FrameProps) {
  const title = frameTitle(character, tier, caption)
  const scene = (caption ? caption.scene : tierOf(character, tier)?.scene)?.trim() ?? ''
  const showTitle = !!title && size !== 'small' && shape === 'card'
  const showScene = !!scene && size === 'large' && shape === 'card'
  const name = character.name.trim() || 'This character'
  const hasArt = !!source
  const label = portraitAlt(name, title, !hasArt)

  return (
    <figure
      ref={frameRef}
      className={cx(styles.portrait, styles[size], styles[shape], hasArt && styles.hasArt, className)}
      style={{ '--accent': portraitAccent(character.accent) } as CSSProperties}
      data-tier={tier ?? undefined}
      data-source={source ?? 'placeholder'}
      // Real art is named by its image's alt text; the placeholder card names itself.
      aria-label={showTitle || hasArt ? undefined : label}
      role={showTitle || hasArt ? undefined : 'img'}
    >
      {!hasArt && (
        <svg className={styles.silhouette} viewBox="0 0 100 125" aria-hidden="true" focusable="false">
          <path
            className={styles.body}
            d="M50 26c9.9 0 17.6 8.3 17.6 19.4 0 8.2-3.9 15.4-9.6 18.8v6.1c13.6 3 25.1 11.6 29.3 27.4 1.8 6.9 2.7 16.2 2.7 27.3H10c0-11.1.9-20.4 2.7-27.3 4.2-15.8 15.7-24.4 29.3-27.4v-6.1c-5.7-3.4-9.6-10.6-9.6-18.8C32.4 34.3 40.1 26 50 26Z"
          />
          <path className={styles.rim} d="M67.6 45.4c0 8.2-3.9 15.4-9.6 18.8M87.3 97.7c1.8 6.9 2.7 16.2 2.7 27.3" />
        </svg>
      )}
      {children}
      {tier != null && shape === 'card' && size !== 'small' && (
        <span className={styles.badge} aria-hidden="true">
          Tier {tier}
        </span>
      )}
      {showTitle && (
        <figcaption className={styles.caption}>
          {!hasArt && <span className="visually-hidden">{name}, placeholder art: </span>}
          <span className={styles.title}>{title}</span>
          {showScene && <span className={styles.scene}>{scene}</span>}
        </figcaption>
      )}
    </figure>
  )
}
