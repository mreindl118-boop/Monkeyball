import { useState } from 'react'
import { useNav } from '../../store/nav'
import { Button } from '../../ui/Button'
import { Note, Panel } from '../../ui/Panel'
import { TopBar } from '../../ui/TopBar'
import { Wordmark } from '../../ui/Wordmark'
import { ConnectionForm } from './ConnectionForm'
import { takeOnboardingProblem } from './lastCheck'
import styles from './ConnectionSetup.module.css'

/** Connect a model. Shown after onboarding when no model answered, and from the hub. */
export default function ConnectionSetup() {
  const stack = useNav((s) => s.stack)
  const back = useNav((s) => s.back)
  const reset = useNav((s) => s.reset)
  const firstRun = stack.length === 0
  const [problem] = useState(takeOnboardingProblem)

  const toHub = () => reset({ name: 'hub' })

  return (
    <main className={`screen ${styles.root}`} aria-labelledby="connection-title">
      {firstRun ? (
        <Wordmark size={30} />
      ) : (
        <TopBar title="Model connection" onBack={back} />
      )}
      <div className={styles.intro}>
        <h2 className={styles.title} id="connection-title">
          Connect a model
        </h2>
        <p className={styles.sub}>
          Bring your own Claude, ChatGPT or Grok API key, or run a model yourself with Ollama or LM
          Studio. Pick a provider, paste its key and test it; both roles start on it. Your characters,
          saves and settings stay on this device.
        </p>
      </div>

      {problem && (
        <Note tone="lipstick" title={problem.message} role="status">
          {problem.fix} Set up a provider below and test it, or skip this and come back from
          Settings.
        </Note>
      )}

      <Panel as="div">
        <ConnectionForm idPrefix="setup" />
      </Panel>

      <div className={styles.actions}>
        <Button variant="ghost" onClick={toHub}>
          Skip for now
        </Button>
        <Button variant="primary" onClick={toHub}>
          Continue
        </Button>
      </div>
    </main>
  )
}
