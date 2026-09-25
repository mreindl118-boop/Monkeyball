import { useId, useState } from 'react'
import type { ConnectionTestResult } from '../../llm/diagnose'
import { MAIN_PRESETS, OTHER_PRESETS, presetFor } from '../../llm/presets'
import { rolePreset } from '../../llm/routes'
import { useSettings } from '../../store/settings'
import type { ConnectionPreset } from '../../types'
import { cx } from '../../ui/cx'
import styles from './ConnectionForm.module.css'
import { slotUsable } from './connectionHelpers'
import { ProviderCard } from './ProviderCard'
import { RolePickers } from './RolePickers'

export { TestResultView } from './TestResult'

export interface ConnectionFormProps {
  /** Called after every Test connection run, on any provider. */
  onTested?: (result: ConnectionTestResult) => void
  idPrefix?: string
}

/**
 * The model connection form, shared by ConnectionSetup and Settings: provider cards (Claude,
 * ChatGPT, Grok, then other providers), each with its own key and Test connection, and the two
 * roles (story and judge), each a provider plus a model. Every change persists straight away.
 */
export function ConnectionForm({ onTested, idPrefix = 'conn' }: ConnectionFormProps) {
  const conn = useSettings((s) => s.settings.connection)
  const providersTitle = useId()
  const rolesTitle = useId()
  const othersBody = useId()

  // Open the cards for the providers the roles use, so the key field is right there.
  const [open, setOpen] = useState<ReadonlySet<ConnectionPreset>>(() => {
    const story = rolePreset(conn, 'story')
    const judge = rolePreset(conn, 'judge')
    const ids = new Set<ConnectionPreset>([story])
    if (judge !== story && !slotUsable(conn, judge)) ids.add(judge)
    return ids
  })
  const [othersOpen, setOthersOpen] = useState(
    () => presetFor(rolePreset(conn, 'story')).group === 'other' || presetFor(rolePreset(conn, 'judge')).group === 'other',
  )

  const toggle = (id: ConnectionPreset) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const card = (id: ConnectionPreset) => (
    <ProviderCard
      key={id}
      preset={id}
      idPrefix={idPrefix}
      expanded={open.has(id)}
      onToggle={() => toggle(id)}
      onTested={onTested}
    />
  )

  return (
    <div className={styles.form}>
      <section className={styles.section} aria-labelledby={providersTitle}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle} id={providersTitle}>
            Providers
          </h3>
          <p className={styles.sectionHelp}>
            Set up one or more with your own API key. Each key is stored only on this device and only
            ever sent to its own provider.
          </p>
        </div>
        <div className={styles.cards}>{MAIN_PRESETS.map((p) => card(p.id))}</div>
        <div className={cx(styles.card, othersOpen && styles.cardOpen)}>
          <button
            type="button"
            className={styles.cardHead}
            aria-expanded={othersOpen}
            aria-controls={othersBody}
            onClick={() => setOthersOpen((v) => !v)}
          >
            <span className={styles.cardTitleRow}>
              <span className={styles.cardName}>Other providers</span>
            </span>
            <span className={styles.cardHelp}>
              Ollama and LM Studio on your computer, your Wi-Fi or this phone, OpenRouter, or any
              OpenAI-compatible server.
            </span>
            <svg viewBox="0 0 16 16" aria-hidden="true" className={styles.chevron}>
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div id={othersBody} className={cx(styles.cardBody, styles.nested)} hidden={!othersOpen}>
            {OTHER_PRESETS.map((p) => card(p.id))}
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby={rolesTitle}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle} id={rolesTitle}>
            Roles
          </h3>
          <p className={styles.sectionHelp}>
            Mix and match: one provider can write the story while another judges.
          </p>
        </div>
        <RolePickers idPrefix={idPrefix} />
      </section>
    </div>
  )
}
