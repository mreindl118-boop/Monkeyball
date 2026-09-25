// The polycule map (#/map): a constellation on velvet. The player sits in the middle as a coaster;
// every character in play sits round them as a smaller coaster with their accent ring. Partner,
// ex and situationship threads run between characters; brass threads labelled with the agreement
// run from the player; a single lipstick thread marks each place there's tension. Tapping someone
// opens a sheet of plain sentences about where things stand. The same people are listed as buttons
// under the map, so it all works from a keyboard or a screen reader. Nothing moves on its own.

import { useMemo, useState, type CSSProperties } from 'react'
import { portraitAccent } from '../../art/Portrait.model'
import { isJealous, opinionText, othersSeen, seeing } from '../../engine/agreements'
import { approval } from '../../engine/metamour'
import { newRelationship } from '../../engine/relationship'
import { routeFor } from '../../engine/stages'
import { tap } from '../../platform/haptics'
import { activeRelations } from '../../store/date'
import { useGame } from '../../store/game'
import { useNav } from '../../store/nav'
import { selectActiveEntries, useRoster } from '../../store/roster'
import { useSettings } from '../../store/settings'
import type { Relationship, Route } from '../../types'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Panel } from '../../ui/Panel'
import { Sheet } from '../../ui/Sheet'
import { TopBar } from '../../ui/TopBar'
import { useRosterAndGame } from '../Hub/useRosterGame'
import {
  HIT_R,
  YOU,
  buildThreads,
  hasTension,
  initials,
  labelLayout,
  layoutMap,
  TAG_H,
  listLine,
  mapOrder,
  mapSummary,
  personFacts,
  personSentences,
  shortName,
  tensionPath,
  termsLine,
  threadLine,
  type MapRelation,
  type PersonFacts,
  type Placed,
  type Thread,
} from './mapModel'
import styles from './PolyculeMap.module.css'

/** A few fixed stars on the velvet (the same every time: nothing twinkles on its own). */
function stars(width: number, height: number): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = []
  let seed = 7
  const next = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const n = Math.round((width * height) / 5200)
  for (let i = 0; i < n; i++) out.push({ x: next() * width, y: next() * height, r: 0.5 + next() * 0.9 })
  return out
}

