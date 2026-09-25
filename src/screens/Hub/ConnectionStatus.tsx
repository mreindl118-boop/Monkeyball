import { useEffect, useState } from 'react'
import { listModels } from '../../llm/client'
import { normalizeBaseUrl, presetFor } from '../../llm/presets'
import { useNav } from '../../store/nav'
import { useSettings } from '../../store/settings'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import styles from './Hub.module.css'

type Status =
  | { state: 'checking' }
  | { state: 'ok'; models: string[] }
  | { state: 'fail'; message: string }

type Result = Exclude<Status, { state: 'checking' }> & { key: string }

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return normalizeBaseUrl(url) || 'no address set'
  }
}

/** One line on whether the model server answers, with a way to fix it when it doesn't. */
export function ConnectionStatus() {
  const conn = useSettings((s) => s.settings.connection)
  const go = useNav((s) => s.go)
  const [result, setResult] = useState<Result | null>(null)
  const [attempt, setAttempt] = useState(0)
  const hasUrl = !!conn.baseUrl.trim()
  // A result only counts for the address, key and attempt it was made for.
  const key = `${conn.baseUrl}|${conn.apiKey}|${attempt}`

  useEffect(() => {
    if (!hasUrl) return
    const ctrl = new AbortController()
    const current = useSettings.getState().settings.connection
    listModels(current, { signal: ctrl.signal, timeoutMs: 8000 })
      .then((models) => {
        if (!ctrl.signal.aborted) setResult({ key, state: 'ok', models })
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) {
          setResult({ key, state: 'fail', message: e instanceof Error ? e.message : String(e) })
        }
      })
    return () => ctrl.abort()
  }, [key, hasUrl])

  const status: Status = !hasUrl
    ? { state: 'fail', message: 'No model server set up yet.' }
    : result && result.key === key
      ? result
      : { state: 'checking' }

  const host = hostOf(conn.baseUrl)
  const label = presetFor(conn.preset).label
  const model = conn.storyModel.trim()
  const modelMissing = status.state === 'ok' && model && !status.models.includes(model)

  let title: string
  let detail: string
  if (status.state === 'checking') {
    title = `Checking ${label} at ${host}`
    detail = 'Asking the server which models it has.'
  } else if (status.state === 'ok') {
    title = `Connected to ${label} at ${host}`
    detail = !model
      ? 'No story model picked yet. Choose one in the connection settings.'
      : modelMissing
        ? `The story model "${model}" isn't on this server.`
        : `Story model: ${model}.`
  } else {
    title = `Can't reach ${label} at ${host}`
    detail = status.message
  }

  const needsFix = status.state === 'fail' || !model || modelMissing

  return (
    <div className={styles.status} role="status" aria-live="polite">
      <span
        className={cx(
          styles.dot,
          status.state === 'checking' && styles.dotChecking,
          status.state === 'ok' && !needsFix && styles.dotOk,
          needsFix && status.state !== 'checking' && styles.dotFail,
        )}
        aria-hidden="true"
      />
      <span className={styles.statusTitle}>{title}</span>
      <span className={styles.statusDetail}>{detail}</span>
      {status.state !== 'checking' && needsFix && (
        <span className={styles.statusActions}>
          <Button size="small" variant="primary" onClick={() => go({ name: 'connection-setup' })}>
            Fix connection
          </Button>
          <Button size="small" variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </span>
      )}
    </div>
  )
}
