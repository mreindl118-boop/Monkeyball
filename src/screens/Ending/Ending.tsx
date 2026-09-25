// The ending (#/ending/:id): which ending the player is on with this character and why, before the
// epilogue plays (docs/SPEC.md, Endings: "The player sees which ending they're on before it plays;
// if it's not the one they wanted, they can reload and try a different approach"). Play starts the
// epilogue (a six-turn date at their first favorite venue) and goes to the date screen.

import { useState, type CSSProperties } from 'react'
import { Portrait } from '../../art/Portrait'
import { portraitAccent } from '../../art/Portrait.model'
import { venueById } from '../../data/venues'
import { liveCharacterId, useDate } from '../../store/date'
import { useGame } from '../../store/game'
import { useNav } from '../../store/nav'
import { Button } from '../../ui/Button'
import { Note, Panel } from '../../ui/Panel'
import { toast } from '../../ui/toastStore'
import { TopBar } from '../../ui/TopBar'
import { firstName } from '../DateScreen/dateModel'
import { useRosterAndGame } from '../Hub/useRosterGame'
import { venuePhrase } from '../Recap/recapModel'
import {
  groupText,
  notReadyText,
  playedEnding,
  possessive,
  reasonSentence,
  reloadHint,
  seenEndings,
} from './endingModel'
import styles from './Ending.module.css'
import { endingTitle, useEnding, useEpilogueAutosave } from './useEnding'

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export default function Ending() {
  const screen = useNav((s) => s.screen)
  const back = useNav((s) => s.back)
  const go = useNav((s) => s.go)
  const replace = useNav((s) => s.replace)
  const id = screen.name === 'ending' ? screen.id : ''
  const loaded = useRosterAndGame()
  const { character, rel, route, ready, ending, names } = useEnding(id)
  const endingsSeen = useGame((s) => s.game.endingsSeen)
  const onDateWith = useDate(liveCharacterId)
  const autosaved = useEpilogueAutosave(id)
  const [starting, setStarting] = useState(false)

  if (!character) {
    return (
      <main className="screen">
        <TopBar title="Your ending" onBack={back} />
        {loaded ? (
          <Panel title="Nobody by that name" description="This character isn't on this device any more.">
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

  const name = character.name.trim() || character.id
  const first = firstName(name)
  const style = { '--accent': portraitAccent(character.accent) } as CSSProperties
  const venue = venueById(character.favoriteVenues?.[0] ?? '')
  const played = playedEnding(rel)
  const seen = seenEndings(endingsSeen, character.id)
  const busyElsewhere = onDateWith !== null

  const play = async () => {
    if (starting) return
    setStarting(true)
    try {
      const result = await useDate.getState().startEpilogue(character.id)
      if (result.ok) {
        replace({ name: 'date' })
        return
      }
      toast(
        result.reason === 'busy'
          ? 'Another date is still open. Finish it first.'
          : result.reason === 'not-ready'
            ? notReadyText(name, rel.affection, route) || "This epilogue isn't ready yet."
            : "This character isn't on this device any more.",
        'error',
        6000,
      )
    } finally {
      setStarting(false)
    }
  }

  return (
    <main className={`screen ${styles.root}`} style={style}>
      <TopBar title="Your ending" onBack={back} />

      <section className={styles.hero} aria-label={`Your ending with ${name}`}>
        <div className={styles.portrait}>
          <Portrait character={character} tier={ready ? 5 : undefined} size="medium" />
        </div>
        <div className={styles.heroText}>
          <p className={styles.eyebrow}>{ready && ending ? "The ending you're on" : 'Not yet'}</p>
          {ready && ending ? (
            <h2 className={styles.title}>{ending.title}</h2>
          ) : (
            <h2 className={styles.title}>
              <span className="name">{name}</span>
            </h2>
          )}
          {ready && ending?.description && <p className={styles.description}>{ending.description}</p>}
        </div>
      </section>

      {!ready ? (
        <Panel title={`${possessive(first)} epilogue`} description={notReadyText(name, rel.affection, route)}>
          <Button variant="primary" onClick={back}>
            Back
          </Button>
        </Panel>
      ) : !ending ? (
        <Panel title="Couldn't work out the ending" description="Something about this relationship didn't add up. Try again after your next date.">
          <Button variant="primary" onClick={back}>
            Back
          </Button>
        </Panel>
      ) : (
        <>
          <Panel title="Why this one" tone="brass" className={styles.section}>
            <p className={styles.reason}>{reasonSentence(ending.reason)}</p>
            {ending.type === 'polycule' && ending.group && ending.group.length > 0 && (
              <p className={styles.group}>
                Everyone is in it: <span className="name">{groupText(character.id, ending.group, names)}</span>.
              </p>
            )}
            <p className={styles.where}>
              {venue
                ? `One last date, six turns, at ${venuePhrase(venue.id, venue.name)}.`
                : `One last date, six turns, at ${possessive(first)} favorite place.`}
            </p>
          </Panel>

          {(seen.length > 0 || played) && (
            <Panel title="Endings you've seen" className={styles.section}>
              <ul className={styles.seen}>
                {seen.map((t) => (
                  <li key={t}>{endingTitle(t)}</li>
                ))}
              </ul>
              {played && <p className={styles.caption}>Last played {dateFmt.format(played.playedAt)}.</p>}
            </Panel>
          )}

          <Note tone="brass" title="Not the one you wanted?">
            {reloadHint(name, autosaved === true)}
          </Note>

          {busyElsewhere && (
            <Note tone="lipstick" title="A date is still open">
              Finish or end it before the epilogue.
            </Note>
          )}

          <div className={styles.actions} data-keyboard-static>
            <Button variant="primary" block loading={starting} disabled={busyElsewhere} onClick={play}>
              Play the epilogue
            </Button>
            <Button variant="secondary" block onClick={back}>
              Not yet
            </Button>
          </div>
        </>
      )}
    </main>
  )
}
