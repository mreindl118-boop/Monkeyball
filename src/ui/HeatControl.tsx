import { useId, useRef, type KeyboardEvent } from 'react'
import { HEAT_LEVELS, clampHeat } from '../data/heat'
import { rolePreset } from '../llm/routes'
import { useSettings } from '../store/settings'
import type { HeatLevel } from '../types'
import { cx } from './cx'
import styles from './HeatControl.module.css'
import { Kiss } from './Kiss'

export interface HeatControlProps {
  value: HeatLevel
  onChange: (level: HeatLevel) => void
  /** Smaller pips without names, for the hub. */
  compact?: boolean
  label?: string
  className?: string
  /**
   * Show the provider-policy note at heat 4 and 5. Defaults to whether Claude or ChatGPT writes
   * the story in the current settings.
   */
  policyNote?: boolean
}

/** Shown under heat 4 and 5 when Claude or ChatGPT writes the story. */
export const PROVIDER_POLICY_NOTE =
  "Claude and ChatGPT follow their providers' content policies and usually won't write explicit scenes; expect heat 4-5 to be declined or toned down. Local or OpenRouter models are the way to play at 4-5."

function sentence(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** The 1-5 heat picker: five lipstick-kiss pips, the level's name and its description. */
export function HeatControl({
  value,
  onChange,
  compact,
  label = 'Heat',
  className,
  policyNote,
}: HeatControlProps) {
  const id = useId()
  const storyPreset = useSettings((s) => rolePreset(s.settings.connection, 'story'))
  const showPolicy = (policyNote ?? (storyPreset === 'claude' || storyPreset === 'chatgpt')) && value >= 4
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const levels = Object.values(HEAT_LEVELS)
  const current = levels.find((h) => h.level === value) ?? levels[0]

  const select = (level: number, focus: boolean) => {
    const next = clampHeat(level)
    if (focus) refs.current[next - 1]?.focus()
    if (next !== value) onChange(next)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const map: Record<string, number> = {
      ArrowRight: value + 1,
      ArrowUp: value + 1,
      ArrowLeft: value - 1,
      ArrowDown: value - 1,
      Home: 1,
      End: 5,
    }
    if (e.key in map) {
      e.preventDefault()
      select(map[e.key], true)
    }
  }

  return (
    <div className={cx(styles.root, compact && styles.compact, className)}>
      <div className={styles.head}>
        <span className={styles.label} id={`${id}-label`}>
          {label}
        </span>
        <span className={styles.current} aria-hidden="true">
          <b>{current.level}</b> {current.name}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-desc`}
        className={styles.pips}
        onKeyDown={onKeyDown}
      >
        {levels.map((h) => {
          const selected = h.level === value
          return (
            <button
              key={h.level}
              ref={(el) => {
                refs.current[h.level - 1] = el
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${h.level}, ${h.name}`}
              tabIndex={selected ? 0 : -1}
              data-level={h.level}
              className={cx(styles.pip, h.level <= value && styles.on, selected && styles.selected)}
              onClick={() => select(h.level, false)}
            >
              <Kiss className={styles.kiss} filled={h.level <= value} />
              <span className={styles.pipName} aria-hidden="true">
                {h.name}
              </span>
            </button>
          )
        })}
      </div>
      <p className={styles.description} id={`${id}-desc`} aria-live="polite">
        {sentence(current.description)}
      </p>
      {showPolicy && <p className={styles.policy}>{PROVIDER_POLICY_NOTE}</p>}
    </div>
  )
}
