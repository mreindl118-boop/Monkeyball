import { useMemo, type CSSProperties } from 'react'
import { Portrait } from '../../art/Portrait'
import { portraitAccent } from '../../art/Portrait.model'
import { GIFTS, giftById } from '../../data/gifts'
import { VENUES, venueById } from '../../data/venues'
import { seenIn, standingLine } from '../../engine/agreements'
import { newRelationship } from '../../engine/relationship'
import { affectionCap, routeFor, stageFor } from '../../engine/stages'
import { liveCharacterId, useDate } from '../../store/date'
import { useGame } from '../../store/game'
import { useNav } from '../../store/nav'
import { useRelationsFor, useRoster } from '../../store/roster'
import { useSettings } from '../../store/settings'
import type { Character, Relationship, Route } from '../../types'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { LipstickStamps } from '../../ui/LipstickStamps'
import { Meter } from '../../ui/Meter'
import { Note, Panel } from '../../ui/Panel'
import { TopBar } from '../../ui/TopBar'
import { highestTier } from '../Hub/hubModel'
import { useRosterAndGame } from '../Hub/useRosterGame'
import { EndingCard } from './EndingCard'
import styles from './Profile.module.css'
import {
  HIDDEN,
  RUMOR_WARNING,
  ageLine,
  agreementView,
  attractionsText,
  fraction,
  gallerySlots,
  giftReactionText,
  isPartnerRelation,
  nextStageText,
  partnersKnown,
  relationText,
  routeExplanation,
  routeTitle,
  rumorsAbout,
  secretRows,
  stageName,
  styleText,
  traitGroups,
  venueReactionText,
} from './profileModel'

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={styles.lockIcon}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function Hidden({ children = HIDDEN }: { children?: string }) {
  return (
    <span className={styles.hidden}>
      <span aria-hidden="true">{children}</span>
      <span className="visually-hidden">Not discovered yet</span>
    </span>
  )
}

export default function Profile() {
  const screen = useNav((s) => s.screen)
  const back = useNav((s) => s.back)
  const go = useNav((s) => s.go)
  const id = screen.name === 'profile' ? screen.id : ''
  const ready = useRosterAndGame()
  const entry = useRoster((s) => s.entries[id])

  if (!entry) {
    return (
      <main className="screen">
        <TopBar title="Profile" onBack={back} />
        {ready ? (
          <Panel title="Nobody by that name" description="This character isn't on this device. They may have been deleted, or their pack removed.">
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => go({ name: 'hub' })}>
                Back to the hub
              </Button>
            </div>
          </Panel>
        ) : (
          <p className={styles.loading} role="status">
            Finding them
          </p>
        )}
      </main>
    )
  }
  return <ProfileView character={entry.character} setId={entry.setId} ready={ready} />
}

