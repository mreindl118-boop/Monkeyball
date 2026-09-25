// The gallery (docs/SPEC.md, Screens 7). #/gallery lists the characters of the active sets with
// how many tiers are unlocked and a favorites filter; #/gallery/:id is one character's five tiers,
// their endings (seen, or shown locked when reachable) and any group pictures they're in. Locked
// slots show their title and what unlocks them. Unlocked ones open the full-screen viewer.

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { unlockedSlots, useArtJob } from '../../art/generate'
import { Portrait } from '../../art/Portrait'
import { portraitAccent } from '../../art/Portrait.model'
import { artResolver } from '../../art/resolve'
import { slotKey, type ArtSlot } from '../../art/types'
import { newRelationship } from '../../engine/relationship'
import { routeFor } from '../../engine/stages'
import { useGame } from '../../store/game'
import { useNav } from '../../store/nav'
import { useRoster } from '../../store/roster'
import { useSettings } from '../../store/settings'
import type { Character, EndingType, Relationship, Route } from '../../types'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Kiss } from '../../ui/Kiss'
import { Note, Panel } from '../../ui/Panel'
import { Segmented } from '../../ui/Segmented'
import { TopBar } from '../../ui/TopBar'
import { useRosterAndGame } from '../Hub/useRosterGame'
import { gallerySlots } from '../Profile/profileModel'
import styles from './Gallery.module.css'
import {
  favoriteSlots,
  firstName,
  galleryGroups,
  groupSlotsFor,
  reachableEndings,
  slotKicker,
  slotScene,
  slotTitle,
  unlockedLabel,
  unlockedTierCount,
  visibleSlot,
  withFavorites,
} from './galleryModel'
import { clearGalleryOpenAt, peekGalleryOpenAt } from './openAt'
import { useArtIndex } from './useArtIndex'
import { Viewer, type ViewerItem } from './Viewer'

type Filter = 'everyone' | 'favorites'

export default function Gallery() {
  const screen = useNav((s) => s.screen)
  const id = screen.name === 'gallery' ? screen.id : undefined
  return id ? <CharacterGallery key={id} id={id} /> : <GalleryList />
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={styles.lockIcon}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** Five little prints, brass for each unlocked tier. */
function TierDots({ count }: { count: number }) {
  return (
    <span className={styles.dots} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={cx(styles.dot, n <= count && styles.dotOn)} />
      ))}
    </span>
  )
}

/** Names by id, for group pictures ("With Kai and Sol"). */
function useNames(): Record<string, string> {
  const entries = useRoster((s) => s.entries)
  return useMemo(() => {
    const out: Record<string, string> = {}
    for (const e of Object.values(entries)) out[e.character.id] = e.character.name.trim() || e.character.id
    return out
  }, [entries])
}

// ---------------------------------------------------------------------------
// #/gallery

