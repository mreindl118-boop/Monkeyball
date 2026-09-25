import { useEffect, useMemo, useState } from 'react'
import { getAllRelationships } from '../../db/repo'
import { useDebug } from '../../store/debug'
import { useNav } from '../../store/nav'
import { parseDebugRolls, readDebugRolls, writeDebugRolls, type DebugRolls } from '../../store/rolls'
import { maskApiKeys, useSettings } from '../../store/settings'
import type { DebugEntry, Relationship, Settings } from '../../types'
import { APP_VERSION } from '../../ui/appVersion'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { CodeBlock } from '../../ui/CodeBlock'
import { Field } from '../../ui/Field'
import { TextInput } from '../../ui/Inputs'
import { Note } from '../../ui/Panel'
import { Tabs } from '../../ui/Tabs'
import { TopBar } from '../../ui/TopBar'
import styles from './Debug.module.css'
import { maskKey } from './mask'
import { buildPreviews, PROMPT_KINDS, type PromptKind } from './previews'
import { TranscriptTab } from './TranscriptTab'

type TabId = 'prompts' | 'raw' | 'transcript' | 'state'

const KIND_LABELS: Record<DebugEntry['kind'], string> = {
  story: 'Story',
  judge: 'Judge',
  agreement: 'Agreement',
  suggestions: 'Suggestions',
  memory: 'Memory',
  test: 'Connection test',
  image: 'Image',
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })

function maskedSettings(s: Settings): Settings {
  return { ...s, connection: maskApiKeys(s.connection, maskKey) }
}

function json(v: unknown): string {
  return JSON.stringify(v, null, 2)
}

function PromptsTab() {
  const lastByKind = useDebug((s) => s.lastByKind)
  const profile = useSettings((s) => s.profile)
  const settings = useSettings((s) => s.settings)
  const previews = useMemo(
    () => buildPreviews({ profile, settings }),
    [profile, settings],
  )
  const anyPreview = PROMPT_KINDS.some((k) => !lastByKind[k]?.prompt)

  return (
    <div className={styles.stack}>
      {anyPreview && (
        <Note tone="brass" title="Some of these are previews">
          Until a date sends a prompt, it's assembled here with the real builders from Nova's card, a
          fresh relationship, your profile and heat {settings.heat}. Previews are never sent.
        </Note>
      )}
      {PROMPT_KINDS.map((kind: PromptKind) => {
        const last = lastByKind[kind]
        const sent = !!last?.prompt
        return (
          <section key={kind} className={styles.kind} aria-label={`${KIND_LABELS[kind]} prompt`}>
            <div className={styles.kindHead}>
              <h2 className={styles.kindTitle}>{KIND_LABELS[kind]}</h2>
              {sent ? (
                <Chip tone="lipstick">Last sent at {timeFmt.format(last!.at)}</Chip>
              ) : (
                <Chip tone="brass">Live preview</Chip>
              )}
            </div>
            <CodeBlock
              title={sent ? `${KIND_LABELS[kind]} prompt as sent` : `${KIND_LABELS[kind]} prompt preview with Nova`}
              text={sent ? last!.prompt : previews[kind]}
            />
          </section>
        )
      })}
    </div>
  )
}

