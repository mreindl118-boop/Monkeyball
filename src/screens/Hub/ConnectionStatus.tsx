import { useEffect, useState } from 'react'
import { listModels } from '../../llm'
import { sameModel } from '../../llm/models'
import { normalizeBaseUrl, presetFor } from '../../llm/presets'
import { resolveRoute, routeGap } from '../../llm/routes'
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

/** The listed id for a model, allowing Ollama's :latest and Claude's dated snapshots. */
function isListed(models: readonly string[], model: string): boolean {
  return models.some((m) => sameModel(model, m) || (m.startsWith(`${model}-`) && /-\d{8}$/.test(m)))
}

/** One line on whether the story model's provider answers, with a way to fix it when it doesn't. */
export function ConnectionStatus() {
  const conn = useSettings((s) => s.settings.connection)
  const go = useNav((s) => s.go)
  const [result, setResult] = useState<Result | null>(null)
  const [attempt, setAttempt] = useState(0)
  const route = resolveRoute(conn, 'story')
  const gap = routeGap(route)
  const canCheck = gap !== 'key' && gap !== 'url'
  // A result only counts for the provider, address, key and attempt it was made for.
  const key = `${route.preset}|${route.baseUrl}|${route.apiKey}|${attempt}`

  useEffect(() => {
    if (!canCheck) return
    const ctrl = new AbortController()
    const current = useSettings.getState().settings.connection
    listModels(current, resolveRoute(current, 'story').preset, { signal: ctrl.signal, timeoutMs: 8000 })
      .then((models) => {
        if (!ctrl.signal.aborted) setResult({ key, state: 'ok', models })
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) {
          setResult({ key, state: 'fail', message: e instanceof Error ? e.message : String(e) })
        }
      })
    return () => ctrl.abort()
  }, [key, canCheck])

  const preset = presetFor(route.preset)
  const label = preset.label
  const status: Status = !canCheck
    ? { state: 'fail', message: gap === 'key' ? `${label} needs an API key.` : 'No model server set up yet.' }
    : result && result.key === key
      ? result
      : { state: 'checking' }

  // Hosted providers are named on their own; local and custom servers by their address.
  const where = preset.group === 'main' ? label : `${label} at ${hostOf(route.baseUrl)}`
  const model = route.model.trim()
  const modelMissing = status.state === 'ok' && !!model && status.models.length > 0 && !isListed(status.models, model)
  const keyMissing = gap === 'key'

  let title: string
  let detail: string
  if (keyMissing) {
    title = `${label} needs an API key`
    detail = 'Add your key in the connection settings, or pick another provider.'
  } else if (status.state === 'checking') {
    title = `Checking ${where}`
    detail = 'Asking which models it has.'
  } else if (status.state === 'ok') {
    title = `Connected to ${where}`
    detail = !model
      ? 'No story model picked yet. Choose one in the connection settings.'
      : modelMissing
        ? `The story model "${model}" isn't on this server.`
        : `Story model: ${model}.`
  } else {
    title = `Can't reach ${where}`
    detail = status.message
  }

  const needsFix = status.state === 'fail' || !model || modelMissing || keyMissing

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
          {!keyMissing && (
            <Button size="small" variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          )}
        </span>
      )}
    </div>
  )
}
