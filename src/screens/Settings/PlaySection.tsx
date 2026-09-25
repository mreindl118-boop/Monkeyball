import { useSettings } from '../../store/settings'
import type { ShowMe } from '../../types'
import { Field } from '../../ui/Field'
import { HeatControl } from '../../ui/HeatControl'
import { Segmented, type SegmentedOption } from '../../ui/Segmented'
import { Stepper } from '../../ui/Stepper'
import { Toggle } from '../../ui/Toggle'
import { ORIENTATION_OPTIONS } from '../Onboarding/profile'
import styles from './Settings.module.css'

const SHOW_ME: SegmentedOption<ShowMe>[] = [
  { value: 'women', label: 'Women' },
  { value: 'men', label: 'Men' },
  { value: 'everyone', label: 'Everyone' },
]

export function PlaySection() {
  const s = useSettings((st) => st.settings)
  const update = useSettings((st) => st.update)

  return (
    <div className={styles.stack}>
      <Field label="Who's into you" kind="group" htmlFor="play-orientation">
        <Segmented
          variant="cards"
          value={s.orientationMode}
          options={ORIENTATION_OPTIONS}
          onChange={(orientationMode) => void update({ orientationMode })}
        />
      </Field>

      <HeatControl value={s.heat} onChange={(heat) => void update({ heat })} />

      <Field
        label="Show me"
        kind="group"
        htmlFor="play-showme"
        hint="Filters the roster. Nobody's progress is lost."
      >
        <Segmented value={s.showMe} options={SHOW_ME} onChange={(showMe) => void update({ showMe })} />
      </Field>

      <div className={styles.toggles}>
        <Toggle
          checked={s.hints}
          onChange={(hints) => void update({ hints })}
          label="Show hints"
          description="See each reaction's hint and the affection and trust changes during a date. Off means you read reactions blind."
        />
        <Toggle
          checked={s.suggestions}
          onChange={(suggestions) => void update({ suggestions })}
          label="Reply suggestions"
          description="Three ideas after each reply. Tapping one fills the input; it never sends for you."
        />
      </div>

      <div className={styles.grid2}>
        <Field label="Date length" htmlFor="play-length" hint="Your messages per date.">
          <Stepper
            value={s.dateLength}
            min={4}
            max={20}
            unit="turns"
            name="date length"
            onChange={(dateLength) => void update({ dateLength })}
          />
        </Field>
        <Field
          label="Most affection per date"
          htmlFor="play-cap"
          hint="Caps what one date can add. Losses aren't capped."
        >
          <Stepper
            value={s.gainCap}
            min={5}
            max={50}
            name="per-date gain cap"
            onChange={(gainCap) => void update({ gainCap })}
          />
        </Field>
      </div>
    </div>
  )
}
