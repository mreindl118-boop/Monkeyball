import { useMemo, useState } from 'react'
import { useNav } from '../../store/nav'
import { CUSTOM_SET_ID, useRoster } from '../../store/roster'
import { Button } from '../../ui/Button'
import { Panel } from '../../ui/Panel'
import { TopBar } from '../../ui/TopBar'
import { useRosterAndGame } from '../Hub/useRosterGame'
import styles from './Editor.module.css'
import { EditorForm } from './EditorForm'
import { EditorList } from './EditorList'
import { NEW_CHARACTER_ID, draftOf, newDraft } from './editorModel'

/** #/editor lists every character; #/editor/:id edits one; #/editor/_new starts a new one. */
export default function Editor() {
  const screen = useNav((s) => s.screen)
  const id = screen.name === 'editor' ? screen.id : undefined
  const ready = useRosterAndGame()
  if (!id) return <EditorList ready={ready} />
  return <EditorRoute key={id} id={id} ready={ready} />
}

function EditorRoute({ id, ready }: { id: string; ready: boolean }) {
  const back = useNav((s) => s.back)
  const replace = useNav((s) => s.replace)
  const current = useRoster((s) => (id === NEW_CHARACTER_ID ? undefined : s.entries[id]))
  // A save that renames the character removes this id a moment before the route moves to the
  // new one; keep showing the card meanwhile.
  const [seen, setSeen] = useState(current)
  if (current && current !== seen) setSeen(current)
  const entry = current ?? seen
  const initial = useMemo(() => (entry ? draftOf(entry.character) : newDraft()), [entry])

  if (id === NEW_CHARACTER_ID) {
    return <EditorForm initial={initial} setId={CUSTOM_SET_ID} previousId={null} />
  }
  if (!entry) {
    return (
      <main className={`screen ${styles.root}`}>
        <TopBar title="Character editor" onBack={back} />
        {ready ? (
          <Panel title="Nobody by that id" description={`There's no character "${id}" on this device.`}>
            <div className={styles.noteActions}>
              <Button variant="primary" onClick={() => replace({ name: 'editor' })}>
                All characters
              </Button>
            </div>
          </Panel>
        ) : (
          <p className={styles.fine} role="status">
            Opening the card
          </p>
        )}
      </main>
    )
  }
  return (
    <EditorForm
      initial={initial}
      setId={entry.setId}
      previousId={entry.character.id}
      readOnly={entry.source === 'bundled'}
    />
  )
}
