import type { ReactNode } from 'react'
import { Chip } from '../../ui/Chip'
import { Field } from '../../ui/Field'
import { useField } from '../../ui/fieldContext'
import styles from './Editor.module.css'

export interface CheckChipsProps {
  /** Element id (the summary focuses it). */
  id: string
  label: ReactNode
  hint?: ReactNode
  error?: string
  options: readonly { value: string; label: string }[]
  selected: readonly string[]
  onToggle: (value: string, on: boolean) => void
}

function Group({ options, selected, onToggle }: Pick<CheckChipsProps, 'options' | 'selected' | 'onToggle'>) {
  const f = useField()
  return (
    <div
      id={f.id}
      role="group"
      tabIndex={-1}
      aria-labelledby={f.labelId}
      aria-describedby={f.describedBy}
      className={styles.chips}
    >
      {options.map((o) => {
        const on = selected.includes(o.value)
        return (
          <Chip key={o.value} selected={on} onClick={() => onToggle(o.value, !on)}>
            {o.label}
          </Chip>
        )
      })}
    </div>
  )
}

/** Several choices as toggle chips (aria-pressed), labelled as one group. */
export function CheckChips({ id, label, hint, error, options, selected, onToggle }: CheckChipsProps) {
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id} kind="group">
      <Group options={options} selected={selected} onToggle={onToggle} />
    </Field>
  )
}
