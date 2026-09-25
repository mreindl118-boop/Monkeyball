// The date screen's group date pieces (Phase 6): both portraits, a status strip with a row per
// character (mood and stamps; meters, the heat and the hints for each when expanded), and the
// speaker plate over each character's lines.

import { useEffect, useId, useState, type CSSProperties } from 'react'
import { Portrait } from '../../art/Portrait'
import { portraitAccent } from '../../art/Portrait.model'
import { HEAT_LEVELS } from '../../data/heat'
import { dateGainUsed, routeOf, type DateSession } from '../../engine/dateFlow'
import { memberView, parseGroupReply, presentIds } from '../../engine/groupDate'
import { applyDifficulty } from '../../engine/math'
import { affectionCap, stageFor } from '../../engine/stages'
import { tap } from '../../platform/haptics'
import { useSettings } from '../../store/settings'
import type { Character } from '../../types'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Kiss } from '../../ui/Kiss'
import { LipstickStamps } from '../../ui/LipstickStamps'
import { Meter } from '../../ui/Meter'
import { Toggle } from '../../ui/Toggle'
import { betrayalHint, deltaText, firstName, gainCapped, groupPeople, lastApplied, lastBetrayal, moodWord } from './dateModel'
import styles from './DateScreen.module.css'
import { StoryText } from './StoryText'

/** Both portraits over the text box; one who walked out steps out of the picture. */
export function GroupStage({ session }: { session: DateSession }) {
  const people = groupPeople(session).filter((p) => !p.gone)
  return (
    <div className={cx(styles.stageArea, styles.stagePair)} aria-hidden="true">
      {people.map((p) => (
        <span key={p.character.id} className={styles.pairSlot} style={{ '--accent': portraitAccent(p.character.accent) } as CSSProperties}>
          <Portrait character={p.character} size="small" thumb={false} className={styles.pairPortrait} />
        </span>
      ))}
    </div>
  )
}

/** A character's lines with their name over them, in their accent. */
export function GroupLine({ character, text, streaming = false }: { character: Character | undefined; text: string; streaming?: boolean }) {
  const style = character ? ({ '--speaker': portraitAccent(character.accent) } as CSSProperties) : undefined
  return (
    <div className={cx(styles.line, styles.groupLine)} style={style}>
      {character && <span className={cx(styles.speaker, 'name')}>{firstName(character.name)}</span>}
      <StoryText text={text} streaming={streaming} />
    </div>
  )
}

/** The reply as it streams in, split by speaker as it will land. */
export function GroupStreaming({ session, text }: { session: DateSession; text: string }) {
  const g = session.group
  if (!g) return null
  const ids = presentIds(session)
  // Everyone is a speaker so a line for someone who already left is recognized and left out, as
  // it will be when the reply lands.
  const speakers = g.ids.map((id) => ({ id, name: g.members[id].world.character.name }))
  const parts = parseGroupReply(text, speakers, ids[0] ?? g.ids[0]).filter((p) => ids.includes(p.speaker))
  return (
    <>
      {parts.map((p, i) => (
        <GroupLine key={i} character={g.members[p.speaker]?.world.character} text={p.text} streaming={i === parts.length - 1} />
      ))}
    </>
  )
}