function ProfileView({ character, setId, ready }: { character: Character; setId: string; ready: boolean }) {
  const back = useNav((s) => s.back)
  const go = useNav((s) => s.go)
  const id = character.id
  const stored = useGame((s) => s.relationships[id])
  const rel: Relationship = useMemo(() => stored ?? newRelationship(id), [stored, id])
  const profile = useSettings((s) => s.profile)
  const mode = useSettings((s) => s.settings.orientationMode)
  const activeSets = useSettings((s) => s.settings.activeSets)
  const entries = useRoster((s) => s.entries)
  const set = useRoster((s) => s.sets.find((x) => x.id === setId))
  const relations = useRelationsFor(id, activeSets)
  // A date with them still open (the player stepped away from it): the button goes back to it.
  const onDate = useDate(liveCharacterId) === id

  const name = character.name.trim() || id
  const first = name.split(/\s+/)[0]
  const route: Route = routeFor(character, profile, mode)
  const stage = stageFor(rel.affection)
  const tier = highestTier(rel)
  const active = activeSets.includes(setId)
  const agreement = agreementView(rel.agreement)
  const traits = traitGroups(character, rel)
  const secrets = secretRows(character, rel, route)
  const slots = gallerySlots(character, rel, route)
  const venues = Object.entries(rel.venues ?? {})
  const gifts = Object.entries(rel.gifts ?? {})
  const partners = relations.filter((r) => isPartnerRelation(r.kind))
  const styleKnown = !!rel.revealed?.style
  const cap = affectionCap(route)
  const style = { '--accent': portraitAccent(character.accent) } as CSSProperties
  const sets = useRoster((s) => s.sets)
  const heard = useGame((s) => s.game.rumors)
  const names = useMemo(() => {
    const out: Record<string, string> = {}
    for (const e of Object.values(entries)) out[e.character.id] = e.character.name.trim() || e.character.id
    return out
  }, [entries])
  const rumors = useMemo(
    () => rumorsAbout(id, heard, sets.flatMap((s) => s.rumors ?? []), names),
    [id, heard, sets, names],
  )
  // Where they think the two of you stand, once there's something to stand on. People the player
  // no longer sees drop out of what they "know you're seeing".
  const relationships = useGame((s) => s.relationships)
  const dateCount = useGame((s) => s.game.dateCount)
  const standing = standingText(character, rel, names, route, (x: string): Route => {
    const e = entries[x]
    return e ? routeFor(e.character, profile, mode) : 'romantic'
  }, relationships, dateCount)

  return (
    <main className={`screen ${styles.root}`} style={style} aria-busy={!ready || undefined}>
      <TopBar title={<span className="name">{name}</span>} onBack={back} />

      <section className={styles.hero} aria-label={`About ${name}`}>
        <div className={styles.portrait}>
          <Portrait character={character} tier={tier} size="medium" />
        </div>
        <div className={styles.facts}>
          {character.identity?.trim() && <p className={styles.identity}>{character.identity.trim()}</p>}
          {ageLine(character) && <p className={styles.ageLine}>{ageLine(character)}</p>}
          <p className={styles.occupation}>{character.occupation}</p>
          <div className={styles.stage}>
            <LipstickStamps stage={stage} showLabel />
          </div>
        </div>
      </section>

      {!active && (
        <Note tone="brass" title={`${set?.name ?? 'Their set'} is switched off`}>
          {first} isn't on the hub while the set is off. Their progress is kept. Turn the set on in Character sets to date them.
        </Note>
      )}

      <Panel title="Where you stand" className={styles.section}>
        <div className={styles.meters}>
          <Meter
            kind="affection"
            value={rel.affection}
            cap={route === 'friend' ? cap : undefined}
            capNote={route === 'friend' ? `On a friend route affection stops at ${cap}.` : undefined}
          />
          <Meter kind="trust" value={rel.trust} />
        </div>
        <dl className={styles.facts2}>
          <div className={styles.fact}>
            <dt>Stage</dt>
            <dd>
              <span className={styles.value}>{stageName(rel.affection)}</span>
              {nextStageText(rel.affection, route) && <span className={styles.caption}>{nextStageText(rel.affection, route)}</span>}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Route</dt>
            <dd>
              <span className={cx(styles.value, route === 'friend' && styles.brassText)}>{routeTitle(route)}</span>
              <span className={styles.caption}>{routeExplanation(first, route, mode)}</span>
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Agreement</dt>
            <dd>
              <span className={cx(styles.value, agreement.made && styles.brassText)}>{agreement.title}</span>
              {agreement.detail && (
                <span className={styles.caption}>
                  {agreement.made ? `"${agreement.detail}"` : agreement.detail}
                  {agreement.made && rel.agreement.madeAt > 0 ? ` Since ${dateFmt.format(rel.agreement.madeAt)}.` : ''}
                </span>
              )}
            </dd>
          </div>
          {standing && (
            <div className={styles.fact}>
              <dt>What they know</dt>
              <dd>
                <span className={styles.value}>{standing}</span>
              </dd>
            </div>
          )}
        </dl>
      </Panel>

      <EndingCard character={character} />

      <Panel title="Look" className={styles.section}>
        <p className={styles.prose}>{character.look}</p>
      </Panel>

      <Panel title="Who they're into" className={styles.section}>
        <dl className={styles.facts2}>
          <div className={styles.fact}>
            <dt>Attractions</dt>
            <dd>
              {rel.revealed?.attractions ? <span className={styles.value}>{attractionsText(character)}</span> : <Hidden />}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Relationship style</dt>
            <dd>{rel.revealed?.style ? <span className={styles.value}>{styleText(character)}</span> : <Hidden />}</dd>
          </div>
        </dl>
        {!(rel.revealed?.attractions && rel.revealed?.style) && (
          <p className={styles.caption}>These come up in conversation, or through gossip.</p>
        )}
      </Panel>

      <Panel
        title="Traits"
        description="Found on dates, with how they reacted when you hit one."
        className={styles.section}
      >
        <div className={styles.traitGrid}>
          {traits.map((g) => (
            <section key={g.type} className={styles.traitGroup} aria-labelledby={`trait-${g.type}`}>
              <h3 className={styles.traitTitle} id={`trait-${g.type}`}>
                {g.title}
                <span className={styles.count} aria-label={`${g.discovered} of ${g.total} discovered`}>
                  {fraction(g.discovered, g.total)}
                </span>
              </h3>
              <ul className={styles.traitList}>
                {g.rows.map((r) => (
                  <li key={r.id} className={cx(styles.trait, r.discovered && styles.found)}>
                    {r.discovered ? (
                      <>
                        <span className={styles.traitLabel}>{r.label}</span>
                        {r.hint && <span className={styles.hint}>{r.hint}</span>}
                      </>
                    ) : (
                      <Hidden />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Panel>

      <Panel title="Dates so far" className={styles.section}>
        <div className={styles.twoCol}>
          <div className={styles.block}>
            <h3 className={cx(styles.blockTitle, styles.traitTitle)}>
              Venues tried
              <span className={styles.count} aria-label={`${venues.length} of ${VENUES.length} tried`}>
                {fraction(venues.length, VENUES.length)}
              </span>
            </h3>
            {venues.length === 0 ? (
              <p className={styles.caption}>No dates yet. Their reaction to each venue shows here once you've tried it.</p>
            ) : (
              <ul className={styles.tried}>
                {venues.map(([vid, reaction]) => (
                  <li key={vid} className={styles.triedRow}>
                    <span>{venueById(vid)?.name ?? vid}</span>
                    <span className={cx(styles.reaction, styles[reaction])}>{venueReactionText(reaction)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={styles.block}>
            <h3 className={cx(styles.blockTitle, styles.traitTitle)}>
              Gifts tried
              <span className={styles.count} aria-label={`${gifts.length} of ${GIFTS.length} tried`}>
                {fraction(gifts.length, GIFTS.length)}
              </span>
            </h3>
            {gifts.length === 0 ? (
              <p className={styles.caption}>No gifts yet.</p>
            ) : (
              <ul className={styles.tried}>
                {gifts.map(([gid, reaction]) => (
                  <li key={gid} className={styles.triedRow}>
                    <span>{giftById(gid)?.name ?? gid}</span>
                    <span className={cx(styles.reaction, styles[reaction])}>{giftReactionText(reaction)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="Secrets" tone="brass" className={styles.section}>
        {secrets.length === 0 ? (
          <p className={styles.caption}>{first} has no secrets on their card.</p>
        ) : (
          <ul className={styles.secrets}>
            {secrets.map((s) => (
              <li key={s.index} className={cx(styles.secret, s.earned ? styles.earned : styles.locked)}>
                {s.earned ? (
                  <p className={styles.secretText}>{s.text}</p>
                ) : (
                  <p className={styles.secretLock}>
                    <LockIcon />
                    <span>{s.text}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {rumors.length > 0 && (
        <Panel title="Rumors you've heard" description={`What people have said about ${first}.`} tone="brass" className={styles.section}>
          <ul className={styles.rumors}>
            {rumors.map((r) => (
              <li key={r.id} className={styles.rumor}>
                <p className={styles.rumorText}>{r.text}</p>
                <p className={styles.caption}>From {r.teller}</p>
              </li>
            ))}
          </ul>
          <p className={styles.caption}>{RUMOR_WARNING}</p>
        </Panel>
      )}

      <Panel title="Partners and exes" className={styles.section}>
        {!partnersKnown(rel) ? (
          <p className={styles.caption}>{first} hasn't brought up partners or exes yet. That comes with a little closeness.</p>
        ) : partners.length === 0 ? (
          <p className={styles.caption}>Nobody they've mentioned.</p>
        ) : (
          <ul className={styles.partners}>
            {partners.map((p) => {
              const other = entries[p.id]
              const otherName = other?.character.name.trim() || p.id
              return (
                <li key={`${p.id}-${p.kind}`} className={styles.partner}>
                  <div className={styles.partnerHead}>
                    {other ? (
                      <button type="button" className={styles.partnerLink} onClick={() => go({ name: 'profile', id: p.id })}>
                        <span className="name">{otherName}</span>
                      </button>
                    ) : (
                      <span className="name">{otherName}</span>
                    )}
                    <span className={styles.relation}>{isPartnerRelation(p.kind) ? relationText(p.kind) : p.kind}</span>
                  </div>
                  {/* Manifest notes often say how the pair did things (open, monogamous), so they
                      wait until the relationship style has come up. */}
                  {p.note && styleKnown && <p className={styles.caption}>{p.note}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Gallery" description="Art unlocks as you get closer." className={styles.section}>
        <ul className={styles.strip} aria-label={`${name}'s gallery`}>
          {slots.map((slot) =>
            slot.unlocked ? (
              <li key={slot.tier} className={styles.slot}>
                <Portrait character={character} tier={slot.tier} size="medium" />
              </li>
            ) : (
              <li key={slot.tier} className={cx(styles.slot, styles.lockedSlot)}>
                <span className={styles.slotTier}>Tier {slot.tier}</span>
                <LockIcon />
                <span className={styles.slotTitle}>{slot.title}</span>
                <span className={styles.slotLock}>{slot.lock}</span>
              </li>
            ),
          )}
        </ul>
      </Panel>

      <div className={styles.later}>
        <Button variant="secondary" disabled block aria-describedby="group-date-later">
          Ask for a group date
        </Button>
        <p className={styles.caption} id="group-date-later">
          Arrives in a later update.
        </p>
      </div>

      <div className={styles.actionBar} data-keyboard-static>
        {onDate ? (
          <Button variant="primary" block onClick={() => go({ name: 'date' })}>
            Back to the date
          </Button>
        ) : (
          <Button variant="primary" block disabled={!active} onClick={() => go({ name: 'date-setup', id })}>
            Ask on a date
          </Button>
        )}
      </div>
    </main>
  )
}

/** The profile's "What they know" line, or '' before there's anything to stand on. */
function standingText(
  character: Character,
  rel: Relationship,
  names: Record<string, string>,
  route: Route,
  routeOf: (id: string) => Route,
  relationships: Record<string, Relationship>,
  dateCount: number | undefined,
): string {
  if ((rel.dates ?? 0) === 0 && (rel.knownOthers ?? []).length === 0) return ''
  try {
    return standingLine(character, rel, names, { route, seen: seenIn(relationships, routeOf, dateCount, rel) })
  } catch {
    return ''
  }
}
