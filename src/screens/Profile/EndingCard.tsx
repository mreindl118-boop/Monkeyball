// "Your ending" on the profile, once a character reaches 100: the ending you're on (title in
// Bodoni, its description), then Play the epilogue (the ending screen explains why before it plays)
// or Not yet, which folds the card down to one line for this visit.

import { useState } from 'react'
import { useNav } from '../../store/nav'
import type { Character } from '../../types'
import { Button } from '../../ui/Button'
import { Panel } from '../../ui/Panel'
import { playedEnding, readyLine } from '../Ending/endingModel'
import { useEnding } from '../Ending/useEnding'
import styles from './Profile.module.css'

export function EndingCard({ character }: { character: Character }) {
  const go = useNav((s) => s.go)
  const { ready, ending, rel } = useEnding(character.id)
  const [later, setLater] = useState(false)
  if (!ready || !ending) return null

  const name = character.name.trim() || character.id
  const played = !!playedEnding(rel)
  const toEnding = () => go({ name: 'ending', id: character.id })

  if (later) {
    return (
      <div className={styles.endingFolded}>
        <p className={styles.caption}>
          Your ending with {name.split(/\s+/)[0]} is waiting: <span className={styles.endingInline}>{ending.title}</span>.
        </p>
        <Button variant="secondary" size="small" onClick={() => setLater(false)}>
          Show it
        </Button>
      </div>
    )
  }

  return (
    <Panel title="Your ending" tone="brass" className={styles.section}>
      <div className={styles.ending}>
        <p className={styles.endingTitle}>{ending.title}</p>
        {ending.description && <p className={styles.endingDescription}>{ending.description}</p>}
        <p className={styles.caption}>{readyLine(name, played)}</p>
      </div>
      <div className={styles.endingActions}>
        <Button variant="brass" onClick={toEnding}>
          {played ? 'Play the epilogue again' : 'Play the epilogue'}
        </Button>
        <Button variant="ghost" onClick={() => setLater(true)}>
          Not yet
        </Button>
      </div>
    </Panel>
  )
}