/** A stamp press and a light haptic whenever this character's affection moves. */
function usePress(affection: number): { n: number; dir: 'up' | 'down' } | null {
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

function MoodRow({ session, id }: { session: DateSession; id: string }) {
  const g = session.group!
  const m = g.members[id]
  const c = m.world.character
  const gone = g.gone.includes(id)
  const press = usePress(m.rel.affection)
  const betrayal = m.lastJudge ? lastBetrayal(session.record, id) : undefined
  const mood = gone ? 'Left' : moodWord(betrayal ? (betrayal.kind === 'lie' ? 'betrayed' : 'hurt') : (m.lastJudge?.mood ?? (g.reveals?.[id] ? 'hurt' : undefined)))
  return (
    <span className={cx(styles.groupMood, gone && styles.goneMood)} style={{ '--accent': portraitAccent(c.accent) } as CSSProperties}>
      <Kiss key={press?.n ?? 0} className={cx(styles.moodKiss, press && styles.pressed, press?.dir === 'down' && styles.down)} />
      <span className={styles.moodText}>
        <span className={cx(styles.moodLabel, 'name')}>{firstName(c.name)}</span>
        <span className={styles.mood}>{mood}</span>
      </span>
      <LipstickStamps stage={stageFor(m.rel.affection)} size="small" />
    </span>
  )
}

/** The hints line for one character: their judge's hint (or the betrayal's note) and what counted. */
function hintFor(session: DateSession, id: string): { hint: string; deltas: string } {
  const g = session.group!
  const m = g.members[id]
  const c = m.world.character
  const judge = m.lastJudge
  if (!judge || g.gone.includes(id)) return { hint: '', deltas: '' }
  const applied = lastApplied(session.record, id)
  const betrayal = lastBetrayal(session.record, id)
  const hint = betrayal ? betrayalHint(betrayal, c.name) : judge.hint.trim()
  const view = memberView(session, id)
  const capped = gainCapped(applyDifficulty(judge.delta, c.difficulty), applied?.affection, dateGainUsed(view), session.world.settings.gainCap)
  return { hint, deltas: deltaText(applied, capped, m.rel.affection <= 0) }
}

/** The group's status strip: a row per character; meters, heat and hints for each when expanded. */
export function GroupStatusStrip({ session, hints, onHeat }: { session: DateSession; hints: boolean; onHeat: () => void }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const g = session.group!
  const heat = useSettings((s) => s.settings.heat)
  const heatInfo = HEAT_LEVELS.find((h) => h.level === heat) ?? HEAT_LEVELS[0]
  const lines = hints
    ? g.ids
        .map((id) => ({ id, first: firstName(g.members[id].world.character.name), ...hintFor(session, id) }))
        .filter((l) => l.hint || l.deltas)
    : []

  return (
    <section className={styles.status} aria-label="How it's going">
      <button type="button" className={cx(styles.statusToggle, styles.groupToggle)} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        <span className={styles.groupMoods}>
          {g.ids.map((id) => (
            <MoodRow key={id} session={session} id={id} />
          ))}
        </span>
        <span className={styles.toggleText}>{open ? 'Less' : 'More'}</span>
      </button>
      {lines.length > 0 && (
        <div className={styles.hintLines}>
          {lines.map((l) => (
            <p key={l.id} className={styles.hintLine}>
              <span className={cx(styles.hintWho, 'name')}>{l.first}</span>
              {l.hint && <em className={styles.hint}>{l.hint}</em>}
              {l.deltas && <span className={styles.deltas}>{l.deltas}</span>}
            </p>
          ))}
        </div>
      )}
      {open && (
        <div id={panelId} className={cx(styles.statusPanel, styles.groupPanel)}>
          {g.ids.map((id) => {
            const m = g.members[id]
            const route = routeOf(m.world)
            const cap = affectionCap(route)
            const first = firstName(m.world.character.name)
            return (
              <div key={id} className={styles.groupMeters} style={{ '--accent': portraitAccent(m.world.character.accent) } as CSSProperties}>
                <p className={cx(styles.groupMetersName, 'name')}>
                  {first}
                  {g.gone.includes(id) ? ', left the date' : ''}
                </p>
                <Meter
                  kind="affection"
                  value={m.rel.affection}
                  label={`${first}'s affection`}
                  cap={route === 'friend' ? cap : undefined}
                  capNote={route === 'friend' ? `On a friend route ${first}'s affection stops at ${cap}.` : undefined}
                />
                <Meter kind="trust" value={m.rel.trust} label={`${first}'s trust`} />
              </div>
            )
          })}
          <div className={styles.heatRow}>
            <p className={styles.heatText}>
              <Kiss className={styles.heatKiss} filled />
              Heat {heatInfo.level}, {heatInfo.name}
            </p>
            <Button variant="secondary" size="small" className={styles.tap} aria-label={`Heat ${heatInfo.level}, ${heatInfo.name}. Change heat`} onClick={onHeat}>
              Change heat
            </Button>
          </div>
          <p className={styles.caption}>A group date plays at the heat both of them are at. Define the relationship waits for a date with just one of them.</p>
          {!hints && (
            <Toggle
              checked={false}
              onChange={(on) => void useSettings.getState().update({ hints: on })}
              label="Hints"
              description="See how each message landed with each of them: the hint, and what it did to affection and trust."
            />
          )}
        </div>
      )}
    </section>
  )
}
