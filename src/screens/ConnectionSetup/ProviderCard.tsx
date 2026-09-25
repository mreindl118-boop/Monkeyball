import { useEffect, useId, useRef, useState } from 'react'
import { roleTakesEffort, testConnection, type ConnectionTestResult } from '../../llm'
import { presetFor } from '../../llm/presets'
import { resolveRoute, rolePreset, slotFor } from '../../llm/routes'
import { useSettings } from '../../store/settings'
import type { ConnectionPreset, Effort } from '../../types'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Field } from '../../ui/Field'
import { MaskedInput, TextInput } from '../../ui/Inputs'
import { Note } from '../../ui/Panel'
import { Segmented, type SegmentedOption } from '../../ui/Segmented'
import styles from './ConnectionForm.module.css'
import {
  afterTestPatch,
  bothRolesPatch,
  hostModeOf,
  LOCAL_PORTS,
  localBaseUrl,
  slotSignature,
  slotUsable,
  type HostMode,
} from './connectionHelpers'
import { useModelLists, usePresetModels, usePresetReady } from './modelLists'
import { CheckIcon, TestResultView } from './TestResult'

const HOST_OPTIONS: SegmentedOption<HostMode>[] = [
  { value: 'device', label: 'On this device' },
  { value: 'lan', label: 'PC on my Wi-Fi' },
]

