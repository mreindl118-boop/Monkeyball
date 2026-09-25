// Date setup (#/date-setup/:id): pick a venue and an optional gift, then start the date. Venues
// show their backdrop; locked ones (home before Lover) show the requirement; venues and gifts the
// character reacted to before show that reaction. A group date (#/date-setup/:id/group, Phase 6)
// first picks who else comes along, shows what the two are to each other and how each feels about
// the player dating the other, then the venue (locked if it is for either) and a gift for one.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useReducedMotion } from 'framer-motion'
import { Portrait } from '../../art/Portrait'
import { portraitAccent } from '../../art/Portrait.model'
import { giftById } from '../../data/gifts'
import { venueById } from '../../data/venues'
import { groupFeeling, pairHistory } from '../../engine/groupDate'
import { approval } from '../../engine/metamour'
import { newRelationship } from '../../engine/relationship'
import { routeFor, stageFor, stageLabel } from '../../engine/stages'
import { liveCharacterId, liveCharacterIds, useDate } from '../../store/date'
import { useGame } from '../../store/game'
import { useNav } from '../../store/nav'
import { selectActiveEntries, setsLinked, useRelationsFor, useRoster } from '../../store/roster'
import { useSettings } from '../../store/settings'
import type { Character, Relationship, SetRelationship } from '../../types'
import { Backdrop } from '../../ui/Backdrop'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Note, Panel } from '../../ui/Panel'
import { Segmented } from '../../ui/Segmented'
import { toast } from '../../ui/toastStore'
import { TopBar } from '../../ui/TopBar'
import { firstName } from '../DateScreen/dateModel'
import { useRosterAndGame } from '../Hub/useRosterGame'
import styles from './DateSetup.module.css'
import {
  feelingLine,
  giftOptions,
  groupSummary,
  groupVenueOptions,
  historyLines,
  knownGiftText,
  knownVenueFor,
  knownVenueText,
  namesText,
  relationTo,
  setupSummary,
  validGift,
  validVenue,
  venueOptions,
} from './setupModel'

const NO_GIFT = 'none'

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={styles.lockIcon}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={styles.checkIcon}>
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function DateSetup() {
  const screen = useNav((s) => s.screen)
  const back = useNav((s) => s.back)
  const go = useNav((s) => s.go)
  const id = screen.name === 'date-setup' ? screen.id : ''
  const group = screen.name === 'date-setup' && !!screen.group
  const ready = useRosterAndGame()
  const entry = useRoster((s) => s.entries[id])

  if (!entry) {
    return (
      <main className="screen">
        <TopBar title={group ? 'Ask for a group date' : 'Ask on a date'} onBack={back} />
        {ready ? (
          <Panel title="Nobody by that name" description="This character isn't on this device. They may have been deleted, or their pack removed.">
            <Button variant="primary" onClick={() => go({ name: 'hub' })}>
              Back to the hub
            </Button>
          </Panel>
        ) : (
          <p className={styles.loading} role="status">
            Finding them
          </p>
        )}
      </main>
    )
  }
  return group ? <GroupSetupView character={entry.character} /> : <SetupView character={entry.character} />
}

/** Just the two of you, or a group date: switching keeps the screen (and Back) where it was. */
function KindPicker({ id, group }: { id: string; group: boolean }) {
  const replace = useNav((s) => s.replace)
  return (
    <div className={styles.kind}>
      <Segmented
        aria-label="Kind of date"
        value={group ? 'group' : 'single'}
        onChange={(v) => replace({ name: 'date-setup', id, ...(v === 'group' ? { group: true } : {}) })}
        options={[
          { value: 'single', label: 'Just the two of you' },
          { value: 'group', label: 'Group date' },
        ]}
      />
      <p className={styles.caption}>{group ? 'Two of them and you, at one venue. They talk to each other too.' : 'One on one.'}</p>
    </div>
  )
}

