// The date (#/date): a visual-novel layout over the venue's backdrop. The character's portrait
// stands above a text box that holds the transcript (actions in italics, a caret while the reply
// streams), the suggestion chips (tapping fills the input, never sends) and the composer. The
// status strip at the top shows mood, stage stamps and, expanded, the meters; the judge's hint and
// the per-turn deltas only with the Hints setting. Android first: the layout is 100dvh, so the
// soft keyboard shrinks it and the composer and the latest reply stay above the keyboard; the
// back button asks before ending the date.

import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { Portrait } from '../../art/Portrait'
import { portraitAccent } from '../../art/Portrait.model'
import { HEAT_LEVELS } from '../../data/heat'
import { VENUES, venueById } from '../../data/venues'
import { canOpenDtr, canQueueSend, canRetry, dateGainUsed, dtrOpen, routeOf, type DateSession } from '../../engine/dateFlow'
import { applyDifficulty } from '../../engine/math'
import { affectionCap, stageFor } from '../../engine/stages'
import { tap } from '../../platform/haptics'
import { pushOverlay } from '../../platform/overlays'
import { useDate, type InterruptedDate } from '../../store/date'
import { useNav } from '../../store/nav'
import { useSettings } from '../../store/settings'
import type { AgreementType, DateTurn, Route } from '../../types'
import { Backdrop } from '../../ui/Backdrop'
import { Button } from '../../ui/Button'
import { Toggle } from '../../ui/Toggle'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { cx } from '../../ui/cx'
import { HeatControl } from '../../ui/HeatControl'
import { Kiss } from '../../ui/Kiss'
import { LipstickStamps } from '../../ui/LipstickStamps'
import { Meter } from '../../ui/Meter'
import { Note, Panel } from '../../ui/Panel'
import { Sheet } from '../../ui/Sheet'
import { toast } from '../../ui/toastStore'
import { TopBar } from '../../ui/TopBar'
import {
  composerPlaceholder,
  deltaText,
  groupEndLine,
  groupPeople,
  groupPlaceholder,
  groupStatusText,
  namesText,
  dtrVisible,
  fillFromChip,
  firstName,
  gainCapped,
  inputLocked,
  lastApplied,
  lastBetrayal,
  betrayalHint,
  lastCharacterLine,
  moodWord,
  statusText,
  suggestionChips,
  turnLabel,
  visibleTurns,
} from './dateModel'
import styles from './DateScreen.module.css'
import { DtrOffer, DtrOpen, DtrResult, DtrSheet } from './Dtr'
import type { DtrChoiceType } from './dtrModel'
import { endingTitle } from '../Ending/useEnding'
import { StoryText } from './StoryText'
import { GroupLine, GroupStage, GroupStatusStrip, GroupStreaming } from './GroupParts'

export default function DateScreen() {
  const session = useDate((s) => s.session)
  return session ? <DateView session={session} /> : <NoDate />
}

// ---------------------------------------------------------------------------
// No session: an interrupted date, or nothing (back to the hub)

function interruptedText(it: InterruptedDate): string {
  const first = it.names?.length ? namesText(it.names.map((n) => firstName(n))) : firstName(it.name)
  const n = it.turns
  const inside = n > 0 ? `, ${n} ${n === 1 ? 'message' : 'messages'} in` : ''
  return `crushLAB closed partway through your date with ${first}${inside}. What happened so far is saved.`
}

function NoDate() {
  const replace = useNav((s) => s.replace)
  const reset = useNav((s) => s.reset)
  const interrupted = useDate((s) => s.interrupted)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState<'recap' | 'hub' | null>(null)

  useEffect(() => {
    let alive = true
    void useDate
      .getState()
      .findInterrupted()
      .then((it) => {
        if (!alive) return
        setChecked(true)
        if (!it) replace({ name: 'hub' })
      })
    return () => {
      alive = false
    }
  }, [replace])

  if (!checked || !interrupted) {
    return (
      <main className="screen">
        <p className={styles.looking} role="status">
          Looking for your date
        </p>
      </main>
    )
  }

  const recover = async () => {
    setBusy('recap')
    try {
      const id = await useDate.getState().recoverInterrupted()
      if (id != null) useNav.getState().replace({ name: 'recap', dateId: id })
      else useNav.getState().replace({ name: 'hub' })
    } finally {
      setBusy(null)
    }
  }

  const toHub = async () => {
    setBusy('hub')
    try {
      await useDate.getState().dropInterrupted()
    } finally {
      setBusy(null)
      reset({ name: 'hub' })
    }
  }

  return (
    <main className={`screen ${styles.lost}`}>
      <TopBar title="Date" />
      <Panel title="This date was interrupted" description={interruptedText(interrupted)}>
        <div className={styles.lostActions}>
          <Button variant="primary" loading={busy === 'recap'} disabled={busy === 'hub'} onClick={recover}>
            See how it went
          </Button>
          <Button variant="secondary" loading={busy === 'hub'} disabled={busy === 'recap'} onClick={toHub}>
            Back to the hub
          </Button>
        </div>
      </Panel>
    </main>
  )
}