export default function PolyculeMap() {
  const back = useNav((s) => s.back)
  const go = useNav((s) => s.go)
  const ready = useRosterAndGame()
  const sets = useRoster((s) => s.sets)
  const entries = useRoster((s) => s.entries)
  const relationships = useGame((s) => s.relationships)
  const game = useGame((s) => s.game)
  const profile = useSettings((s) => s.profile)
  const activeSets = useSettings((s) => s.settings.activeSets)
  const mode = useSettings((s) => s.settings.orientationMode)
  const [selected, setSelected] = useState<string | null>(null)

  const world = useMemo(() => {
    const data = { sets, entries }
    const active = selectActiveEntries(data, { activeSets, showMe: 'everyone' })
    const names: Record<string, string> = {}
    for (const e of Object.values(entries)) names[e.character.id] = e.character.name.trim() || e.character.id
    const relOf = (id: string): Relationship => relationships[id] ?? newRelationship(id)
    const routes = new Map<string, Route>(active.map((e) => [e.character.id, routeFor(e.character, profile, mode)]))
    const routeOf = (id: string): Route => routes.get(id) ?? 'romantic'
    const relations = activeRelations(data, activeSets)
    const people: PersonFacts[] = active.map((e) => {
      const c = e.character
      const rel = relOf(c.id)
      let jealous = false
      let opinion: string | undefined
      let isSeeing = false
      try {
        isSeeing = seeing(rel, routeOf(c.id))
        jealous = isJealous(c, rel)
        opinion = opinionText(c, rel, names)
      } catch {
        // A damaged relationship draws without the engine's reading of it.
      }
      return personFacts(c, e.setId, rel, { seeing: isSeeing, jealous, opinion })
    })
    const inPlay: Record<string, Relationship> = {}
    for (const e of active) inPlay[e.character.id] = relOf(e.character.id)
    const youSee = othersSeen(inPlay, routeOf, '')
    return { people, relations, names, youSee }
  }, [sets, entries, activeSets, relationships, profile, mode])

  const mapRelations: MapRelation[] = world.relations
  const threads = useMemo(() => buildThreads(world.people, mapRelations), [world.people, mapRelations])
  const layout = useMemo(() => layoutMap(mapOrder(world.people, mapRelations)), [world.people, mapRelations])
  const placed = useMemo(() => {
    const m = new Map<string, Placed>(layout.people.map((p) => [p.id, p]))
    m.set(YOU, layout.you)
    return m
  }, [layout])
  const sky = useMemo(() => stars(layout.width, layout.height), [layout.width, layout.height])
  const byId = useMemo(() => new Map(world.people.map((p) => [p.id, p])), [world.people])
  const labels = useMemo(() => {
    const out = labelLayout(layout, threads, (id) => shortName(byId.get(id)?.name ?? '', id))
    return { names: new Map(out.names.map((n) => [n.id, n])), tags: out.tags }
  }, [layout, threads, byId])

  const person = selected ? byId.get(selected) : undefined
  const sentences = person
    ? personSentences(person, {
        names: world.names,
        relations: mapRelations,
        othersYouSee: world.youSee,
        people: world.people,
        approval: (a, b) => {
          try {
            return approval(game, a, b, world.relations)
          } catch {
            return 50
          }
        },
      })
    : []

  const open = (id: string) => {
    void tap()
    setSelected(id)
  }

  const empty = ready && world.people.length === 0

  return (
    <main className={`screen ${styles.root}`}>
      <TopBar title="Polycule map" onBack={back} />

      {!ready ? (
        <p className={styles.loading} role="status">
          Drawing the constellation
        </p>
      ) : empty ? (
        <Panel title="Nobody in town" description="Turn on a character set and the map fills in: everyone in play, their partners and exes, and what you are to each of them.">
          <Button variant="primary" onClick={() => go({ name: 'sets' })}>
            Choose character sets
          </Button>
        </Panel>
      ) : (
        <>
          <p className={styles.intro}>
            Brass threads are agreements, lipstick ones are tension. Tap anyone to see where things stand.
          </p>

          <div className={styles.canvasWrap}>
            <svg
              className={styles.canvas}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              style={{ '--map-w': `${layout.width}px` } as CSSProperties}
              role="img"
              aria-label={`Polycule map. ${mapSummary(world.people)} The people are listed below.`}
            >
              <defs>
                <radialGradient id="map-velvet" cx="50%" cy="45%" r="70%">
                  <stop offset="0%" stopColor="#4a1530" />
                  <stop offset="60%" stopColor="#2a0f1f" />
                  <stop offset="100%" stopColor="#1c0914" />
                </radialGradient>
                <radialGradient id="map-board" cx="34%" cy="28%" r="80%">
                  <stop offset="0%" stopColor="#ddc9b0" />
                  <stop offset="50%" stopColor="#cfb89d" />
                  <stop offset="100%" stopColor="#b99e83" />
                </radialGradient>
              </defs>
              <rect x="0" y="0" width={layout.width} height={layout.height} rx="22" fill="url(#map-velvet)" />
              <g className={styles.stars}>
                {sky.map((s, i) => (
                  <circle key={i} cx={s.x} cy={s.y} r={s.r} />
                ))}
              </g>

              {threads
                .filter((t) => t.kind !== 'tension')
                .map((t) => (
                  <ThreadLine key={t.key} thread={t} placed={placed} />
                ))}
              {threads
                .filter((t) => t.kind === 'tension')
                .map((t) => {
                  const a = placed.get(t.from)
                  const b = placed.get(t.to)
                  if (!a || !b) return null
                  return <path key={t.key} className={styles.tension} d={tensionPath(a, b)} />
                })}
              {labels.tags.map((t) => (
                <g key={`${t.key}-label`} className={styles.tag}>
                  <rect x={t.x - t.w / 2} y={t.y - TAG_H / 2} width={t.w} height={TAG_H} rx={TAG_H / 2} />
                  <text x={t.x} y={t.y + 4}>
                    {t.label}
                  </text>
                </g>
              ))}

              <g className={styles.you} aria-hidden="true">
                <circle cx={layout.you.x} cy={layout.you.y} r={layout.you.r} fill="url(#map-board)" />
                <circle className={styles.youRing} cx={layout.you.x} cy={layout.you.y} r={layout.you.r - 5} />
                <text className={styles.youText} x={layout.you.x} y={layout.you.y + 6}>
                  You
                </text>
              </g>

              {layout.people.map((p) => {
                const f = byId.get(p.id)
                if (!f) return null
                return (
                  <g
                    key={p.id}
                    className={cx(styles.node, selected === p.id && styles.selected)}
                    style={{ '--accent': portraitAccent(f.accent) } as CSSProperties}
                    onClick={() => open(p.id)}
                  >
                    <circle className={styles.hit} cx={p.x} cy={p.y} r={HIT_R} />
                    <circle cx={p.x} cy={p.y} r={p.r} fill="url(#map-board)" />
                    <circle className={styles.ring} cx={p.x} cy={p.y} r={p.r - 3.5} />
                    <text className={styles.initials} x={p.x} y={p.y + 5}>
                      {initials(f.name)}
                    </text>
                    <text className={styles.label} x={p.x} y={labels.names.get(p.id)?.y ?? p.y + p.r + 14}>
                      {shortName(f.name, f.id)}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>

          <Legend />

          <section className={styles.people} aria-labelledby="map-people">
            <h2 className={styles.peopleTitle} id="map-people">
              Everyone on the map
            </h2>
            <ul className={styles.list}>
              {world.people.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={cx(styles.personButton, hasTension(p) && styles.personTense)}
                    style={{ '--accent': portraitAccent(p.accent) } as CSSProperties}
                    onClick={() => open(p.id)}
                  >
                    <span className={styles.dot} aria-hidden="true">
                      {initials(p.name)}
                    </span>
                    <span className={styles.personText}>
                      <span className={cx('name', styles.personName)}>{p.name}</span>
                      <span className={styles.personLine}>{listLine(p)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <Sheet
        open={!!person}
        onClose={() => setSelected(null)}
        title={person ? <span className="name">{person.name}</span> : ''}
        footer={
          person ? (
            <>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Close
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const id = person.id
                  setSelected(null)
                  go({ name: 'profile', id })
                }}
              >
                See their profile
              </Button>
            </>
          ) : undefined
        }
      >
        {person && (
          <div className={styles.sheetBody}>
            <ul className={styles.sentences}>
              {sentences.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            {termsLine(person) && (
              <p className={styles.terms}>
                <span className={styles.termsLabel}>In {shortName(person.name, person.id)}'s words</span>
                <q>{termsLine(person)}</q>
              </p>
            )}
            {person.opinion && (
              <p className={styles.opinion}>
                <span className={styles.termsLabel}>In {shortName(person.name, person.id)}'s head</span>
                <q>{person.opinion}</q>
              </p>
            )}
          </div>
        )}
      </Sheet>
    </main>
  )
}

function ThreadLine({ thread, placed }: { thread: Thread; placed: Map<string, Placed> }) {
  const a = placed.get(thread.from)
  const b = placed.get(thread.to)
  if (!a || !b) return null
  const { x1, y1, x2, y2 } = threadLine(a, b)
  return <line className={cx(styles.thread, styles[thread.kind])} x1={x1} y1={y1} x2={x2} y2={y2} />
}

function Legend() {
  return (
    <ul className={styles.legend} aria-label="What the threads mean">
      <li>
        <svg viewBox="0 0 32 8" aria-hidden="true">
          <line className={cx(styles.thread, styles.agreement)} x1="2" y1="4" x2="30" y2="4" />
        </svg>
        Agreement
      </li>
      <li>
        <svg viewBox="0 0 32 8" aria-hidden="true">
          <path className={styles.tension} d="M 2 6 Q 16 0 30 6" />
        </svg>
        Tension
      </li>
      <li>
        <svg viewBox="0 0 32 8" aria-hidden="true">
          <line className={cx(styles.thread, styles.partner)} x1="2" y1="4" x2="30" y2="4" />
        </svg>
        Partners
      </li>
      <li>
        <svg viewBox="0 0 32 8" aria-hidden="true">
          <line className={cx(styles.thread, styles.ex)} x1="2" y1="4" x2="30" y2="4" />
        </svg>
        Exes
      </li>
      <li>
        <svg viewBox="0 0 32 8" aria-hidden="true">
          <line className={cx(styles.thread, styles.situationship)} x1="2" y1="4" x2="30" y2="4" />
        </svg>
        Situationship
      </li>
    </ul>
  )
}