function GalleryList() {
  const back = useNav((s) => s.back)
  const go = useNav((s) => s.go)
  const ready = useRosterAndGame()
  const activeSets = useSettings((s) => s.settings.activeSets)
  const sets = useRoster((s) => s.sets)
  const entries = useRoster((s) => s.entries)
  const relationships = useGame((s) => s.relationships)
  const names = useNames()
  const [filter, setFilter] = useState<Filter>('everyone')
  const index = useArtIndex()
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number } | null>(null)

  const groups = useMemo(
    () => galleryGroups(sets, entries, activeSets, relationships, index.favorites),
    [sets, entries, activeSets, relationships, index.favorites],
  )
  const order = useMemo(() => groups.flatMap((g) => g.rows.map((r) => r.id)), [groups])
  const favorites = useMemo(() => {
    return favoriteSlots(index.favorites, order).flatMap(({ slot, key, owner }) => {
      const character = entries[owner]?.character
      if (!character) return []
      const item: ViewerItem = {
        slot,
        key,
        character,
        title: slotTitle(character, slot),
        kicker: `${firstName(names[owner] ?? owner)}, ${lowerFirst(slotKicker(slot, names, owner))}`,
        scene: slotScene(character, slot),
      }
      return [item]
    })
  }, [index.favorites, order, entries, names])
  const shown = filter === 'favorites' ? withFavorites(groups) : groups

  return (
    <main className={`screen ${styles.root}`} aria-busy={!ready || undefined}>
      <TopBar title="Gallery" onBack={back} />

      <Segmented
        aria-label="Show"
        value={filter}
        options={[
          { value: 'everyone', label: 'Everyone' },
          { value: 'favorites', label: 'Favorites' },
        ]}
        onChange={setFilter}
        className={styles.filter}
      />

      {!ready && groups.length === 0 ? (
        <p className={styles.caption} role="status">
          Finding everyone
        </p>
      ) : groups.length === 0 ? (
        <Panel title="Nobody in town yet" description="Turn on a character set and their galleries show up here.">
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => go({ name: 'sets' })}>
              Character sets
            </Button>
          </div>
        </Panel>
      ) : filter === 'favorites' && favorites.length === 0 ? (
        <Note title="No favorites yet">Open a picture and tap Favorite to keep it here.</Note>
      ) : null}

      {filter === 'favorites' && favorites.length > 0 && (
        <Panel title="Favorites" className={styles.section}>
          <ul className={styles.grid}>
            {favorites.map((f, i) => (
              <li key={f.key} className={styles.tile}>
                <button
                  type="button"
                  className={styles.tileButton}
                  style={{ '--accent': portraitAccent(f.character.accent) } as CSSProperties}
                  aria-label={`${f.kicker}: ${f.title}`}
                  onClick={() => setViewer({ items: favorites, index: i })}
                >
                  <SlotArt character={f.character} slot={f.slot} title={f.title} />
                  <span className={styles.favMark} aria-hidden="true">
                    <Kiss />
                  </span>
                </button>
                {/* Favorites mix everyone: say whose picture it is (the button's label already does). */}
                <span className={cx('name', styles.favWho)} aria-hidden="true">
                  {firstName(f.character.name.trim() || f.character.id)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {shown.map((g) => (
        <section key={g.setId} className={styles.group} aria-labelledby={`gallery-set-${g.setId}`}>
          <h2 className={styles.groupTitle} id={`gallery-set-${g.setId}`}>
            {g.name}
          </h2>
          <ul className={styles.rows}>
            {g.rows.map((r) => {
              const entry = entries[r.id]
              if (!entry) return null
              const unlocked = unlockedLabel(r.unlocked)
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className={styles.row}
                    style={{ '--accent': portraitAccent(entry.character.accent) } as CSSProperties}
                    onClick={() => go({ name: 'gallery', id: r.id })}
                  >
                    <span className={styles.rowArt}>
                      <Portrait character={entry.character} size="small" shape="round" />
                    </span>
                    <span className={styles.rowText}>
                      <span className={cx('name', styles.rowName)}>{r.name}</span>
                      <span className={styles.rowMeta}>
                        <TierDots count={r.unlocked} />
                        <span className={styles.rowCount} aria-label={unlocked.spoken}>
                          {unlocked.short}
                        </span>
                        {r.favorites > 0 && (
                          <span className={styles.rowFavs} aria-label={`${r.favorites} ${r.favorites === 1 ? 'favorite' : 'favorites'}`}>
                            <Kiss className={styles.rowKiss} />
                            {r.favorites}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {viewer && (
        <Viewer
          items={viewer.items}
          index={viewer.index}
          favorites={index.favorites}
          onIndex={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
          onClose={() => setViewer(null)}
        />
      )}
    </main>
  )
}

/**
 * The line under a locked slot's title: what unlocks it. A locked ending's lock from the engine
 * ("Ending: The good ending") would only repeat its kicker and title, so it says when it unlocks.
 */
function lockLine(s: { slot: ArtSlot; lock: string }): string {
  return s.slot.kind !== 'tier' && /^Ending:/.test(s.lock) ? 'Unlocks when it plays' : s.lock
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s
}

// ---------------------------------------------------------------------------
// #/gallery/:id

function CharacterGallery({ id }: { id: string }) {
  const back = useNav((s) => s.back)
  const go = useNav((s) => s.go)
  const ready = useRosterAndGame()
  const entry = useRoster((s) => s.entries[id])
  if (!entry) {
    return (
      <main className={`screen ${styles.root}`}>
        <TopBar title="Gallery" onBack={back} />
        {ready ? (
          <Panel title="Nobody by that name" description="This character isn't on this device. They may have been deleted, or their pack removed.">
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => go({ name: 'gallery' })}>
                The whole gallery
              </Button>
            </div>
          </Panel>
        ) : (
          <p className={styles.caption} role="status">
            Finding them
          </p>
        )}
      </main>
    )
  }
  return <CharacterGalleryView character={entry.character} />
}

interface SlotView {
  slot: ArtSlot
  key: string
  unlocked: boolean
  lock: string
  title: string
  kicker: string
  scene: string
}

/** The engine's slots (tiers, then endings), or the five tiers alone if that ever fails. */
function characterSlots(
  character: Character,
  rel: Relationship,
  route: Route,
  endingsSeen: readonly EndingType[],
  polycule: readonly string[] | null,
): { slot: ArtSlot; unlocked: boolean; lock?: string }[] {
  try {
    return unlockedSlots(character, rel, route, { endingsSeen, ...(polycule ? { polycule } : {}) })
  } catch {
    return gallerySlots(character, rel, route).map((t) => ({
      slot: { kind: 'tier', characterId: character.id, tier: t.tier },
      unlocked: t.unlocked,
      lock: t.lock,
    }))
  }
}

function CharacterGalleryView({ character }: { character: Character }) {
  const back = useNav((s) => s.back)
  const go = useNav((s) => s.go)
  const id = character.id
  const stored = useGame((s) => s.relationships[id])
  const rel = useMemo(() => stored ?? newRelationship(id), [stored, id])
  const profile = useSettings((s) => s.profile)
  const mode = useSettings((s) => s.settings.orientationMode)
  const route = routeFor(character, profile, mode)
  const names = useNames()
  const index = useArtIndex()
  // The picture open in the viewer, by slot key (the profile's strip can hand one over).
  const [openKey, setOpenKey] = useState<string | null>(() => peekGalleryOpenAt())
  useEffect(() => clearGalleryOpenAt(), [])
  const endingsSeen = useGame((s) => s.game.endingsSeen[id])
  // Who shares this character's Polycule picture, once that ending has played.
  const [polycule, setPolycule] = useState<string[] | null>(null)
  useEffect(() => {
    let alive = true
    artResolver()
      .polyculeGroupOf(id)
      .then((g) => {
        if (alive) setPolycule(g)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [id, index])

  const name = character.name.trim() || id
  const first = firstName(name)

  const slots = useMemo<SlotView[]>(() => {
    const reachable = reachableEndings(character, rel, route)
    const own = characterSlots(character, rel, route, endingsSeen ?? [], polycule).filter((s) => visibleSlot(s, reachable))
    const ownKeys = new Set(own.map((s) => slotKey(s.slot)))
    const groups = groupSlotsFor(id, index.groups)
      .filter((slot) => !ownKeys.has(slotKey(slot)))
      .map((slot) => ({ slot, unlocked: true, lock: '' }))
    return [...own, ...groups].map((s) => ({
      slot: s.slot,
      key: slotKey(s.slot),
      unlocked: s.unlocked,
      lock: s.lock ?? '',
      title: slotTitle(character, s.slot),
      kicker: slotKicker(s.slot, names, id),
      scene: slotScene(character, s.slot),
    }))
  }, [character, rel, route, id, index.groups, names, endingsSeen, polycule])

  const viewable = useMemo<ViewerItem[]>(
    () => slots.filter((s) => s.unlocked).map((s) => ({ slot: s.slot, key: s.key, character, title: s.title, kicker: s.kicker, scene: s.scene })),
    [slots, character],
  )

  const open = openKey ? viewable.findIndex((v) => v.key === openKey) : -1

  const tiers = slots.filter((s) => s.slot.kind === 'tier')
  const endings = slots.filter((s) => s.slot.kind === 'ending')
  const groups = slots.filter((s) => s.slot.kind === 'group')
  const unlocked = unlockedLabel(unlockedTierCount(rel))
  const style = { '--accent': portraitAccent(character.accent) } as CSSProperties

  const openSlot = (key: string) => setOpenKey(key)

  const renderTiles = (list: SlotView[]) => (
    <ul className={styles.grid}>
      {list.map((s) =>
        s.unlocked ? (
          <li key={s.key} className={styles.tile}>
            <button
              type="button"
              className={styles.tileButton}
              aria-label={`${s.kicker}: ${s.title}${index.favorites.has(s.key) ? ', a favorite' : ''}`}
              onClick={() => openSlot(s.key)}
            >
              <SlotArt character={character} slot={s.slot} title={s.title} />
              {index.favorites.has(s.key) && (
                <span className={styles.favMark} aria-hidden="true">
                  <Kiss />
                </span>
              )}
            </button>
          </li>
        ) : (
          <li key={s.key} className={cx(styles.tile, styles.locked)}>
            <span className={styles.lockedKicker}>{s.kicker}</span>
            <LockIcon />
            <span className={styles.lockedTitle}>{s.title}</span>
            {s.lock && <span className={styles.lockText}>{lockLine(s)}</span>}
          </li>
        ),
      )}
    </ul>
  )

  return (
    <main className={`screen ${styles.root}`} style={style}>
      <TopBar title={<span className="name">{name}</span>} onBack={back} />

      <section className={styles.hero} aria-label={`${name}'s gallery`}>
        <p className={styles.heroCount}>
          <TierDots count={unlockedTierCount(rel)} />
          <span>{unlocked.spoken}</span>
        </p>
        <p className={styles.caption}>
          {route === 'friend'
            ? `On a friend route tiers 1 and 2 unlock; the rest stay friendship-locked.`
            : `Each tier unlocks as ${first} gets closer to you: 20, 40, 60, 80 and 100.`}
        </p>
        <div className={styles.actions}>
          <Button variant="secondary" size="small" onClick={() => go({ name: 'profile', id })}>
            Profile
          </Button>
        </div>
      </section>

      <Panel title="Tiers" tone="brass" className={styles.section}>
        {renderTiles(tiers)}
      </Panel>

      {endings.length > 0 && (
        <Panel
          title="Endings"
          description={`Each ending that plays with ${first} adds its own picture here.`}
          tone="brass"
          className={styles.section}
        >
          {renderTiles(endings)}
        </Panel>
      )}

      {groups.length > 0 && (
        <Panel title="Together" description="Pictures with the others." className={styles.section}>
          {renderTiles(groups)}
        </Panel>
      )}

      {open >= 0 && (
        <Viewer
          items={viewable}
          index={open}
          favorites={index.favorites}
          onIndex={(i) => setOpenKey(viewable[i]?.key ?? null)}
          onClose={() => setOpenKey(null)}
        />
      )}
    </main>
  )
}

/**
 * A slot's art in a tile: the tier's portrait, or the ending's or group's with its title, and a
 * "Painting" tag while it's being generated.
 */
function SlotArt({ character, slot, title }: { character: Character; slot: ArtSlot; title: string }) {
  const job = useArtJob(slot)
  return (
    <>
      {slot.kind === 'tier' && slot.characterId === character.id ? (
        <Portrait character={character} tier={slot.tier} size="medium" thumb />
      ) : (
        <Portrait character={character} slot={slot} caption={{ title }} size="medium" thumb />
      )}
      {job.generating && (
        <span className={styles.painting} role="status">
          Painting
        </span>
      )}
    </>
  )
}
