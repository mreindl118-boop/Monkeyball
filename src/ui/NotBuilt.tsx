import { Button } from './Button'
import { Kiss } from './Kiss'
import styles from './NotBuilt.module.css'
import { Panel } from './Panel'
import { TopBar } from './TopBar'

export interface NotBuiltProps {
  /** What the player tried to open, e.g. "Profile". */
  what?: string
  onBack: () => void
  onHub?: () => void
}

/** Placeholder for screens that arrive in a later phase. */
export function NotBuilt({ what, onBack, onHub }: NotBuiltProps) {
  return (
    <main className="screen">
      <TopBar title={what ?? 'Coming soon'} onBack={onBack} />
      <div className={styles.wrap}>
        <Panel className={styles.panel} title="Not built yet" as="div">
          <Kiss className={styles.kiss} />
          <p>This part of the night opens with a later update. Nothing you've done so far is lost.</p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onBack}>
              Go back
            </Button>
            {onHub && (
              <Button variant="ghost" onClick={onHub}>
                Hub
              </Button>
            )}
          </div>
        </Panel>
      </div>
    </main>
  )
}
