import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import styles from './Tabs.module.css'

export interface TabDef<T extends string> {
  id: T
  label: ReactNode
  content: ReactNode
}

export interface TabsProps<T extends string> {
  tabs: TabDef<T>[]
  value: T
  onChange: (id: T) => void
  'aria-label': string
}

/** Tabs with arrow-key navigation. Only the active panel is rendered. */
export function Tabs<T extends string>({ tabs, value, onChange, ...aria }: TabsProps<T>) {
  const base = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const active = tabs.find((t) => t.id === value) ?? tabs[0]

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    refs.current[next]?.focus()
    onChange(tabs[next].id)
  }

  return (
    <div>
      <div role="tablist" aria-label={aria['aria-label']} className={styles.list}>
        {tabs.map((t, i) => {
          const selected = t.id === active.id
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              className={styles.tab}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel-${active.id}`}
        aria-labelledby={`${base}-tab-${active.id}`}
        tabIndex={0}
        className={styles.panel}
      >
        {active.content}
      </div>
    </div>
  )
}
