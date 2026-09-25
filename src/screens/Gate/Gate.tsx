import { useState } from 'react'
import { useSettings } from '../../store/settings'
import { Button } from '../../ui/Button'
import { Kiss } from '../../ui/Kiss'
import { Panel } from '../../ui/Panel'
import { Wordmark } from '../../ui/Wordmark'
import styles from './Gate.module.css'

export interface GateProps {
  /** Called after the player confirms their age (App decides where to go next). */
  onConfirmed?: () => void
}

/** First-launch 18+ confirmation. Nothing else is reachable until it's answered. */
export default function Gate({ onConfirmed }: GateProps) {
  const update = useSettings((s) => s.update)
  const [declined, setDeclined] = useState(false)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await update({ ageConfirmed: true })
      onConfirmed?.()
    } finally {
      setBusy(false)
    }
  }

  if (declined) {
    return (
      <main className={`screen ${styles.root}`}>
        <Wordmark size={40} kiss={false} />
        <div className={styles.exit} role="status">
          <h2>Thanks for being honest</h2>
          <p>
            crushLAB is only for adults, so this is where we part ways. Nothing was saved about you.
            Take care out there.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className={`screen ${styles.root}`} aria-labelledby="gate-title">
      <div className={styles.hero}>
        <Wordmark as="h1" size={56} />
        <p className={styles.tagline}>A dating sim where every character is played by a language model.</p>
      </div>

      <Panel className={styles.card} as="div">
        <h2 className={styles.lede} id="gate-title">
          Before you come in
        </h2>
        <ul className={styles.list}>
          <li className={styles.item}>
            <Kiss className={styles.icon} />
            <p>
              <strong>Adults only.</strong>
              <span>crushLAB has sexual content, and you need to be 18 or older to play.</span>
            </p>
          </li>
          <li className={styles.item}>
            <Kiss className={styles.icon} />
            <p>
              <strong>Everyone here is a fictional adult.</strong>
              <span>
                Every character is 21 or older, with a job and a life of their own. None of them are
                real people.
              </span>
            </p>
          </li>
          <li className={styles.item}>
            <Kiss className={styles.icon} />
            <p>
              <strong>Intimacy is always consensual.</strong>
              <span>Anyone can say no, stop, or leave, and pushing past that costs you.</span>
            </p>
          </li>
          <li className={styles.item}>
            <Kiss className={`${styles.icon} ${styles.iconBrass}`} />
            <p>
              <strong>It stays on this device.</strong>
              <span>
                Your profile, progress, characters and saves never leave it. The only thing sent
                anywhere is the story itself, to the model you connect.
              </span>
            </p>
          </li>
        </ul>
      </Panel>

      <div className={styles.actions}>
        <Button variant="primary" block loading={busy} onClick={confirm}>
          I'm 18 or older
        </Button>
        <Button variant="ghost" block onClick={() => setDeclined(true)} disabled={busy}>
          I'm not
        </Button>
      </div>
      <p className={styles.fine}>No analytics, no accounts, no tracking.</p>
    </main>
  )
}
