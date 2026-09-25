// Recap (#/recap/:dateId): what the date changed. Affection and trust from before to after, the
// stage (stamps pressed when it moved), traits discovered, venue and gift reactions, secrets
// earned, tiers unlocked, the new memory line in the character's voice, and the damage when they
// walked out. Accent-tinted by the character.

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Portrait } from '../../art/Portrait'
import { portraitAccent } from '../../art/Portrait.model'
import { giftById } from '../../data/gifts'
import { venueById } from '../../data/venues'
import { getDate } from '../../db/repo'
import { success } from '../../platform/haptics'
import { useDate } from '../../store/date'
import { useGame } from '../../store/game'
import { useNav } from '../../store/nav'
import { useRoster } from '../../store/roster'
import type { Character, DateRecord, NewsItem } from '../../types'
import { Backdrop } from '../../ui/Backdrop'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { LipstickStamps } from '../../ui/LipstickStamps'
import { Meter } from '../../ui/Meter'
import { Note, Panel } from '../../ui/Panel'
import { TopBar } from '../../ui/TopBar'
import { firstName, signed } from '../DateScreen/dateModel'
import { dtrOutcome } from '../DateScreen/dtrModel'
import { possessive } from '../Ending/endingModel'
import { endingTitle } from '../Ending/useEnding'
import { useRosterAndGame } from '../Hub/useRosterGame'
import { RUMOR_WARNING } from '../Profile/profileModel'
import styles from './Recap.module.css'
import {
  agreementChange,
  betrayalHit,
  betrayalLine,
  betrayalVoice,
  changeBadge,
  dateNews,
  direction,
  gossipLines,
  hitBadge,
  giftReactionLine,
  leftDamageText,
  memoryQuote,
  meterChange,
  outcomeText,
  recapFor,
  recapSecrets,
  recapTiers,
  recapTraits,
  revealedLines,
  rumorLines,
  stageChangeText,
  venuePhrase,
  venueReactionLine,
  type CharacterRecap,
} from './recapModel'

export default function Recap() {
  const screen = useNav((s) => s.screen)
  const reset = useNav((s) => s.reset)
  const dateId = screen.name === 'recap' ? screen.dateId : NaN
  const ready = useRosterAndGame()
  const [record, setRecord] = useState<DateRecord | null | undefined>(() => {
    const last = useDate.getState().lastRecord
    return last && last.id === dateId ? last : undefined
  })

  useEffect(() => {
    if (record !== undefined) return
    let alive = true
    getDate(dateId)
      .then((r) => {
        if (alive) setRecord(r ?? null)
      })
      .catch(() => {
        if (alive) setRecord(null)
      })
    return () => {
      alive = false
    }
  }, [dateId, record])

  const characterId = record?.characterIds[0] ?? ''
  const entry = useRoster((s) => (characterId ? s.entries[characterId] : undefined))
  const recap = recapFor(record)

  if (record === undefined || (!entry && !ready)) {
    return (
      <main className="screen">
        <p className={styles.loading} role="status">
          Adding it all up
        </p>
      </main>
    )
  }

  if (!record || !recap || !entry) {
    return (
      <main className={`screen ${styles.root}`}>
        <TopBar title="Recap" />
        <Panel
          title="No recap for this date"
          description={
            !record
              ? "This date isn't on this device."
              : !entry
                ? "The character from this date isn't on this device any more."
                : 'This date ended before anything could be added up.'
          }
        >
          <Button variant="primary" onClick={() => reset({ name: 'hub' })}>
            Back to the hub
          </Button>
        </Panel>
      </main>
    )
  }

  return <RecapView record={record} recap={recap} character={entry.character} />
}

