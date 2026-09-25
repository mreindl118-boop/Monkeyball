// Date setup (#/date-setup/:id): pick a venue and an optional gift, then start the date. Venues
// show their backdrop; locked ones (home before Lover) show the requirement; venues and gifts the
// character reacted to before show that reaction. Group dates arrive in Phase 6.

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Portrait } from '../../art/Portrait'
import { portraitAccent } from '../../art/Portrait.model'
import { giftById } from '../../data/gifts'
import { venueById } from '../../data/venues'
import { newRelationship } from '../../engine/relationship'
import { routeFor } from '../../engine/stages'
import { liveCharacterId, useDate } from '../../store/date'
import { useGame } from '../../store/game'
import { useNav } from '../../store/nav'
import { useRoster } from '../../store/roster'
import { useSettings } from '../../store/settings'
import type { Character, Relationship } from '../../types'
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
import { giftOptions, knownGiftText, knownVenueText, setupSummary, validGift, validVenue, venueOptions } from './setupModel'

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
  const ready = useRosterAndGame()
  const entry = useRoster((s) => s.entries[id])

  if (!entry) {
    return (
      <main className="screen">
        <TopBar title="Ask on a date" onBack={back} />
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
  return <SetupView character={entry.character} />
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
  const otherDate = liveId && liveId !== id ? liveId : null
  const sameDate = liveId === id
  const otherName = otherDate ? firstName(entries[otherDate]?.character.name ?? otherDate) : ''
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

      <div className={styles.kind}>
        <Segmented
          aria-label="Kind of date"
          value="single"
          onChange={() => undefined}
          options={[
            { value: 'single', label: 'Just the two of you' },
            { value: 'group', label: 'Group date', disabled: true },
          ]}
        />
        <p className={styles.caption}>Group dates arrive in a later update.</p>
      </div>

      {interrupted && !liveId && (
        <Note tone="brass" title={`Your last date with ${firstName(interrupted.name)} was interrupted`}>
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