function SetupView({ character }: { character: Character }) {
  const back = useNav((s) => s.back)
  const replace = useNav((s) => s.replace)
  const go = useNav((s) => s.go)
  const id = character.id
  const stored = useGame((s) => s.relationships[id])
  const rel: Relationship = useMemo(() => stored ?? newRelationship(id), [stored, id])
  const profile = useSettings((s) => s.profile)
  const mode = useSettings((s) => s.settings.orientationMode)
  const heat = useSettings((s) => s.settings.heat)
  const liveId = useDate(liveCharacterId)
  const liveIds = useDate(liveCharacterIds)
  const interrupted = useDate((s) => s.interrupted)
  const entries = useRoster((s) => s.entries)

  // A date left open when the app closed (the Android app restarts on the hub): offer its recap
  // before starting another, which would file it away.
  useEffect(() => {
    void useDate.getState().findInterrupted()
  }, [])

  const name = character.name.trim() || id
  const first = firstName(name)
  const route = routeFor(character, profile, mode)
  const venues = useMemo(() => venueOptions(rel, route), [rel, route])
  const gifts = useMemo(() => giftOptions(rel, route, heat), [rel, route, heat])

  const [venuePick, setVenuePick] = useState<string | null>(null)
  const [giftPick, setGiftPick] = useState<string>(NO_GIFT)
  const [starting, setStarting] = useState(false)
  const [recovering, setRecovering] = useState(false)

  const venueId = validVenue(venues, venuePick)
  const giftId = validGift(gifts, giftPick === NO_GIFT ? null : giftPick)
  const venue = venueId ? venueById(venueId) : undefined
  const gift = giftId ? giftById(giftId) : undefined
  const sameDate = liveIds.includes(id)
  const otherDate = liveId && !sameDate ? liveId : null
  const otherName = otherDate ? namesText(liveIds.map((x) => firstName(entries[x]?.character.name ?? x))) : ''
  const style = { '--accent': portraitAccent(character.accent) } as CSSProperties

  const recover = async () => {
    setRecovering(true)
    try {
      const dateId = await useDate.getState().recoverInterrupted()
      if (dateId != null) replace({ name: 'recap', dateId })
    } finally {
      setRecovering(false)
    }
  }

  const start = async () => {
    if (!venueId || starting) return
    setStarting(true)
    try {
      const r = await useDate.getState().start(id, venueId, giftId ?? undefined)
      if (r.ok) {
        // The setup isn't kept behind the date: Back from the date goes to the profile.
        replace({ name: 'date' })
        return
      }
      if (r.reason === 'busy') toast('Another date is still open. Finish it first.', 'error')
      else toast("This character isn't on this device any more.", 'error')
    } finally {
      setStarting(false)
    }
  }

  return (
    <main className={`screen ${styles.root}`} style={style}>
      <TopBar
        title={
          <>
            Ask <span className="name">{first}</span> out
          </>
        }
        onBack={back}
      />

      <section className={styles.intro} aria-label={`Date with ${name}`}>
        <Portrait character={character} size="small" shape="round" className={styles.avatar} />
        <p className={styles.introText}>
          Pick where to go and whether to bring something. {first} reacts to both, and remembers.
        </p>
      </section>

      <KindPicker id={id} group={false} />

      {interrupted && !liveId && (
        <Note tone="brass" title={`Your last date with ${interruptedWho(interrupted)} was interrupted`}>
          <p>crushLAB closed partway through it. See how it went, or start this one and leave it be.</p>
          <div className={styles.noteActions}>
            <Button variant="secondary" size="small" loading={recovering} disabled={starting} onClick={recover}>
              See how it went
            </Button>
          </div>
        </Note>
      )}

      {otherDate && (
        <Note tone="brass" title={`Your date with ${otherName} is still open`}>
          <p>Finish or end it before starting another.</p>
          <div className={styles.noteActions}>
            <Button variant="secondary" size="small" onClick={() => go({ name: 'date' })}>
              Back to that date
            </Button>
          </div>
        </Note>
      )}

      <section className={styles.section} aria-labelledby="venue-title">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="venue-title">
            Where to
          </h2>
          <p className={styles.caption}>Somewhere they love helps. Somewhere they hate costs you.</p>
        </div>
        <div className={styles.venues} role="radiogroup" aria-labelledby="venue-title">
          {venues.map(({ venue: v, lock, known }) => {
            const checked = venueId === v.id
            return (
              <label key={v.id} className={cx(styles.venue, checked && styles.checked, lock && styles.locked)}>
                <input
                  type="radio"
                  name="venue"
                  value={v.id}
                  className={styles.radio}
                  checked={checked}
                  disabled={!!lock}
                  onChange={() => setVenuePick(v.id)}
                  aria-describedby={`venue-${v.id}-desc`}
                />
                <Backdrop venue={v} fill scrim className={styles.venueArt} />
                <span className={styles.venueText}>
                  <span className={styles.venueName}>{v.name}</span>
                  <span className={styles.venueDesc} id={`venue-${v.id}-desc`}>
                    {v.description}
                    {lock ? ` ${lock}.` : known ? ` ${first}: ${knownVenueText(known).toLowerCase()}.` : ''}
                  </span>
                  {lock ? (
                    <span className={styles.lock} aria-hidden="true">
                      <LockIcon />
                      {lock}
                    </span>
                  ) : known ? (
                    <span className={cx(styles.known, styles[known])} aria-hidden="true">
                      {knownVenueText(known)}
                    </span>
                  ) : null}
                </span>
                {checked && (
                  <span className={styles.check}>
                    <CheckIcon />
                  </span>
                )}
              </label>
            )
          })}
        </div>
        {/* The cards clip their descriptions on a phone; the picked venue's reads in full here. */}
        {venue && <p className={styles.pickDesc}>{venue.description}</p>}
      </section>

      <section className={styles.section} aria-labelledby="gift-title">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="gift-title">
            Bring a gift
          </h2>
          <p className={styles.caption}>Optional. The right one goes a long way.</p>
        </div>
        <div className={styles.gifts} role="radiogroup" aria-labelledby="gift-title">
          <label className={cx(styles.gift, giftId === null && styles.checked)}>
            <input
              type="radio"
              name="gift"
              value={NO_GIFT}
              className={styles.radio}
              checked={giftId === null}
              onChange={() => setGiftPick(NO_GIFT)}
            />
            <span className={styles.giftName}>No gift</span>
            <span className={styles.giftMeta}>Just you</span>
            {giftId === null && (
              <span className={styles.check}>
                <CheckIcon />
              </span>
            )}
          </label>
          {gifts.map(({ gift: g, lock, known }) => {
            const checked = giftId === g.id
            return (
              <label key={g.id} className={cx(styles.gift, checked && styles.checked, lock && styles.locked)}>
                <input
                  type="radio"
                  name="gift"
                  value={g.id}
                  className={styles.radio}
                  checked={checked}
                  disabled={!!lock}
                  onChange={() => setGiftPick(g.id)}
                />
                <span className={styles.giftName}>{g.name}</span>
                {lock ? (
                  <span className={styles.lock}>
                    <LockIcon />
                    {lock}
                  </span>
                ) : known ? (
                  <span className={cx(styles.known, styles[known])}>{knownGiftText(known)}</span>
                ) : (
                  <span className={styles.giftMeta}>Not tried yet</span>
                )}
                {checked && (
                  <span className={styles.check}>
                    <CheckIcon />
                  </span>
                )}
              </label>
            )
          })}
        </div>
        {gift && <p className={styles.pickDesc}>{gift.description}</p>}
      </section>

      <div className={styles.actionBar} data-keyboard-static>
        <p className={styles.summary} aria-live="polite">
          {setupSummary(first, venue, gift)}
        </p>
        {sameDate ? (
          <Button variant="primary" block onClick={() => go({ name: 'date' })}>
            Back to the date
          </Button>
        ) : (
          <Button variant="primary" block disabled={!venueId || !!otherDate || recovering} loading={starting} onClick={start}>
            Start the date
          </Button>
        )}
      </div>
    </main>
  )
}