function RecapView({ record, recap, character }: { record: DateRecord; recap: CharacterRecap; character: Character }) {
  const reset = useNav((s) => s.reset)
  const go = useNav((s) => s.go)
  const name = character.name.trim() || character.id
  const first = firstName(name)
  const venue = venueById(record.venueId)
  const gift = record.giftId ? giftById(record.giftId) : undefined
  const traits = useMemo(() => recapTraits(character, recap.traits), [character, recap.traits])
  const secrets = recapSecrets(character, recap.secrets)
  const tiers = recapTiers(character, recap.tiers)
  const revealed = revealedLines(first, recap.revealed)
  const memory = memoryQuote(recap.memory)
  const left = recap.left || record.outcome === 'left'
  // Only reactions the player didn't know before this date (older records: always listed).
  const learnedVenue = !!venue && !!recap.venueReaction && recap.venueNew !== false
  const learnedGift = !!gift && !!recap.giftReaction && recap.giftNew !== false
  const style = { '--accent': portraitAccent(character.accent) } as CSSProperties

  // The stage stamps press from where they were to where they are, a beat after the screen opens.
  const [stage, setStage] = useState(recap.stageBefore)
  useEffect(() => {
    const t = setTimeout(() => setStage(recap.stageAfter), 450)
    return () => clearTimeout(t)
  }, [recap.stageAfter])

  // Something unlocked: a short success buzz in the Android app.
  const unlockedSomething = tiers.length > 0 || secrets.length > 0
  useEffect(() => {
    if (unlockedSomething) void success()
  }, [unlockedSomething])

  const where = venue ? venuePhrase(venue.id, venue.name) : record.venueId

  // Phase 4: what the date did to the relationship and what it set off elsewhere.
  const entries = useRoster((s) => s.entries)
  const sets = useRoster((s) => s.sets)
  const news = useGame((s) => s.game.news)
  const names = useMemo(() => {
    const out: Record<string, string> = {}
    for (const e of Object.values(entries)) out[e.character.id] = e.character.name.trim() || e.character.id
    return out
  }, [entries])
  const agreement = agreementChange(recap.agreementBefore, recap.agreementAfter, first)
  const talk = recap.dtr?.result ? dtrOutcome(name, recap.dtr.requested, recap.dtr.result, recap.agreementBefore ?? undefined) : null
  const hit = betrayalHit(recap.betrayals)
  const gossip = gossipLines(recap.gossip)
  const heard = rumorLines(recap.rumors, sets.flatMap((x) => x.rumors ?? []), names)
  const world: NewsItem[] = record.recap?.world?.news ?? dateNews(record, news)
  const elsewhere = (record.recap?.world?.betrayals ?? []).filter((b) => b.characterId !== character.id)
  const epilogue = record.kind === 'epilogue'
  const ending = epilogue ? endingTitle(record.endingType) : ''

  return (
    <main className={`screen ${styles.root}`} style={style}>
      <TopBar title="How it went" />

      <section className={styles.hero} aria-label={`Your date with ${name}`}>
        {venue && <Backdrop venue={venue} fill scrim className={styles.heroArt} />}
        <div className={styles.heroBody}>
          <Portrait character={character} size="small" className={styles.heroPortrait} />
          <div className={styles.heroText}>
            <h2 className={styles.heroName}>
              <span className="name">{name}</span>
            </h2>
            <p className={styles.heroWhere}>{venue?.id === 'home' ? 'A night in' : `At ${where}`}</p>
            <p className={styles.heroOutcome}>
              {epilogue && ending ? `The epilogue: ${ending.charAt(0).toLowerCase()}${ending.slice(1)}.` : outcomeText(record.outcome, first)}
            </p>
          </div>
        </div>
      </section>

      {epilogue && ending && (
        <Panel title="Your ending" tone="brass" className={styles.section}>
          <p className={styles.endingTitle}>{ending}</p>
          <p className={styles.plain}>It's kept on {possessive(first)} profile, and it can play again.</p>
        </Panel>
      )}

      {left && (
        <Note tone="lipstick" title="What it cost">
          {leftDamageText(first, recap, record.totals?.[character.id]?.affection)}
        </Note>
      )}

      <Panel title="Where you stand" className={styles.section}>
        <div className={styles.meters}>
          <MeterChange kind="affection" label="Affection" before={recap.affectionBefore} after={recap.affectionAfter} hit={hit.affection} />
          <MeterChange kind="trust" label="Trust" before={recap.trustBefore} after={recap.trustAfter} hit={hit.trust} />
        </div>
        {recap.betrayals.length > 0 && (
          <div className={styles.betrayals} role="note">
            <p className={styles.betrayalTitle}>It came out</p>
            <ul className={styles.plainList}>
              {recap.betrayals.map((b, i) => (
                <li key={`${b.at}-${i}`}>
                  {betrayalLine(b, first, names)} Affection {signed(b.affectionDelta)}, trust {signed(b.trustDelta)}.
                  {betrayalVoice(b) && <q className={styles.betrayalVoice}>{betrayalVoice(b)}</q>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className={styles.stage}>
          <LipstickStamps stage={stage} size="large" />
          <p className={cx(styles.stageText, recap.stageAfter !== recap.stageBefore && styles.stageMoved)}>
            {stageChangeText(recap.stageBefore, recap.stageAfter)}
          </p>
        </div>
      </Panel>

      {memory && (
        <figure className={styles.memory}>
          <blockquote className={styles.quote}>
            <p>{memory}</p>
          </blockquote>
          <figcaption className={styles.quoteBy}>{first}, after the date</figcaption>
        </figure>
      )}

      {traits.length > 0 && (
        <Panel title="Discovered" description="Now on their profile, with how they reacted." className={styles.section}>
          <ul className={styles.list}>
            {traits.map((t) => (
              <li key={t.key} className={cx(styles.trait, styles[t.type])}>
                <span className={styles.traitKind}>{t.kind}</span>
                <span className={styles.traitLabel}>{t.label}</span>
                {t.hint && <span className={styles.traitHint}>{t.hint}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {(learnedVenue || learnedGift || revealed.length > 0) && (
        <Panel title="What you learned" className={styles.section}>
          <ul className={styles.plainList}>
            {learnedVenue && venue && recap.venueReaction && (
              <li>{venueReactionLine(first, venue.id, venue.name, recap.venueReaction)}</li>
            )}
            {learnedGift && gift && recap.giftReaction && <li>{giftReactionLine(first, gift.name, recap.giftReaction)}</li>}
            {revealed.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Panel>
      )}

      {secrets.length > 0 && (
        <Panel title={secrets.length === 1 ? 'A secret, earned' : 'Secrets, earned'} tone="brass" className={styles.section}>
          <ul className={styles.secrets}>
            {secrets.map((s) => (
              <li key={s} className={styles.secret}>
                {s}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tiers.length > 0 && (
        <Panel title="Unlocked" description="New in their gallery." tone="brass" className={styles.section}>
          <ul className={styles.tiers}>
            {tiers.map((t) => (
              <li key={t.tier} className={styles.tier}>
                <Portrait character={character} tier={t.tier} size="medium" />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {(agreement || talk) && (
        <Panel
          title={agreement ? (agreement.made ? 'What you are now' : 'Your agreement ended') : 'What you talked about'}
          tone="brass"
          className={styles.section}
        >
          <p className={styles.plain}>
            {talk && <span className={styles.talkTitle}>{talk.title}. </span>}
            {/* Accepted or countered: the change says where you landed; declined: nothing changed. */}
            {agreement ? agreement.line : talk?.line}
          </p>
          {(agreement?.terms || talk?.terms) && (
            <blockquote className={styles.terms}>
              <p>{agreement?.terms || talk?.terms}</p>
              <footer className={styles.quoteBy}>In {possessive(first)} words</footer>
            </blockquote>
          )}
        </Panel>
      )}

      {gossip.length > 0 && (
        <Panel title={`What ${first} told you`} description="Friends talk. What they share shows up on the other profiles too." className={styles.section}>
          <ul className={styles.plainList}>
            {gossip.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </Panel>
      )}

      {heard.length > 0 && (
        <Panel title={heard.length === 1 ? 'A rumor' : 'Rumors'} tone="brass" className={styles.section}>
          <ul className={styles.secrets}>
            {heard.map((r) => (
              <li key={r.key} className={styles.rumor}>
                <p>{r.text}</p>
                {r.teller && <p className={styles.quoteBy}>{r.teller} told you</p>}
              </li>
            ))}
          </ul>
          <p className={styles.caption}>{RUMOR_WARNING}</p>
        </Panel>
      )}

      {(world.length > 0 || elsewhere.length > 0) && (
        <Panel title="Word got around" description="What this date set off elsewhere." className={styles.section}>
          <ul className={styles.plainList}>
            {world.map((n) => (
              <li key={n.id} className={cx(n.kind === 'rekindle' && styles.brassLine, n.kind === 'betrayal' && styles.lipstickLine)}>
                {n.text}
              </li>
            ))}
            {elsewhere
              .filter((b) => !world.some((n) => n.kind === 'betrayal' && n.characterIds.includes(b.characterId)))
              .map((b, i) => {
                const who = firstName(names[b.characterId] ?? b.characterId)
                return (
                  <li key={`${b.characterId}-${i}`} className={styles.lipstickLine}>
                    {betrayalLine(b.event, who, names)} Affection {signed(b.event.affectionDelta)}, trust {signed(b.event.trustDelta)}.
                  </li>
                )
              })}
          </ul>
        </Panel>
      )}

      <div className={styles.actions}>
        <Button variant="primary" block onClick={() => reset({ name: 'hub' })}>
          Back to the hub
        </Button>
        <Button
          variant="secondary"
          block
          onClick={() => {
            reset({ name: 'hub' })
            go({ name: 'profile', id: character.id })
          }}
        >
          See their profile
        </Button>
      </div>
    </main>
  )
}

function MeterChange({
  kind,
  label,
  before,
  after,
  hit = 0,
}: {
  kind: 'affection' | 'trust'
  label: string
  before: number
  after: number
  /** A betrayal's share of the change (negative), shown as a lipstick hit on the meter. */
  hit?: number
}) {
  const dir = direction(before, after)
  const badge = hitBadge(hit)
  return (
    <div className={cx(styles.meterChange, badge && styles.hitMeter)}>
      <Meter kind={kind} value={after} label={label} />
      <p className={styles.change}>
        <span>{meterChange(label, before, after)}</span>
        <span className={styles.badges}>
          {badge && <span className={cx(styles.badge, styles.hit)}>{badge}</span>}
          <span className={cx(styles.badge, styles[dir], styles[kind])}>{changeBadge(before, after)}</span>
        </span>
      </p>
    </div>
  )
}
