import { useEffect, useRef, useState } from 'react'
import { JUDGE_TEMPERATURE, listModels } from '../../llm/client'
import { testConnection, type ConnectionTestResult } from '../../llm/diagnose'
import { PRESET_LIST, presetFor } from '../../llm/presets'
import { useSettings } from '../../store/settings'
import type { ConnectionPreset } from '../../types'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { MaskedInput, Select, Slider, TextInput, type SelectOption } from '../../ui/Inputs'
import { Note } from '../../ui/Panel'
import { Segmented, type SegmentedOption } from '../../ui/Segmented'
import { Stepper } from '../../ui/Stepper'
import styles from './ConnectionForm.module.css'
import { hostModeOf, localBaseUrl, LOCAL_PORTS, type HostMode } from './connectionHelpers'

const PRESET_OPTIONS: SegmentedOption<ConnectionPreset>[] = PRESET_LIST.map((p) => ({
  value: p.id,
  label: p.label,
  description: p.help,
}))

const HOST_OPTIONS: SegmentedOption<HostMode>[] = [
  { value: 'device', label: 'This device' },
  { value: 'lan', label: 'PC on my Wi-Fi' },
]

function CheckIcon() {
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

function modelOptions(models: string[], current: string, sameLabel?: string): SelectOption[] {
  const opts: SelectOption[] = []
  if (sameLabel !== undefined) opts.push({ value: '', label: sameLabel })
  else if (!current) opts.push({ value: '', label: 'Pick a model' })
  if (current && !models.includes(current)) {
    opts.push({ value: current, label: `${current} (not on this server)` })
  }
  for (const m of models) opts.push({ value: m, label: m })
  return opts
}

export interface ConnectionFormProps {
  /** Called after every Test connection run. */
  onTested?: (result: ConnectionTestResult) => void
  idPrefix?: string
}

/**
 * The model connection form, shared by ConnectionSetup and Settings. Every change persists
 * straight to settings.
 */
export function ConnectionForm({ onTested, idPrefix = 'conn' }: ConnectionFormProps) {
  const conn = useSettings((s) => s.settings.connection)
  const updateConnection = useSettings((s) => s.updateConnection)
  const preset = presetFor(conn.preset)
  const isLocal = conn.preset in LOCAL_PORTS

  const [listed, setModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ConnectionTestResult | null>(null)
  const initialHost = hostModeOf(conn.baseUrl)
  const [hostMode, setHostMode] = useState<HostMode>(initialHost.mode)
  const [lanHost, setLanHost] = useState(initialHost.host)
  const testAbort = useRef<AbortController | null>(null)
  const models = conn.baseUrl.trim() ? listed : []

  // Quietly list models whenever the URL or key settles, so the model pickers fill themselves.
  const hasUrl = !!conn.baseUrl.trim()
  useEffect(() => {
    if (!hasUrl) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      const current = useSettings.getState().settings.connection
      listModels(current, { signal: ctrl.signal, timeoutMs: 8000 })
        .then((list) => {
          if (!ctrl.signal.aborted) setModels(list)
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setModels([])
        })
    }, 600)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [hasUrl, conn.baseUrl, conn.apiKey])

  useEffect(() => () => testAbort.current?.abort(), [])

  const clearResult = () => setResult(null)

  const pickPreset = (id: ConnectionPreset) => {
    const p = presetFor(id)
    clearResult()
    setHostMode('device')
    setLanHost('')
    void updateConnection({ preset: id, baseUrl: p.baseUrl || conn.baseUrl })
  }

  const pickHostMode = (mode: HostMode) => {
    setHostMode(mode)
    clearResult()
    if (mode === 'device') void updateConnection({ baseUrl: localBaseUrl(conn.preset, 'device', '') })
    else if (lanHost.trim()) void updateConnection({ baseUrl: localBaseUrl(conn.preset, 'lan', lanHost) })
  }

  const changeLanHost = (host: string) => {
    setLanHost(host)
    clearResult()
    if (host.trim()) void updateConnection({ baseUrl: localBaseUrl(conn.preset, 'lan', host) })
  }

  const runTest = async () => {
    testAbort.current?.abort()
    const ctrl = new AbortController()
    testAbort.current = ctrl
    setTesting(true)
    setResult(null)
    try {
      const current = useSettings.getState().settings.connection
      const r = await testConnection(current, { signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setResult(r)
      if (r.models.length) setModels(r.models)
      if (r.ok && !current.storyModel.trim() && r.models[0]) {
        await updateConnection({ storyModel: r.models[0] })
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

  const keyHint =
    preset.key === 'required'
      ? `${preset.label} needs a key. It stays on this device.`
      : preset.key === 'none'
        ? `${preset.label} doesn't need one; leave it blank. Anything you enter stays on this device.`
        : 'Only if your server asks for one. It stays on this device.'

  return (
    <div className={styles.form}>
      <Field label="Where your model runs" kind="group" htmlFor={`${idPrefix}-preset`}>
        <Segmented variant="cards" cardMin={200} maxColumns={2} value={conn.preset} options={PRESET_OPTIONS} onChange={pickPreset} />
      </Field>

      {isLocal && (
        <div className={styles.where}>
          <Field label={`Where is ${preset.label} running?`} kind="group" htmlFor={`${idPrefix}-host`}>
            <Segmented value={hostMode} options={HOST_OPTIONS} onChange={pickHostMode} />
          </Field>
          {hostMode === 'lan' ? (
            <>
              <Field
                label="Your PC's address"
                htmlFor={`${idPrefix}-lanhost`}
                hint={`The PC's local IP, like 192.168.1.20. Port ${LOCAL_PORTS[conn.preset]} is added for you.`}
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
                {conn.preset === 'ollama' ? (
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
              {conn.preset === 'ollama'
                ? 'On a computer, that is Ollama on the same machine. On a phone, it means Ollama running on the phone itself, for example in Termux.'
                : 'LM Studio on this same computer, with its local server started.'}
            </p>
          )}
        </div>
      )}

      <Field
        label="Base URL"
        htmlFor={`${idPrefix}-baseurl`}
        hint="The address of an OpenAI-compatible API. It usually ends in /v1."
      >
        <TextInput
          value={conn.baseUrl}
          onChange={(baseUrl) => {
            clearResult()
            void updateConnection({ baseUrl })
          }}
          placeholder={preset.baseUrl || 'https://example.com/v1'}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          mono
        />
      </Field>

      <Field
        label="API key"
        optional={preset.key !== 'required'}
        htmlFor={`${idPrefix}-apikey`}
        hint={keyHint}
      >
        <MaskedInput
          value={conn.apiKey}
          onChange={(apiKey) => {
            clearResult()
            void updateConnection({ apiKey })
          }}
          noun="API key"
          placeholder={preset.key === 'required' ? 'sk-or-...' : 'Not needed'}
        />
      </Field>

      <div className={styles.testRow}>
        <Button variant="secondary" loading={testing} onClick={runTest}>
          Test connection
        </Button>
        {testing && (
          <Button
            variant="ghost"
            onClick={() => {
              testAbort.current?.abort()
              setTesting(false)
            }}
          >
            Stop
          </Button>
        )}
      </div>
      {testing && (
        <p className={styles.stepDetail} role="status">
          Listing models, then asking for a tiny reply. A local model may need a moment to load.
        </p>
      )}
      {result && <TestResultView result={result} />}

      <div className={styles.grid2}>
        <Field
          label="Story model"
          htmlFor={`${idPrefix}-story`}
          hint={models.length ? 'Plays the characters and writes the scenes.' : 'Type a model name, or test the connection to pick from a list.'}
        >
          {models.length ? (
            <Select
              value={conn.storyModel}
              options={modelOptions(models, conn.storyModel)}
              onChange={(storyModel) => void updateConnection({ storyModel })}
            />
          ) : (
            <TextInput
              value={conn.storyModel}
              onChange={(storyModel) => void updateConnection({ storyModel })}
              placeholder="llama3.1:8b"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              mono
            />
          )}
        </Field>
        <Field
          label="Judge model"
          htmlFor={`${idPrefix}-judge`}
          hint="Scores each message. A smaller, faster model works well."
        >
          {models.length ? (
            <Select
              value={conn.judgeModel}
              options={modelOptions(models, conn.judgeModel, 'Same as story model')}
              onChange={(judgeModel) => void updateConnection({ judgeModel })}
            />
          ) : (
            <TextInput
              value={conn.judgeModel}
              onChange={(judgeModel) => void updateConnection({ judgeModel })}
              placeholder="Same as story model"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              mono
            />
          )}
        </Field>
      </div>

      <div className={styles.grid2}>
        <Field
          label="Story temperature"
          htmlFor={`${idPrefix}-temp`}
          hint="Higher is looser and more surprising. 0.9 is a good start."
        >
          <Slider
            value={conn.storyTemperature}
            min={0}
            max={2}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(storyTemperature) => void updateConnection({ storyTemperature })}
          />
        </Field>
        <Field label="Max tokens" htmlFor={`${idPrefix}-maxtokens`} hint="The longest a single reply can be.">
          <Stepper
            value={conn.maxTokens}
            min={100}
            max={4000}
            step={50}
            name="max tokens"
            onChange={(maxTokens) => void updateConnection({ maxTokens })}
          />
        </Field>
      </div>

      <div className={styles.info}>
        <span>Judge temperature is fixed so scoring stays steady.</span>
        <strong>{JUDGE_TEMPERATURE.toFixed(1)}</strong>
      </div>
    </div>
  )
}