/** Who the interrupted date was with: "Nova", or "Nova and Kai" for a group date. */
function interruptedWho(it: { name: string; names?: string[] }): string {
  return it.names?.length ? namesText(it.names.map((n) => firstName(n))) : firstName(it.name)
}

// ---------------------------------------------------------------------------
// Group date

interface Candidate {
  character: Character
  rel: Relationship
  /** What they are to the character whose profile this came from ("Nova's ex"), if anything. */
  relation: string
}

function GroupSetupView({ character }: { character: Character }) {
  const back = useNav((s) => s.back)
  const replace = useNav((s) => s.replace)
  const go = useNav((s) => s.go)
  const id = character.id
  const relationships = useGame((s) => s.relationships)
  const metamours = useGame((s) => s.game.metamours)
  const dateCount = useGame((s) => s.game.dateCount)
  const profile = useSettings((s) => s.profile)
  const mode = useSettings((s) => s.settings.orientationMode)
  const heat = useSettings((s) => s.settings.heat)
  const activeSets = useSettings((s) => s.settings.activeSets)
  const entries = useRoster((s) => s.entries)
  const sets = useRoster((s) => s.sets)
  const liveIds = useDate(liveCharacterIds)
  const interrupted = useDate((s) => s.interrupted)
  const relations = useRelationsFor(id, activeSets)

  useEffect(() => {
    void useDate.getState().findInterrupted()
  }, [])

  const name = character.name.trim() || id
  const first = firstName(name)
  const relOf = (x: string): Relationship => relationships[x] ?? newRelationship(x)
  const routeOf = (c: Character) => routeFor(c, profile, mode)

  // Everyone else in the active sets, the ones connected to this character first.
  const candidates: Candidate[] = useMemo(() => {
    const out: Candidate[] = []
    for (const e of selectActiveEntries({ sets, entries }, { activeSets, showMe: 'everyone' })) {
      if (e.character.id === id) continue
      const r = relations.find((x) => x.id === e.character.id)
      out.push({ character: e.character, rel: relationships[e.character.id] ?? newRelationship(e.character.id), relation: r ? relationTo(first, r.kind) : '' })
    }
    return out.sort(
      (a, b) =>
        Number(!!b.relation) - Number(!!a.relation) ||
        (b.rel.affection ?? 0) - (a.rel.affection ?? 0) ||
        a.character.name.localeCompare(b.character.name),
    )
  }, [sets, entries, activeSets, id, relations, relationships, first])

  const [otherPick, setOtherPick] = useState<string | null>(null)
  // Once someone is picked the list folds to them (with Change), so Between them sits right under it.
  const [changing, setChanging] = useState(false)
  const whoRef = useRef<HTMLElement>(null)
  const reduceMotion = useReducedMotion()
  const [picked, setPicked] = useState(0)
  useEffect(() => {
    if (!picked) return
    whoRef.current?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [picked, reduceMotion])
  const [venuePick, setVenuePick] = useState<string | null>(null)
  const [giftPick, setGiftPick] = useState<string>(NO_GIFT)
  const [giftFor, setGiftFor] = useState<string>(id)
  const [starting, setStarting] = useState(false)
  const [recovering, setRecovering] = useState(false)

  const other = candidates.find((c) => c.character.id === otherPick) ?? null
  const otherId = other?.character.id ?? null
  const otherFirst = other ? firstName(other.character.name.trim() || other.character.id) : ''
  const members = useMemo(() => {
    const list = [{ c: character, first }]
    if (other) list.push({ c: other.character, first: otherFirst })
    return list.map(({ c, first: f }) => ({ first: f, rel: relationships[c.id] ?? newRelationship(c.id), route: routeFor(c, profile, mode) }))
  }, [character, first, other, otherFirst, relationships, profile, mode])
  const venues = useMemo(() => groupVenueOptions(members), [members])
  const venueId = validVenue(venues.map((v) => ({ venue: v.venue, lock: v.lock })), venuePick)
  const venue = venueId ? venueById(venueId) : undefined
  const recipient = giftFor === otherId && other ? other.character : character
  const recipientRel = relOf(recipient.id)
  const gifts = useMemo(() => giftOptions(recipientRel, routeFor(recipient, profile, mode), heat), [recipientRel, recipient, profile, mode, heat])
  const giftId = validGift(gifts, giftPick === NO_GIFT ? null : giftPick)
  const gift = giftId ? giftById(giftId) : undefined
  const recipientFirst = recipient.id === id ? first : otherFirst
  const busy = liveIds.length > 0
  const busyNames = namesText(liveIds.map((x) => firstName(entries[x]?.character.name ?? x)))
  const style = { '--accent': portraitAccent(character.accent) } as CSSProperties

  // What the two are to each other, and how each feels about the player dating the other.
  const between = (() => {
    if (!other) return null
    const setRelations: SetRelationship[] = relations.map((r) => ({ a: id, b: r.id, kind: r.kind, note: r.note ?? '' }))
    const setOf: Record<string, string> = {}
    for (const x of [id, other.character.id]) if (entries[x]) setOf[x] = entries[x].setId
    const history = pairHistory(id, other.character.id, setRelations, setOf, (a, b) => setsLinked({ sets }, a, b))
    const game = { metamours: metamours ?? {} }
    const firsts = { [id]: first, [other.character.id]: otherFirst }
    const pair = [
      { c: character, o: other.character },
      { c: other.character, o: character },
    ]
    const feelings = pair.map(({ c, o }) =>
      feelingLine(
        groupFeeling({
          observer: c,
          rel: relOf(c.id),
          otherId: o.id,
          otherRel: relationships[o.id],
          route: routeOf(c),
          otherRoute: routeOf(o),
          approval: approval(game, c.id, o.id, setRelations),
          ...(dateCount != null ? { dateCount } : {}),
        }),
        firsts,
      ),
    )
    return { history: historyLines(first, otherFirst, history), feelings }
  })()

  const recover = async () => {
    setRecovering(true)
    try {
      const dateId = await useDate.getState().recoverInterrupted()
      if (dateId != null) replace({ name: 'recap', dateId })
    } finally {
      setRecovering(false)
    }
  }

  /** The gift goes to someone else: the picked gift stays when it's open for them too, or the player hears why it went. */
  const changeRecipient = (to: string) => {
    setGiftFor(to)
    if (!giftId) return
    const who = to === otherId && other ? other.character : character
    const whoFirst = who.id === id ? first : otherFirst
    const still = validGift(giftOptions(relOf(who.id), routeFor(who, profile, mode), heat), giftId)
    if (still) return
    setGiftPick(NO_GIFT)
    toast(`${giftById(giftId)?.name ?? 'That gift'} isn't open for ${whoFirst} yet, so no gift for now.`)
  }

  const start = async () => {
    if (!venueId || !otherId || starting) return
    setStarting(true)
    try {
      const r = await useDate.getState().startGroup([id, otherId], venueId, giftId ?? undefined, giftId ? recipient.id : undefined)
      if (r.ok) {
        replace({ name: 'date' })
        return
      }
      if (r.reason === 'busy') toast('Another date is still open. Finish it first.', 'error')
      else toast('One of them isn\'t on this device any more.', 'error')
    } finally {
      setStarting(false)
    }
  }

  return (
    <main className={`screen ${styles.root}`} style={style}>
      <TopBar
        title={
          <>
            A group date with <span className="name">{first}</span>
          </>
        }
        onBack={back}
      />

      <section className={styles.intro} aria-label={`Group date with ${name}`}>
        <span className={styles.pair}>
          <Portrait character={character} size="small" shape="round" className={styles.avatar} />
          {other && <Portrait character={other.character} size="small" shape="round" className={styles.avatar} />}
        </span>
        <p className={styles.introText}>
          Pick who else comes along, then where. {other ? `${first} and ${otherFirst}` : `${first} and whoever you bring`} react to the venue, to you
          and to each other.
        </p>
      </section>

      <KindPicker id={id} group />

      {interrupted && !busy && (
        <Note tone="brass" title={`Your last date with ${interruptedWho(interrupted)} was interrupted`}>
          <p>crushLAB closed partway through it. See how it went, or start this one and leave it be.</p>
          <div className={styles.noteActions}>
            <Button variant="secondary" size="small" loading={recovering} disabled={starting} onClick={recover}>
              See how it went
            </Button>
          </div>
        </Note>
      )}

      {busy && (
        <Note tone="brass" title={`Your date with ${busyNames} is still open`}>
          <p>Finish or end it before starting another.</p>
          <div className={styles.noteActions}>
            <Button variant="secondary" size="small" onClick={() => go({ name: 'date' })}>
              Back to that date
            </Button>
          </div>
        </Note>
      )}

      <section className={styles.section} aria-labelledby="who-title" ref={whoRef}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="who-title">
            Who comes along
          </h2>
          <p className={styles.caption}>Anyone from your active sets. History between them makes for a livelier night.</p>
        </div>
        {candidates.length === 0 ? (
          <p className={styles.caption}>Nobody else is in town. Turn on another set in Character sets.</p>
        ) : (
          <div className={styles.people} role="radiogroup" aria-labelledby="who-title">
            {candidates.filter((c) => changing || !other || c.character.id === otherId).map((c) => {
              const checked = otherId === c.character.id
              const cname = c.character.name.trim() || c.character.id
              const meta = [c.relation, stageLabel(stageFor(c.rel.affection))].filter(Boolean).join(', ')
              return (
                <label
                  key={c.character.id}
                  className={cx(styles.person, checked && styles.checked)}
                  style={{ '--accent': portraitAccent(c.character.accent) } as CSSProperties}
                >
                  <input
                    type="radio"
                    name="other"
                    value={c.character.id}
                    className={styles.radio}
                    checked={checked}
                    onChange={() => {
                      setOtherPick(c.character.id)
                      setChanging(false)
                      setPicked((n) => n + 1)
                      if (giftFor !== id) changeRecipient(id)
                    }}
                  />
                  <Portrait character={c.character} size="small" shape="round" className={styles.personArt} />
                  <span className={styles.personText}>
                    <span className={cx(styles.personName, 'name')}>{cname}</span>
                    <span className={styles.personMeta}>{meta}</span>
                  </span>
                  {checked && (
                    <span className={styles.check}>
                      <CheckIcon />
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        )}
        {other && !changing && candidates.length > 1 && (
          <Button variant="secondary" size="small" className={styles.change} onClick={() => setChanging(true)}>
            Change who comes along
          </Button>
        )}
      </section>

      {other && between && (
        <Panel title="Between them" tone="brass" className={styles.section}>
          <ul className={styles.between}>
            {between.history.map((h) => (
              <li key={h.line}>
                <p className={styles.betweenLine}>{h.line}</p>
                {h.note && <p className={styles.betweenNote}>{h.note}</p>}
              </li>
            ))}
            {between.feelings.map((f) => (
              <li key={f.text} className={cx(styles.feeling, styles[f.tone])}>
                {f.text}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <section className={styles.section} aria-labelledby="venue-title">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="venue-title">
            Where to
          </h2>
          <p className={styles.caption}>Each of them reacts to the venue: somewhere one loves may be somewhere the other hates.</p>
        </div>
        <div className={styles.venues} role="radiogroup" aria-labelledby="venue-title">
          {venues.map(({ venue: v, lock, known }) => {
            const checked = venueId === v.id
            return (
              <label key={v.id} className={cx(styles.venue, checked && styles.checked, lock && styles.locked)}>
                <input
                  type="radio"
                  name="venue"
                  value={v.id}
                  className={styles.radio}
                  checked={checked}
                  disabled={!!lock}
                  onChange={() => setVenuePick(v.id)}
                  aria-describedby={`gvenue-${v.id}-desc`}
                />
                <Backdrop venue={v} fill scrim className={styles.venueArt} />
                <span className={styles.venueText}>
                  <span className={styles.venueName}>{v.name}</span>
                  <span className={styles.venueDesc} id={`gvenue-${v.id}-desc`}>
                    {v.description}
                    {lock ? ` ${lock}.` : known.length ? ` ${known.map((k) => knownVenueFor(k.first, k.reaction)).join('. ')}.` : ''}
                  </span>
                  {lock ? (
                    <span className={styles.lock} aria-hidden="true">
                      <LockIcon />
                      {lock}
                    </span>
                  ) : (
                    known.map((k) => (
                      <span key={k.first} className={cx(styles.known, styles[k.reaction])} aria-hidden="true">
                        {knownVenueFor(k.first, k.reaction)}
                      </span>
                    ))
                  )}
                </span>
                {checked && (
                  <span className={styles.check}>
                    <CheckIcon />
                  </span>
                )}
              </label>
            )
          })}
        </div>
        {venue && <p className={styles.pickDesc}>{venue.description}</p>}
      </section>

      <section className={styles.section} aria-labelledby="gift-title">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="gift-title">
            Bring a gift
          </h2>
          <p className={styles.caption}>Optional, and for one of them. The other notices.</p>
        </div>
        {other && (
          <Segmented
            aria-label="Who the gift is for"
            value={recipient.id}
            onChange={(v) => changeRecipient(v)}
            options={[
              { value: id, label: `For ${first}` },
              { value: other.character.id, label: `For ${otherFirst}` },
            ]}
          />
        )}
        <div className={styles.gifts} role="radiogroup" aria-labelledby="gift-title">
          <label className={cx(styles.gift, giftId === null && styles.checked)}>
            <input type="radio" name="gift" value={NO_GIFT} className={styles.radio} checked={giftId === null} onChange={() => setGiftPick(NO_GIFT)} />
            <span className={styles.giftName}>No gift</span>
            <span className={styles.giftMeta}>Just you</span>
            {giftId === null && (
              <span className={styles.check}>
                <CheckIcon />
              </span>
            )}
          </label>
          {gifts.map(({ gift: g, lock, known }) => {
            const checked = giftId === g.id
            return (
              <label key={g.id} className={cx(styles.gift, checked && styles.checked, lock && styles.locked)}>
                <input
                  type="radio"
                  name="gift"
                  value={g.id}
                  className={styles.radio}
                  checked={checked}
                  disabled={!!lock}
                  onChange={() => setGiftPick(g.id)}
                />
                <span className={styles.giftName}>{g.name}</span>
                {lock ? (
                  <span className={styles.lock}>
                    <LockIcon />
                    {lock}
                  </span>
                ) : known ? (
                  <span className={cx(styles.known, styles[known])}>
                    {recipientFirst}: {knownGiftText(known).toLowerCase()}
                  </span>
                ) : (
                  <span className={styles.giftMeta}>Not tried yet</span>
                )}
                {checked && (
                  <span className={styles.check}>
                    <CheckIcon />
                  </span>
                )}
              </label>
            )
          })}
        </div>
        {gift && <p className={styles.pickDesc}>{gift.description}</p>}
      </section>

      <div className={styles.actionBar} data-keyboard-static>
        <p className={styles.summary} aria-live="polite">
          {groupSummary(other ? [first, otherFirst] : [first], venue, gift, gift ? recipientFirst : undefined)}
        </p>
        <Button variant="primary" block disabled={!venueId || !otherId || busy || recovering} loading={starting} onClick={start}>
          Start the group date
        </Button>
      </div>
    </main>
  )
}
