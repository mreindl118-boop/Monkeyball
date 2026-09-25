import type { ConnectionTestResult } from '../../llm/diagnose'
import { Note } from '../../ui/Panel'
import styles from './ConnectionForm.module.css'

export function CheckIcon() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2.5 7.5 5.5 10.5 11.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3.5 3.5l7 7m0-7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Step-by-step result of a connection test, with the fix for whatever failed. */
export function TestResultView({ result }: { result: ConnectionTestResult }) {
  return (
    <div className={styles.result}>
      <ul className={styles.steps} aria-label="Connection test steps">
        {result.steps.map((s, i) => (
          <li key={i} className={styles.stepItem}>
            <span className={`${styles.stepIcon} ${s.ok ? styles.okIcon : styles.failIcon}`}>
              {s.ok ? <CheckIcon /> : <CrossIcon />}
            </span>
            <span>
              <span className={styles.stepLabel}>
                {s.label}
                <span className="visually-hidden">{s.ok ? ', passed' : ', failed'}</span>
              </span>
              {s.detail && <span className={styles.stepDetail}>{s.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
      {result.ok ? (
        <Note tone="brass" title="Connected" role="status">
          {result.models.length === 1
            ? 'The server answered and one model is available.'
            : `The server answered and ${result.models.length} models are available.`}
        </Note>
      ) : result.problem ? (
        <Note tone="lipstick" title={result.problem.message} role="alert">
          <span className={styles.fix}>{result.problem.fix}</span>
        </Note>
      ) : null}
    </div>
  )
}