function RawTab() {
  const entries = useDebug((s) => s.entries)
  const clear = useDebug((s) => s.clear)
  const newestFirst = useMemo(() => [...entries].reverse(), [entries])

  if (!entries.length) {
    return (
      <div className={styles.empty}>
        <strong>Nothing logged yet</strong>
        <p>Every model and image call shows up here with its prompt and raw response.</p>
      </div>
    )
  }

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {entries.length === 1 ? '1 call' : `${entries.length} calls`}, newest first
        </span>
        <Button variant="ghost" size="small" onClick={clear}>
          Clear log
        </Button>
      </div>
      <ul className={styles.entries}>
        {newestFirst.map((e) => (
          <li key={e.id}>
            <details className={styles.entry}>
              <summary className={styles.summary}>
                <span className={styles.entryKind}>{KIND_LABELS[e.kind] ?? e.kind}</span>
                <span className={styles.entryMeta}>{timeFmt.format(e.at)}</span>
                {e.characterId && <Chip>{e.characterId}</Chip>}
                {e.error ? (
                  <Chip tone="lipstick">Error</Chip>
                ) : e.response === undefined ? (
                  <Chip>Waiting</Chip>
                ) : null}
              </summary>
              <div className={styles.entryBody}>
                {e.error && (
                  <Note tone="lipstick" title="Error">
                    {e.error}
                  </Note>
                )}
                <CodeBlock title="Prompt" text={e.prompt} maxHeight={320} />
                {e.messages && e.messages.length > 1 && (
                  <CodeBlock title="Messages" text={json(e.messages)} maxHeight={320} />
                )}
                <CodeBlock title="Response" text={e.response ?? ''} empty="No response yet." maxHeight={320} />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  )
}

function rollsText(r: DebugRolls): string {
  switch (r.kind) {
    case 'succeed':
      return 'Every roll succeeds: word always gets around, rekindles and offers always happen.'
    case 'fail':
      return 'Every roll fails: no gossip spreads, nobody rekindles or brings up what you are.'
    case 'seed':
      return `Seeded with ${r.seed}: the same rolls every time the app starts.`
    default:
      return 'Random, as in the app.'
  }
}

/**
 * Dev builds only: pin the game's random rolls (src/store/rolls.ts) so a run repeats. Blank is
 * random; "succeed", "fail" or a number (a seed).
 */
function RollsField() {
  const [text, setText] = useState(() => {
    const r = readDebugRolls()
    return r.kind === 'seed' ? String(r.seed) : r.kind === 'random' ? '' : r.kind
  })
  const change = (v: string) => {
    setText(v)
    writeDebugRolls(v)
  }
  return (
    <Field label="Random rolls" htmlFor="debug-rolls" hint={`Dev builds only. Blank, succeed, fail or a seed number. ${rollsText(parseDebugRolls(text))}`}>
      <TextInput value={text} onChange={change} placeholder="Random" autoComplete="off" spellCheck={false} />
    </Field>
  )
}

function StateTab() {
  const settings = useSettings((s) => s.settings)
  const profile = useSettings((s) => s.profile)
  const [rels, setRels] = useState<Relationship[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      setRels(await getAllRelationships())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    let alive = true
    getAllRelationships()
      .then((r) => {
        if (alive) setRels(r)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <span className={styles.count}>crushLAB {APP_VERSION}. The API key is masked.</span>
        <Button variant="ghost" size="small" onClick={load}>
          Refresh
        </Button>
      </div>
      {import.meta.env.DEV && <RollsField />}
      <CodeBlock title="Settings" text={json(maskedSettings(settings))} />
      <CodeBlock title="Player profile" text={profile ? json(profile) : ''} empty="No profile yet." />
      {error ? (
        <Note tone="lipstick" title="Couldn't read relationships">
          {error}
        </Note>
      ) : (
        <CodeBlock
          title={rels ? `Relationships (${rels.length})` : 'Relationships'}
          text={rels && rels.length ? json(rels) : ''}
          empty={rels ? 'No relationships yet. They appear after a first date.' : 'Loading…'}
        />
      )}
    </div>
  )
}

/** The debug panel: prompts, raw responses, transcript and state. Opened by long-pressing the version. */
export default function Debug() {
  const back = useNav((s) => s.back)
  const [tab, setTab] = useState<TabId>('prompts')

  return (
    <main className={`screen ${styles.root}`}>
      <TopBar title="Debug panel" onBack={back} />
      <p className={styles.intro}>
        What the app sends and receives. The log lives in memory and clears when the app closes.
      </p>
      <Tabs<TabId>
        aria-label="Debug sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'prompts', label: 'Prompts', content: <PromptsTab /> },
          { id: 'raw', label: 'Responses', content: <RawTab /> },
          { id: 'transcript', label: 'Transcript', content: <TranscriptTab /> },
          { id: 'state', label: 'State', content: <StateTab /> },
        ]}
      />
    </main>
  )
}
