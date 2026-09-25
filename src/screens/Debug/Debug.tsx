import { useEffect, useMemo, useState } from 'react'
import { getAllRelationships } from '../../db/repo'
import { useDebug } from '../../store/debug'
import { useGame } from '../../store/game'
import { useNav } from '../../store/nav'
import { parseDebugRolls, readDebugRolls, writeDebugRolls, type DebugRolls } from '../../store/rolls'
import { useRoster } from '../../store/roster'
import { maskApiKeys, useSettings } from '../../store/settings'
import type { DebugEntry, Relationship, Settings } from '../../types'
import { APP_VERSION } from '../../ui/appVersion'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { CodeBlock } from '../../ui/CodeBlock'
import { Field } from '../../ui/Field'
import { Select, TextInput } from '../../ui/Inputs'
import { Note } from '../../ui/Panel'
import { Segmented } from '../../ui/Segmented'
import { Tabs } from '../../ui/Tabs'
import { TopBar } from '../../ui/TopBar'
import { useRosterAndGame } from '../Hub/useRosterGame'
import styles from './Debug.module.css'
import { maskKey } from './mask'
import { buildPreviews, previewCharacter, PROMPT_KINDS, type PromptKind } from './previews'
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

type PromptSource = 'sent' | 'preview'

/** Characters the previews can be built with, by name (the bundled sets and anyone added). */
function usePreviewCast(): { value: string; label: string }[] {
  const entries = useRoster((s) => s.entries)
  return useMemo(
    () =>
      Object.values(entries)
        .map((e) => ({ value: e.character.id, label: e.character.name.trim() || e.character.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [entries],
  )
}

function PromptsTab() {
  useRosterAndGame()
  const lastByKind = useDebug((s) => s.lastByKind)
  const profile = useSettings((s) => s.profile)
  const settings = useSettings((s) => s.settings)
  const [source, setSource] = useState<PromptSource>('sent')
  const [who, setWho] = useState('nova')
  const cast = usePreviewCast()
  const entry = useRoster((s) => s.entries[who])
  const rel = useGame((s) => s.relationships[who])
  const entries = useRoster((s) => s.entries)
  const names = useMemo(() => {
    const out: Record<string, string> = {}
    for (const e of Object.values(entries)) out[e.character.id] = e.character.name.trim().split(/\s+/)[0] || e.character.id
    return out
  }, [entries])
  const character = entry?.character ?? previewCharacter()
  const first = character.name.trim().split(/\s+/)[0] || character.id
  const previews = useMemo(
    () => buildPreviews({ profile, settings, character, ...(rel ? { rel } : {}), ...(Object.keys(names).length ? { names } : {}) }),
    [profile, settings, character, rel, names],
  )
  const anyPreview = source === 'preview' || PROMPT_KINDS.some((k) => !lastByKind[k]?.prompt)

  return (
    <div className={styles.stack}>
      <div className={styles.previewControls}>
        <Field label="Show" kind="group">
          <Segmented<PromptSource>
            value={source}
            options={[
              { value: 'sent', label: 'Last sent' },
              { value: 'preview', label: 'Live preview' },
            ]}
            onChange={setSource}
          />
        </Field>
        <Field label="Preview with" htmlFor="debug-preview-with" hint="Their card, and where you stand with them now.">
          <Select value={entry ? who : 'nova'} options={cast.length ? cast : [{ value: 'nova', label: 'Nova Castellanos' }]} onChange={setWho} />
        </Field>
      </div>
      {anyPreview && (
        <Note tone="brass" title={source === 'preview' ? 'Live previews' : 'Some of these are previews'}>
          {source === 'preview' ? 'Every prompt here is' : "Until a date sends a prompt, it's"} assembled with the real builders
          from {first}'s card, where you stand with {first} now, your profile, heat {settings.heat} and the image settings.
          Previews are never sent.
        </Note>
      )}
      {PROMPT_KINDS.map((kind: PromptKind) => {
        const last = lastByKind[kind]
        const sent = source === 'sent' && !!last?.prompt
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
              title={sent ? `${KIND_LABELS[kind]} prompt as sent` : `${KIND_LABELS[kind]} prompt preview with ${first}`}
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