const EFFORT_OPTIONS: SegmentedOption<Effort>[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

export interface ProviderCardProps {
  preset: ConnectionPreset
  idPrefix: string
  expanded: boolean
  onToggle: () => void
  /** Called after every Test connection run. */
  onTested?: (result: ConnectionTestResult) => void
}

/** Chevron that turns when the card opens (decoration, not an arrow on a button label). */
function Chevron() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={styles.chevron}>
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** One provider: key or address, Test connection, and its own settings. Changes persist at once. */
export function ProviderCard({ preset, idPrefix, expanded, onToggle, onTested }: ProviderCardProps) {
  const p = presetFor(preset)
  const conn = useSettings((s) => s.settings.connection)
  const updateProvider = useSettings((s) => s.updateProvider)
  const updateConnection = useSettings((s) => s.updateConnection)
  const slot = slotFor(conn, preset)
  const ready = usePresetReady(preset)
  const models = usePresetModels(preset)
  const bodyId = useId()
  const id = `${idPrefix}-${preset}`

  const storyHere = rolePreset(conn, 'story') === preset
  const judgeHere = rolePreset(conn, 'judge') === preset
  const keyMissing = p.key === 'required' && !slot.apiKey.trim()
  const isLocal = preset in LOCAL_PORTS

  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ConnectionTestResult | null>(null)
  const initialHost = hostModeOf(slot.baseUrl)
  const [hostMode, setHostMode] = useState<HostMode>(initialHost.mode)
  const [lanHost, setLanHost] = useState(initialHost.host)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const clearResult = () => setResult(null)

  const setBaseUrl = (baseUrl: string) => {
    clearResult()
    void updateProvider(preset, { baseUrl })
  }

  const pickHostMode = (mode: HostMode) => {
    setHostMode(mode)
    if (mode === 'device') setBaseUrl(localBaseUrl(preset, 'device', ''))
    else if (lanHost.trim()) setBaseUrl(localBaseUrl(preset, 'lan', lanHost))
  }

  const changeLanHost = (host: string) => {
    setLanHost(host)
    if (host.trim()) setBaseUrl(localBaseUrl(preset, 'lan', host))
  }

  const runTest = async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setTesting(true)
    setResult(null)
    const lists = useModelLists.getState()
    try {
      const current = useSettings.getState().settings.connection
      const sig = slotSignature(slotFor(current, preset))
      const r = await testConnection(current, { preset, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setResult(r)
      if (r.models.length) lists.put(preset, sig, r.models)
      lists.markReady(preset, r.ok ? sig : null)
      if (r.ok) {
        const patch = afterTestPatch(useSettings.getState().settings.connection, preset, r.models)
        if (patch) await updateConnection(patch)
      }
      onTested?.(r)
    } catch (e) {
      if (ctrl.signal.aborted) return
      const r: ConnectionTestResult = {
        ok: false,
        models: [],
        steps: [],
        problem: {
          kind: 'other',
          message: 'The test stopped with an unexpected error.',
          fix: e instanceof Error ? e.message : String(e),
        },
      }
      setResult(r)
      onTested?.(r)
    } finally {
      if (!ctrl.signal.aborted) setTesting(false)
    }
  }

  const stopTest = () => {
    abortRef.current?.abort()
    setTesting(false)
  }

  const adoptForBoth = () => void updateConnection(bothRolesPatch(conn, preset, models))

  const roles = [storyHere && 'Story', judgeHere && 'Judge'].filter(Boolean) as string[]
  const status = ready ? 'Ready' : keyMissing ? 'Needs a key' : 'Not tested'

  const keyHint =
    p.key === 'required' ? (
      <>
        Stored only on this device.
        {p.keyUrl && (
          <>
            {' '}
            Get one at{' '}
            <a href={p.keyUrl} target="_blank" rel="noreferrer">
              {p.keySite}
            </a>
            .
          </>
        )}
      </>
    ) : (
      'Only if your server asks for one. Stored only on this device.'
    )

  const storyRoute = resolveRoute(conn, 'story')
  const effortNote =
    storyRoute.preset !== 'claude'
      ? 'Applies when Claude writes the story. Other Claude calls always use low.'
      : roleTakesEffort(conn, 'story')
        ? 'Low answers fastest; high thinks longer for more depth. Low suits chat.'
        : `Not used by ${storyRoute.model}.`

  return (
    <div className={cx(styles.card, expanded && styles.cardOpen)}>
      <button
        type="button"
        className={styles.cardHead}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className={styles.cardTitleRow}>
          <span className={styles.cardName}>{p.label}</span>
          <span className={cx(styles.badge, ready && styles.badgeReady, keyMissing && !ready && styles.badgeMuted)}>
            {ready && <CheckIcon />}
            {status}
          </span>
        </span>
        <span className={styles.cardHelp}>{p.help}</span>
        {roles.length > 0 && (
          <span className={styles.roleTags}>
            {roles.map((r) => (
              <span key={r} className={styles.roleTag}>
                {r === 'Story' ? 'Writes the story' : 'Judges'}
              </span>
            ))}
          </span>
        )}
        <Chevron />
      </button>

      <div id={bodyId} className={styles.cardBody} hidden={!expanded}>
        {isLocal && (
          <div className={styles.where}>
            <Field label={`Where is ${p.label} running?`} kind="group" htmlFor={`${id}-host`}>
              <Segmented value={hostMode} options={HOST_OPTIONS} onChange={pickHostMode} />
            </Field>
            {hostMode === 'lan' ? (
              <>
                <Field
                  label="Your PC's address"
                  htmlFor={`${id}-lanhost`}
                  hint={`The PC's local IP, like 192.168.1.20. Port ${LOCAL_PORTS[preset]} and /v1 are added for you.`}
                >
                  <TextInput
                    value={lanHost}
                    onChange={changeLanHost}
                    placeholder="192.168.1.20"
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    mono
                  />
                </Field>
                <Note title="On the PC">
                  {preset === 'ollama' ? (
                    <>
                      Set <code>OLLAMA_HOST=0.0.0.0</code> so Ollama listens on your network, and{' '}
                      <code>OLLAMA_ORIGINS=*</code> so the app can stream from it, then restart Ollama.
                    </>
                  ) : (
                    <>Turn on "Serve on local network" and CORS in LM Studio's server settings.</>
                  )}{' '}
                  This works in the Android app. The web version, served over https, can't reach plain
                  http addresses on your network.
                </Note>
              </>
            ) : (
              <p className={styles.stepDetail}>
                {preset === 'ollama'
                  ? 'On a phone, that means Ollama running on the phone itself, for example in Termux. On a computer, Ollama on the same machine.'
                  : 'LM Studio on this same computer, with its local server started.'}
              </p>
            )}
          </div>
        )}

        {p.group === 'other' && (
          <Field
            label="Base URL"
            htmlFor={`${id}-baseurl`}
            hint="The address of an OpenAI-compatible API. It usually ends in /v1."
          >
            <TextInput
              value={slot.baseUrl}
              onChange={setBaseUrl}
              placeholder={p.baseUrl || 'https://example.com/v1'}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              mono
            />
          </Field>
        )}

        {p.key !== 'none' && (
          <Field
            label={`${p.label} API key`}
            optional={p.key !== 'required'}
            htmlFor={`${id}-apikey`}
            hint={keyHint}
          >
            <MaskedInput
              value={slot.apiKey}
              onChange={(apiKey) => {
                clearResult()
                void updateProvider(preset, { apiKey })
              }}
              noun={`${p.label} API key`}
              placeholder={p.keyPlaceholder ?? 'Not needed'}
            />
          </Field>
        )}

        {preset === 'claude' && (
          <Field label="Effort" kind="group" htmlFor={`${id}-effort`} hint={effortNote}>
            <Segmented
              value={conn.effort ?? 'low'}
              options={EFFORT_OPTIONS}
              onChange={(effort) => void updateConnection({ effort })}
            />
          </Field>
        )}

        <div className={styles.testRow}>
          <Button variant="secondary" loading={testing} onClick={runTest} aria-label={`Test connection to ${p.label}`}>
            Test connection
          </Button>
          {testing && (
            <Button variant="ghost" onClick={stopTest}>
              Stop
            </Button>
          )}
          {!testing && !(storyHere && judgeHere) && slotUsable(conn, preset) && (
            <Button variant="ghost" onClick={adoptForBoth}>
              Use {p.label} for both roles
            </Button>
          )}
        </div>
        {testing && (
          <p className={styles.stepDetail} role="status">
            {p.group === 'main'
              ? 'Listing models, then asking for a tiny reply.'
              : 'Listing models, then asking for a tiny reply. A local model may need a moment to load.'}
          </p>
        )}
        {result && <TestResultView result={result} />}
      </div>
    </div>
  )
}
