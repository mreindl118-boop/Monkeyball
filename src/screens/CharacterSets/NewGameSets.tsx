import { useEffect } from 'react'
import { selectSetEntries, useRoster } from '../../store/roster'
import { useSettings } from '../../store/settings'
import { Field } from '../../ui/Field'
import { Toggle } from '../../ui/Toggle'
import { ensureRoster } from '../Hub/useRosterGame'
import styles from './NewGameSets.module.css'
import { newGameSetRows } from './setsModel'

/**
 * "Who's in town": the character sets a new game starts with, as switches (onboarding). Each
 * switch saves at once (settings.activeSets), the same setting Character sets changes later.
 * Optional: the defaults stand if the player never touches it. The last set in play stays on.
 */
export function NewGameSets({ idPrefix = 'new-game' }: { idPrefix?: string }) {
  const sets = useRoster((s) => s.sets)
  const entries = useRoster((s) => s.entries)
  const loaded = useRoster((s) => s.loaded)
  const setActive = useRoster((s) => s.setActive)
  const activeSets = useSettings((s) => s.settings.activeSets)

  useEffect(() => {
    void ensureRoster()
  }, [])

  const rows = newGameSetRows(sets, activeSets, (id) => selectSetEntries({ sets, entries }, id).length)
  if (!loaded && rows.length === 0) return null
  // One set means nothing to choose.
  if (rows.length < 2) return null

  return (
    <Field
      label="Who's in town"
      kind="group"
      htmlFor={`${idPrefix}-sets`}
      hint="Sets in play fill the city together. Leave these as they are to start with Afterhours; Character sets changes it any time, and progress is kept."
    >
      <div
        className={styles.list}
        id={`${idPrefix}-sets`}
        role="group"
        aria-labelledby={`${idPrefix}-sets-label`}
        aria-describedby={`${idPrefix}-sets-hint`}
      >
        {rows.map((r) => (
          <Toggle
            key={r.id}
            id={`${idPrefix}-set-${r.id}`}
            className={styles.row}
            checked={r.on}
            disabled={r.locked}
            onChange={(on) => void setActive(r.id, on)}
            label={
              <>
                <span className={styles.name}>{r.name}</span>
                <span className={styles.count}>{r.count}</span>
              </>
            }
            description={r.locked ? `${r.blurb} At least one set stays in play.` : r.blurb}
          />
        ))}
      </div>
    </Field>
  )
}
