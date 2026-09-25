import { useMemo, useState } from 'react'
import { HEAT_LEVELS } from '../../data/heat'
import { useGame } from '../../store/game'
import { useNav } from '../../store/nav'
import { SHOW_ME_NONBINARY, useRoster } from '../../store/roster'
import { useSettings } from '../../store/settings'
import type { ShowMe } from '../../types'
import { Button, IconButton } from '../../ui/Button'
import { Coaster } from '../../ui/Coaster'
import { Field } from '../../ui/Field'
import { HeatControl } from '../../ui/HeatControl'
import { Select, type SelectOption } from '../../ui/Inputs'
import { Kiss } from '../../ui/Kiss'
import { Panel } from '../../ui/Panel'
import { Sheet } from '../../ui/Sheet'
import { Wordmark } from '../../ui/Wordmark'
import { ConnectionStatus } from './ConnectionStatus'
import styles from './Hub.module.css'
import { greetingFor, hubView, regularsText, type HubSort } from './hubModel'
import { useRosterAndGame } from './useRosterGame'

const SHOW_ME: SelectOption[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'women', label: 'Women' },
  { value: 'men', label: 'Men' },
]

const SORTS: SelectOption[] = [
  { value: 'affection', label: 'Affection' },
  { value: 'trust', label: 'Trust' },
  { value: 'name', label: 'Name' },
]

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Zm8.2 4.7-1.9 1.1c.1.6 0 1.2-.2 1.8l1.3 1.8-1.9 1.9-1.8-1.3c-.6.2-1.2.4-1.8.4L13.3 21h-2.6l-.6-2.1c-.6-.1-1.2-.2-1.8-.5l-1.8 1.3-1.9-1.9 1.3-1.8c-.2-.6-.4-1.2-.4-1.8L3.4 13.6v-2.7l2.1-.6c.1-.6.3-1.2.5-1.8L4.8 6.7l1.9-1.9 1.8 1.3c.6-.3 1.2-.5 1.8-.6l.6-2.1h2.6l.6 2.1c.6.1 1.2.3 1.8.6l1.8-1.3 1.9 1.9-1.3 1.8c.3.6.5 1.2.6 1.8l2.1.6v2.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FilmIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4.5" y="3.5" width="15" height="17" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="7" y="6" width="10" height="9" fill="currentColor" opacity="0.35" />
    </svg>
  )
}

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 7l6 3 6-4M12 10l-2 8M12 10l6 7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6" cy="7" r="2.3" fill="currentColor" />
      <circle cx="18" cy="6" r="2.3" fill="currentColor" />
      <circle cx="12" cy="10" r="2.3" fill="currentColor" />
      <circle cx="10" cy="18" r="2.3" fill="currentColor" />
      <circle cx="18" cy="17" r="2.3" fill="currentColor" />
    </svg>
  )
}

function SetsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="9" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15" cy="14" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export default function Hub() {
  const profile = useSettings((s) => s.profile)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const go = useNav((s) => s.go)
  const sets = useRoster((s) => s.sets)
  const entries = useRoster((s) => s.entries)
  const relationships = useGame((s) => s.relationships)
  const ready = useRosterAndGame()
  const [heatOpen, setHeatOpen] = useState(false)
  const greeting = greetingFor(new Date().getHours())

  const { activeSets, showMe, hubSetFilter, hubSort, orientationMode, heat } = settings
  const view = useMemo(
    () =>
      hubView(
        { sets, entries },
        { settings: { activeSets, showMe, hubSetFilter, hubSort, orientationMode }, relationships, profile },
      ),
    [sets, entries, activeSets, showMe, hubSetFilter, hubSort, orientationMode, relationships, profile],
  )
  const heatInfo = HEAT_LEVELS.find((h) => h.level === heat) ?? HEAT_LEVELS[1]
  const setOptions: SelectOption[] = [
    { value: 'all', label: 'All sets' },
    ...view.activeSets.map((s) => ({ value: s.id, label: s.name })),
  ]
  const noSets = view.activeCount === 0

  return (
    <main className={`screen ${styles.root}`} aria-labelledby="hub-title">
      <header className={styles.header}>
        <div className={styles.top}>
          <Wordmark size={28} />
          <div className={styles.topActions}>
            <Button
              variant="secondary"
              size="small"
              className={styles.heatButton}
              icon={<Kiss className={styles.heatKiss} />}
              aria-label={`Heat ${heat}, ${heatInfo.name}. Change heat`}
              onClick={() => setHeatOpen(true)}
            >
              Heat {heat}
            </Button>
            <IconButton label="Settings" onClick={() => go({ name: 'settings' })}>
              <GearIcon />
            </IconButton>
          </div>
        </div>

        <h1 className={styles.hello} id="hub-title">
          {greeting}
          {profile ? (
            <>
              , <span className={styles.name}>{profile.name}</span>
            </>
          ) : null}
          {greeting === 'Still up' ? '?' : '.'}
        </h1>

        <nav className={styles.nav} aria-label="Places">
          <button type="button" className={styles.navTile} onClick={() => go({ name: 'gallery' })}>
            <FilmIcon />
            <span className={styles.navLabel}>Gallery</span>
          </button>
          <button type="button" className={styles.navTile} onClick={() => go({ name: 'map' })}>
            <MapIcon />
            <span className={styles.navLabel}>Polycule map</span>
          </button>
          <button type="button" className={styles.navTile} onClick={() => go({ name: 'sets' })}>
            <SetsIcon />
            <span className={styles.navLabel}>Character sets</span>
          </button>
        </nav>
      </header>

      <ConnectionStatus />

      {!noSets && (
        <section className={styles.filters} aria-label="Filter and sort">
          <Field
            label="Show me"
            htmlFor="hub-showme"
            hint={showMe === 'everyone' ? undefined : SHOW_ME_NONBINARY}
          >
            <Select
              value={showMe}
              options={SHOW_ME}
              onChange={(v) => void update({ showMe: v as ShowMe })}
            />
          </Field>
          <Field label="Sort by" htmlFor="hub-sort">
            <Select value={hubSort} options={SORTS} onChange={(v) => void update({ hubSort: v as HubSort })} />
          </Field>
          {view.activeSets.length > 1 && (
            <Field label="Set" htmlFor="hub-set" className={styles.setFilter}>
              <Select value={view.setFilter} options={setOptions} onChange={(v) => void update({ hubSetFilter: v })} />
            </Field>
          )}
        </section>
      )}

      {!ready ? (
        <div className={styles.loadingGrid} role="status" aria-label="Setting out the coasters">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={styles.ghost} aria-hidden="true" />
          ))}
        </div>
      ) : noSets ? (
        <Panel title="No sets in play" description="Turn on a character set to fill the city. Progress with everyone is kept while a set is off.">
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => go({ name: 'sets' })}>
              Choose character sets
            </Button>
          </div>
        </Panel>
      ) : view.shown === 0 ? (
        <Panel
          title="Nobody here matches"
          description={`Show me is set to ${showMe}, and nobody in ${view.setFilter === 'all' ? 'your sets' : 'this set'} fits. Their progress is kept.`}
        >
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void update({ showMe: 'everyone', hubSetFilter: 'all' })}>
              Show everyone
            </Button>
          </div>
        </Panel>
      ) : (
        view.groups.map((g) => (
          <section key={g.set.id} className={styles.group} aria-labelledby={`hub-set-${g.set.id}`}>
            <div className={styles.groupHead}>
              <h2 className={styles.setName} id={`hub-set-${g.set.id}`}>
                {g.set.name}
              </h2>
              <span className={styles.groupCount}>{regularsText(g.cards.length)}</span>
            </div>
            <ul className={styles.grid}>
              {g.cards.map((c) => (
                <li key={c.entry.character.id} className={styles.cell}>
                  <Coaster
                    character={c.entry.character}
                    affection={c.rel.affection}
                    discovered={c.discovered}
                    total={c.total}
                    friendRoute={c.route === 'friend'}
                    jealous={c.rel.jealous}
                    tier={c.tier}
                    onClick={() => go({ name: 'profile', id: c.entry.character.id })}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {import.meta.env.DEV && (
        // Dev builds only; players open it by long-pressing the version in Settings.
        <div className={styles.actions}>
          <Button variant="ghost" onClick={() => go({ name: 'debug' })}>
            Debug panel
          </Button>
        </div>
      )}

      <Sheet
        open={heatOpen}
        onClose={() => setHeatOpen(false)}
        title="Tonight's heat"
        description="How far the story goes. Characters react to it as themselves."
        footer={
          <Button variant="primary" onClick={() => setHeatOpen(false)}>
            Done
          </Button>
        }
      >
        <HeatControl value={heat} onChange={(h) => void update({ heat: h })} />
      </Sheet>
    </main>
  )
}
