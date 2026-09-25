import { useNav } from '../../store/nav'
import { useSettings } from '../../store/settings'
import { Button } from '../../ui/Button'
import { HeatControl } from '../../ui/HeatControl'
import { Panel } from '../../ui/Panel'
import { Wordmark } from '../../ui/Wordmark'
import { ConnectionStatus } from './ConnectionStatus'
import styles from './Hub.module.css'

function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Morning'
  if (hour < 18) return 'Afternoon'
  return 'Evening'
}

/** Phase 1 hub: greeting, heat, connection status. Phase 2 replaces it with the roster. */
export default function Hub() {
  const profile = useSettings((s) => s.profile)
  const heat = useSettings((s) => s.settings.heat)
  const update = useSettings((s) => s.update)
  const go = useNav((s) => s.go)
  const greeting = greetingFor(new Date().getHours())

  return (
    <main className={`screen ${styles.root}`} aria-labelledby="hub-title">
      <div className={styles.top}>
        <Wordmark size={28} />
        <Button variant="ghost" size="small" onClick={() => go({ name: 'settings' })}>
          Settings
        </Button>
      </div>

      <div className={styles.greeting}>
        <h1 className={styles.hello} id="hub-title">
          {greeting}
          {profile ? (
            <>
              , <span className={styles.name}>{profile.name}</span>
            </>
          ) : null}
          {greeting === 'Still up' ? '?' : '.'}
        </h1>
        <p className={styles.sub}>
          The city's roster opens with the next update. Until then, set the mood and make sure your
          model is ready.
        </p>
      </div>

      <ConnectionStatus />

      <Panel title="Tonight's heat" description="How far the story goes. Characters react to it as themselves.">
        <HeatControl value={heat} onChange={(h) => void update({ heat: h })} compact label="Heat" />
      </Panel>

      <Panel tone="flat" as="div">
        <div className={styles.soon}>
          <div className={styles.coasters} aria-hidden="true">
            <span className={styles.coaster} />
            <span className={styles.coaster} />
            <span className={styles.coaster} />
          </div>
          <p>
            Twelve regulars from Afterhours are on their way: a DJ, a bartender, a tattoo artist and
            more. Their coasters land here.
          </p>
        </div>
      </Panel>

      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => go({ name: 'settings' })}>
          Settings
        </Button>
        <Button variant="ghost" onClick={() => go({ name: 'debug' })}>
          Debug panel
        </Button>
      </div>
    </main>
  )
}