// ---------------------------------------------------------------------------
// The date

/** A stamp press and a light haptic whenever affection moves. */
function useAffectionPress(affection: number): { n: number; dir: 'up' | 'down' } | null {
  const [seen, setSeen] = useState(affection)
  const [press, setPress] = useState<{ n: number; dir: 'up' | 'down' } | null>(null)
  if (seen !== affection) {
    setSeen(affection)
    setPress({ n: (press?.n ?? 0) + 1, dir: affection > seen ? 'up' : 'down' })
  }
  useEffect(() => {
    if (press) void tap()
  }, [press])
  return press
}

function StatusStrip({
  session,
  hints,
  route,
  onHeat,
  dtr,
}: {
  session: DateSession
  hints: boolean
  route: Route
  /** Opens the heat sheet. */
  onHeat: () => void
  /** Define the relationship: whether it can open now, and how to open it. */
  dtr: { can: boolean; talking: boolean; onOpen: () => void }
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const dtrNote = useId()
  const rel = session.rel
  const stage = stageFor(rel.affection)
  const press = useAffectionPress(rel.affection)
  const judge = session.lastJudge
  const character = session.world.character
  const applied = lastApplied(session.record, character.id)
  // A betrayal turn says what broke, not the judge's reaction to the words.
  const betrayal = judge ? lastBetrayal(session.record, character.id) : undefined
  const hint = hints && judge ? (betrayal ? betrayalHint(betrayal, character.name) : judge.hint.trim()) : ''
  const wanted = judge ? applyDifficulty(judge.delta, character.difficulty) : 0
  const capped = gainCapped(wanted, applied?.affection, dateGainUsed(session), session.world.settings.gainCap)
  const heat = useSettings((s) => s.settings.heat)
  const heatInfo = HEAT_LEVELS.find((h) => h.level === heat) ?? HEAT_LEVELS[0]
  const deltas = hints && judge ? deltaText(applied, capped, rel.affection <= 0) : ''
  const cap = affectionCap(route)

  return (
    <section className={styles.status} aria-label="How it's going">
      <button
        type="button"
        className={styles.statusToggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Kiss
          key={press?.n ?? 0}
          className={cx(styles.moodKiss, press && styles.pressed, press?.dir === 'down' && styles.down)}
        />
        <span className={styles.moodText}>
          <span className={styles.moodLabel}>Mood</span>
          <span className={styles.mood}>{moodWord(betrayal ? (betrayal.kind === 'lie' ? 'betrayed' : 'hurt') : judge?.mood)}</span>
        </span>
        <LipstickStamps stage={stage} size="small" />
        <span className={styles.toggleText}>{open ? 'Less' : 'More'}</span>
      </button>
      {(hint || deltas) && (
        <p className={styles.hintLine}>
          {hint && <em className={styles.hint}>{hint}</em>}
          {deltas && <span className={styles.deltas}>{deltas}</span>}
        </p>
      )}
      {open && (
        <div id={panelId} className={styles.statusPanel}>
          <Meter
            kind="affection"
            value={rel.affection}
            cap={route === 'friend' ? cap : undefined}
            capNote={route === 'friend' ? `On a friend route affection stops at ${cap}.` : undefined}
          />
          <Meter kind="trust" value={rel.trust} />
          <LipstickStamps stage={stage} showLabel animate={false} />
          <div className={styles.heatRow}>
            <p className={styles.heatText}>
              <Kiss className={styles.heatKiss} filled />
              Heat {heatInfo.level}, {heatInfo.name}
            </p>
            <Button variant="secondary" size="small" className={styles.tap} aria-label={`Heat ${heatInfo.level}, ${heatInfo.name}. Change heat`} onClick={onHeat}>
              Change heat
            </Button>
          </div>
          {!hints && (
            <Toggle
              checked={false}
              onChange={(on) => void useSettings.getState().update({ hints: on })}
              label="Hints"
              description="See how each message landed: the hint, and what it did to affection and trust."
            />
          )}
          {dtrVisible(rel.affection) && route === 'romantic' && session.record.kind !== 'epilogue' && (
            <div className={styles.dtr}>
              <Button variant="brass" className={styles.tap} disabled={!dtr.can} aria-describedby={dtrNote} onClick={dtr.onOpen}>
                Define the relationship
              </Button>
              <p className={styles.caption} id={dtrNote}>
                {dtr.talking
                  ? 'The talk is open. Close it when you have said your piece.'
                  : session.record.dtr
                    ? 'You talked about what you are on this date.'
                    : dtr.can
                      ? 'Ask what you are: exclusive, open, poly or keep it casual.'
                      : 'On your turn, with a turn left to talk.'}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Turn({
  turn,
  retry,
  onHeat,
  session,
}: {
  turn: DateTurn
  retry?: () => void
  onHeat?: () => void
  /** A group date: character lines carry their speaker's name. */
  session?: DateSession
}) {
  if (turn.role === 'player') {
    return (
      <div className={styles.you}>
        <span className={styles.youLabel}>You</span>
        <p className={styles.youText}>{turn.text}</p>
      </div>
    )
  }
  if (turn.role === 'system') {
    return (
      <div className={cx(styles.system, turn.notice === 'error' && styles.systemError)} role="note">
        <p>{turn.text}</p>
        {retry && (
          <Button variant="secondary" size="small" onClick={retry}>
            Try again
          </Button>
        )}
        {onHeat && (
          <Button variant="secondary" size="small" onClick={onHeat}>
            Change heat
          </Button>
        )}
      </div>
    )
  }
  const g = session?.group
  if (g) return <GroupLine character={turn.speaker ? g.members[turn.speaker]?.world.character : undefined} text={turn.text} />
  return (
    <div className={styles.line}>
      <StoryText text={turn.text} />
    </div>
  )
}

function endLine(session: DateSession, first: string): string {
  if (session.status === 'closing') return session.leaving ? `${first} is leaving.` : 'Wrapping up the date.'
  switch (session.record.outcome) {
    case 'left':
      return `${first} left.`
    case 'ended':
      return 'You ended the date.'
    default:
      return 'That was the last turn.'
  }
}

/** A cancel scheduled by the date screen's unmount, called off if it mounts again right away. */
let pendingCancel: ReturnType<typeof setTimeout> | null = null

function DateView({ session }: { session: DateSession }) {
  const running = useDate((s) => s.running)
  const problem = useDate((s) => s.problem)
  const draft = useDate((s) => s.draft)
  const finishedId = useDate((s) => s.finishedId)
  const storageError = useDate((s) => s.storageError)
  const hints = useSettings((s) => s.settings.hints)
  const replace = useNav((s) => s.replace)
  const heat = useSettings((s) => s.settings.heat)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [heatOpen, setHeatOpen] = useState(false)
  const [dtrSheet, setDtrSheet] = useState(false)
  const offerDismissed = useDate((s) => s.dtrOfferDismissed)
  const inputId = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  /** The composer had focus when the message went: keep it (and the soft keyboard) for the next. */
  const keepFocus = useRef(false)

  const { character } = session.world
  // A group date (Phase 6): both of them, by first name; those who walked out are left out of the copy.
  const people = groupPeople(session)
  const group = people.length > 0
  const present = people.filter((p) => !p.gone).map((p) => p.first)
  const first = group ? namesText(present.length ? present : people.map((p) => p.first)) : firstName(character.name)
  const venue = venueById(session.record.venueId) ?? VENUES[0]
  const route = routeOf(session.world)
  const status = session.status
  const over = status === 'closing' || status === 'ended'
  const locked = inputLocked(status) || running === 'finish'
  // While chips load ('suggesting') the player can already send: the store skips the chips first.
  const sendable = !locked && canQueueSend(session) && (running === null || status === 'suggesting')
  const retryable = !running && !over && canRetry(session)
  const turns = visibleTurns(session.record.turns)
  let lastError = -1
  let lastRefused = -1
  turns.forEach((t, i) => {
    if (t.role === 'system' && t.notice === 'error') lastError = i
    if (t.role === 'system' && t.notice === 'refused') lastRefused = i
  })
  const streaming = status === 'replying' ? session.streaming : ''
  const thinking = !streaming && (status === 'judging' || status === 'replying' || status === 'opening')
  const chips = status === 'awaiting-player' && !running ? suggestionChips(session.suggestions, route) : []
  const status1 =
    running === 'dtr'
      ? `${first} is thinking about what you are`
      : group
        ? groupStatusText(status, present.length ? present : people.map((p) => p.first))
        : statusText(status, character.name)
  const style = { '--accent': portraitAccent(character.accent) } as CSSProperties

  // Define the relationship: the character's offer, the open talk, the way in, and the outcome.
  const talking = dtrOpen(session) && !over
  const dtrCan = !locked && !talking && (running === null || status === 'suggesting') && canOpenDtr(session)
  // Their offer waits for the player's turn (the opening beat comes first).
  const offer: AgreementType | null = session.dtrOffer && !offerDismissed && dtrCan ? session.dtrOffer : null
  const dtrResult = session.record.dtr?.closedAt != null && session.record.dtr.result ? session.record.dtr : null
  // The outcome sits after the talk's last turn (or at the end when no turn was flagged).
  let lastDtrTurn = -1
  turns.forEach((t, i) => {
    if (t.dtr) lastDtrTurn = i
  })
  const resultAfter = dtrResult ? (lastDtrTurn >= 0 ? lastDtrTurn : turns.length - 1) : -2
  const epilogue = session.record.kind === 'epilogue'
  const endingName = epilogue ? endingTitle(session.ending?.type ?? session.record.endingType) : ''

  const askDtr = (type: DtrChoiceType) => {
    setDtrSheet(false)
    stick.current = true
    void useDate
      .getState()
      .openDtr(type)
      .then((ok) => {
        if (!ok) toast("That can't start right now. Try again on your turn.", 'info')
        else inputRef.current?.focus({ preventScroll: true })
      })
  }

  const closeTalk = () => {
    stick.current = true
    void useDate.getState().closeDtr()
  }

  // Back on the screen after stepping away: pick up a reply that was stopped. Leaving stops the
  // call in flight (the date stays open); the stop waits a tick so a remount (React's strict mode
  // in development) doesn't cancel a reply that is still wanted. A date that already ended goes
  // straight to its recap.
  useEffect(() => {
    if (pendingCancel) {
      clearTimeout(pendingCancel)
      pendingCancel = null
    }
    const st = useDate.getState()
    if (st.finishedId != null && st.session?.status === 'ended') {
      replace({ name: 'recap', dateId: st.finishedId })
      return
    }
    void st.resume()
    return () => {
      pendingCancel = setTimeout(() => {
        pendingCancel = null
        useDate.getState().cancel()
      }, 0)
    }
  }, [replace])

  // Back to the player's turn after sending from the composer: keep the field focused, so the soft
  // keyboard stays up from one turn to the next.
  useEffect(() => {
    if (status !== 'awaiting-player' && status !== 'suggesting') return
    if (!keepFocus.current) return
    keepFocus.current = false
    const el = inputRef.current
    if (el && document.activeElement !== el) el.focus({ preventScroll: true })
  }, [status])

  // The Android back button asks before ending the date (the dialog then takes the next press).
  useEffect(() => {
    if (confirmOpen) return
    return pushOverlay(() => {
      const st = useDate.getState()
      if (st.finishedId != null) replace({ name: 'recap', dateId: st.finishedId })
      else if (st.session && st.session.status !== 'closing') setConfirmOpen(true)
    })
  }, [confirmOpen, replace])

  useEffect(() => {
    if (storageError) toast("This date isn't being saved on this device; it lasts until crushLAB closes.", 'error', 8000)
  }, [storageError])

  // Keep the latest line in view (also when the soft keyboard shrinks the box), unless the player
  // scrolled up to reread.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [turns.length, session.streaming, status, chips.length])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Only the player scrolling up lets go of the end. A scroll the layout causes (the soft keyboard
  // resizing the box clamps scrollTop, and the scroll event can arrive after the next resize) must
  // not: that would leave the latest line out of view with the keyboard up.
  const lastScroll = useRef({ top: 0, client: 0 })
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    const last = lastScroll.current
    if (atEnd) stick.current = true
    else if (el.clientHeight === last.client && el.scrollTop < last.top) stick.current = false
    lastScroll.current = { top: el.scrollTop, client: el.clientHeight }
  }

  const submit = () => {
    if (!sendable || !draft.trim()) return
    stick.current = true
    keepFocus.current = typeof document !== 'undefined' && document.activeElement === inputRef.current
    void useDate.getState().send(draft)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const fill = (text: string) => {
    const next = fillFromChip(draft, text, chips.map((c) => c.text))
    useDate.getState().setDraft(next)
    const el = inputRef.current
    if (el) {
      el.focus({ preventScroll: true })
      requestAnimationFrame(() => el.setSelectionRange(next.length, next.length))
    }
  }

  const retry = () => {
    stick.current = true
    void useDate.getState().retry()
  }

  const endDate = async () => {
    const id = await useDate.getState().end()
    setConfirmOpen(false)
    if (id != null) replace({ name: 'recap', dateId: id })
  }

  const toRecap = () => {
    if (finishedId != null) replace({ name: 'recap', dateId: finishedId })
  }

  return (
    <main className={styles.root} style={style} aria-label={group ? `Group date with ${namesText(people.map((p) => p.character.name))}` : `Date with ${character.name}`}>
      <Backdrop venue={venue} fill scrim className={styles.backdrop} />

      <div className={styles.column}>
        <header className={styles.top}>
          <div className={styles.where}>
            <p className={styles.venueName}>{venue.name}</p>
            <p className={styles.turn}>
              {turnLabel(session.record, over || session.leaving)}
              {epilogue && <span className={styles.epilogueTag}>{endingName ? `Epilogue, ${endingName.charAt(0).toLowerCase()}${endingName.slice(1)}` : 'Epilogue'}</span>}
            </p>
          </div>
          <Button variant="ghost" className={styles.endButton} disabled={over} onClick={() => setConfirmOpen(true)}>
            End date
          </Button>
        </header>

        {group ? (
          <GroupStatusStrip session={session} hints={hints} onHeat={() => setHeatOpen(true)} />
        ) : (
          <StatusStrip
            session={session}
            hints={hints}
            route={route}
            onHeat={() => setHeatOpen(true)}
            dtr={{ can: dtrCan, talking, onOpen: () => setDtrSheet(true) }}
          />
        )}

        {group ? (
          <GroupStage session={session} />
        ) : (
          <div className={styles.stageArea} aria-hidden="true">
            <Portrait character={character} size="small" thumb={false} className={styles.portrait} />
          </div>
        )}

        <section className={styles.box} aria-label="The conversation">
          <p className={styles.plate}>
            <span className="name">{first}</span>
          </p>

          <div className={styles.transcript} ref={scrollRef} onScroll={onScroll}>
            {turns.map((t, i) => (
              <Fragment key={i}>
                <Turn
                  turn={t}
                  retry={i === lastError && retryable ? retry : undefined}
                  onHeat={i === lastRefused && !over ? () => setHeatOpen(true) : undefined}
                  session={group ? session : undefined}
                />
                {i === resultAfter && dtrResult && <DtrResult name={character.name} dtr={dtrResult} current={session.rel.agreement?.type ?? 'none'} />}
              </Fragment>
            ))}
            {resultAfter === -1 && dtrResult && <DtrResult name={character.name} dtr={dtrResult} current={session.rel.agreement?.type ?? 'none'} />}
            {streaming &&
              (group ? (
                <GroupStreaming session={session} text={streaming} />
              ) : (
                <div className={styles.line}>
                  <StoryText text={streaming} streaming />
                </div>
              ))}
            {thinking && (
              <p className={styles.thinking}>
                <span className="visually-hidden">{status1}</span>
                <span className={styles.dots} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </p>
            )}
            {retryable && lastError < 0 && (
              <div className={styles.system} role="note">
                <p>{first}'s reply was stopped before it arrived.</p>
                <Button variant="secondary" size="small" onClick={retry}>
                  Try again
                </Button>
              </div>
            )}
          </div>
          <p className="visually-hidden" aria-live="polite">
            {lastCharacterLine(session.record.turns)}
          </p>

          {problem && (
            <Note tone="lipstick" role="alert" title="Something went wrong" className={styles.problem}>
              <p>{problem.message}</p>
              <Button variant="secondary" size="small" onClick={retry}>
                Try again
              </Button>
            </Note>
          )}

          {over ? (
            <div className={styles.endBar}>
              <p className={styles.endText}>
                {group
                  ? groupEndLine(
                      status,
                      session.record.outcome,
                      people.filter((p) => p.gone || session.group?.members[p.character.id]?.leaving).map((p) => p.first),
                      people.map((p) => p.first),
                    )
                  : endLine(session, first)}
              </p>
              <Button variant="primary" block loading={finishedId == null} onClick={toRecap}>
                See how it went
              </Button>
            </div>
          ) : (
            <>
              {offer ? (
                <DtrOffer
                  name={character.name}
                  offer={offer}
                  onTalk={() => setDtrSheet(true)}
                  onLater={() => useDate.getState().dismissDtrOffer()}
                />
              ) : talking && session.record.dtr ? (
                <DtrOpen
                  name={character.name}
                  dtr={session.record.dtr}
                  closing={running === 'dtr'}
                  disabled={locked || (running !== null && running !== 'dtr' && status !== 'suggesting')}
                  onClose={closeTalk}
                />
              ) : dtrCan ? (
                <div className={styles.dtrEntry}>
                  <Button variant="brass" size="small" className={styles.tap} onClick={() => setDtrSheet(true)}>
                    Define the relationship
                  </Button>
                </div>
              ) : null}
              {chips.length > 0 && (
                <div className={styles.chips} role="group" aria-label="Things you could say">
                  {chips.map((c) => (
                    <button key={c.key} type="button" className={styles.chip} onClick={() => fill(c.text)}>
                      <span className={styles.chipKind}>{c.label}</span>
                      <span className={styles.chipText}>{c.text}</span>
                    </button>
                  ))}
                </div>
              )}
              {/* While the composer is locked its placeholder already says this; the line stays for
                  screen readers. */}
              <p className={cx(styles.statusLine, locked && 'visually-hidden')} role="status" aria-live="polite">
                {status1}
              </p>
              <form className={styles.composer} onSubmit={onSubmit} data-keyboard-static>
                <label htmlFor={inputId} className="visually-hidden">
                  Your message to {first}
                </label>
                <textarea
                  id={inputId}
                  ref={inputRef}
                  className={styles.input}
                  rows={1}
                  value={draft}
                  maxLength={1000}
                  enterKeyHint="send"
                  placeholder={group ? groupPlaceholder(status, present) : composerPlaceholder(status, character.name)}
                  // Read-only rather than disabled while the character talks: disabling a focused
                  // field drops its focus, and on Android the soft keyboard with it.
                  readOnly={locked}
                  aria-disabled={locked || undefined}
                  onChange={(e) => {
                    if (!locked) useDate.getState().setDraft(e.target.value)
                  }}
                  onKeyDown={onKeyDown}
                />
                <Button
                  type="submit"
                  variant="primary"
                  className={styles.send}
                  disabled={!sendable || !draft.trim()}
                  // Tapping Send leaves the focus (and the keyboard) in the field.
                  onMouseDown={(e) => e.preventDefault()}
                >
                  Send
                </Button>
              </form>
            </>
          )}
        </section>
      </div>

      <Sheet
        open={heatOpen}
        onClose={() => setHeatOpen(false)}
        title="Tonight's heat"
        description="How far the story goes, from the next reply on. Characters react to it as themselves."
        footer={
          <Button variant="primary" onClick={() => setHeatOpen(false)}>
            Done
          </Button>
        }
      >
        <HeatControl value={heat} onChange={(h) => void useSettings.getState().update({ heat: h })} />
      </Sheet>

      <DtrSheet
        open={dtrSheet}
        name={character.name}
        offer={offer}
        current={session.rel.agreement?.type ?? 'none'}
        onAsk={askDtr}
        onClose={() => setDtrSheet(false)}
      />

      <ConfirmDialog
        open={confirmOpen}
        title="End the date?"
        message={
          talking
            ? `${first} will remember how it went and answer what you asked about what you are. The recap shows what changed. Seeing a date through builds a little trust.`
            : `${first} will remember how it went, and the recap shows what changed. Seeing a date through builds a little trust.`
        }
        confirmLabel="End date"
        cancelLabel="Keep going"
        onConfirm={endDate}
        onCancel={() => setConfirmOpen(false)}
      />
    </main>
  )
}
