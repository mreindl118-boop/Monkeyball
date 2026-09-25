// Settings, Image generation (docs/SPEC.md, "Art and gallery"; ARCHITECTURE, "Art providers").
// The on switch, the provider (Grok Imagine with the Grok key from Connection, or an
// Automatic1111/Forge server on this device or a PC on the Wi-Fi), each one's own options, the
// style preset and its editable prefix, the locked safety text shown read-only, and Test image
// generation, which paints one small picture and shows it here.

import { useEffect, useId, useRef, useState } from 'react'
import { buildImagePrompt, IMAGE_SAFETY, sceneFor } from '../../art/imagePrompt'
import { apiKeyFor, providerById } from '../../art/providers'
import { BUNDLED_CHARACTERS, bundledEntry } from '../../data/bundled'
import { useDebug } from '../../store/debug'
import { DEFAULT_STYLE_PREFIXES } from '../../store/defaults'
import { useNav } from '../../store/nav'
import { useSettings } from '../../store/settings'
import type { ArtSlot } from '../../art/types'
import type { ImageAspectRatio, ImageProvider, Settings, StylePreset } from '../../types'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { Select, TextArea, TextInput } from '../../ui/Inputs'
import { Note } from '../../ui/Panel'
import { Segmented, type SegmentedOption } from '../../ui/Segmented'
import { Stepper } from '../../ui/Stepper'
import { Toggle } from '../../ui/Toggle'
import type { HostMode } from '../ConnectionSetup/connectionHelpers'
import styles from './ImageSection.module.css'
import {
  A1111_PORT,
  DEFAULT_GROK_IMAGE_MODEL,
  GROK_ASPECTS,
  PROVIDER_HELP,
  a1111Host,
  a1111Url,
  aspectRatio,
  grokModel,
  hasGrokKey,
  imageProvider,
  samplerChoices,
  testImageSettings,
} from './imageModel'
import sectionStyles from './Settings.module.css'

const STYLE_OPTIONS: SegmentedOption<StylePreset>[] = [
  { value: 'anime', label: 'Anime' },
  { value: 'semiReal', label: 'Semi-real' },
  { value: 'painterly', label: 'Painterly' },
]

const PROVIDER_OPTIONS: SegmentedOption<ImageProvider>[] = [
  { value: 'grok', label: 'Grok Imagine', description: PROVIDER_HELP.grok },
  { value: 'a1111', label: 'Automatic1111 or Forge', description: PROVIDER_HELP.a1111 },
]

const HOST_OPTIONS: SegmentedOption<HostMode>[] = [
  { value: 'device', label: 'On this device' },
  { value: 'lan', label: 'PC on my Wi-Fi' },
]

const ASPECT_OPTIONS: SegmentedOption<ImageAspectRatio>[] = GROK_ASPECTS.map((a) => ({ value: a, label: a }))

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={styles.lockIcon}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** Settings' Connection section, scrolled to (the Grok key lives on its Grok card). */
function useJumpToConnection() {
  const replace = useNav((s) => s.replace)
  return () => {
    replace({ name: 'settings', section: 'connection' })
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    document.getElementById('settings-connection')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }
}

export function ImageSection() {
  const settings = useSettings((st) => st.settings)
  const updateImage = useSettings((st) => st.updateImage)
  const img = settings.image
  const provider = imageProvider(img)
  const prefix = img.stylePrefixes[img.stylePreset]
  const isDefaultPrefix = prefix === DEFAULT_STYLE_PREFIXES[img.stylePreset]
  // What the server listed on the last test: samplers from A1111, models from Grok Imagine.
  const [listed, setListed] = useState<{ provider: ImageProvider; items: string[] } | null>(null)
  const serverList = listed?.provider === provider ? listed.items : null

  const setPrefix = (text: string) => void updateImage({ stylePrefixes: { ...img.stylePrefixes, [img.stylePreset]: text } })

  return (
    <div className={sectionStyles.stack}>
      <Toggle
        checked={img.enabled}
        onChange={(enabled) => void updateImage({ enabled })}
        label="Generate art"
        description="Paint each tier as it unlocks, and ending art, when there's no image of your own or from the set. Painted once and kept. Off shows placeholders."
      />

      <Field label="Who paints them" kind="group">
        <Segmented variant="cards" cardMin={240} value={provider} options={PROVIDER_OPTIONS} onChange={(p) => void updateImage({ provider: p })} />
      </Field>

      {provider === 'grok' ? (
        <GrokFields settings={settings} models={serverList} />
      ) : (
        <A1111Fields settings={settings} samplers={serverList} />
      )}

      <Field label="Style" kind="group">
        <Segmented value={img.stylePreset} options={STYLE_OPTIONS} onChange={(stylePreset) => void updateImage({ stylePreset })} />
      </Field>

      <Field
        label="Style prefix"
        htmlFor="img-prefix"
        aside={
          isDefaultPrefix ? undefined : (
            <Button variant="ghost" size="small" onClick={() => setPrefix(DEFAULT_STYLE_PREFIXES[img.stylePreset])}>
              Restore default
            </Button>
          )
        }
        hint="Goes at the start of every prompt for this style. Edit freely: it sets the look, never the safety text."
      >
        <TextArea value={prefix} onChange={setPrefix} rows={3} mono />
      </Field>

      <SafetyText provider={provider} />

      <ImageTest onListed={(items) => setListed({ provider, items })} />
    </div>
  )
}

function GrokFields({ settings, models }: { settings: Settings; models: string[] | null }) {
  const updateImage = useSettings((st) => st.updateImage)
  const jump = useJumpToConnection()
  const img = settings.image
  const listId = useId()
  const keyed = hasGrokKey(settings)
  return (
    <div className={styles.group}>
      {keyed ? (
        <p className={styles.fine}>Uses the key saved on the Grok card in Connection.</p>
      ) : (
        <Note tone="lipstick" title="No Grok key yet">
          <span className={styles.noteBody}>
            Grok Imagine uses your xAI key from the Grok card in Connection.
            <Button variant="secondary" size="small" onClick={jump}>
              Go to Connection
            </Button>
          </span>
        </Note>
      )}
      <Field
        label="Model"
        htmlFor="img-grok-model"
        hint={
          models?.length
            ? `Your key can use ${models.length === 1 ? 'one image model' : `${models.length} image models`}; pick from the list or type one.`
            : `${DEFAULT_GROK_IMAGE_MODEL} unless xAI has a newer one. Test image generation lists what your key can use.`
        }
      >
        <TextInput
          value={img.grokModel ?? ''}
          placeholder={DEFAULT_GROK_IMAGE_MODEL}
          onChange={(v) => void updateImage({ grokModel: v })}
          onBlur={() => {
            if (!img.grokModel?.trim()) void updateImage({ grokModel: grokModel(img) })
          }}
          list={models?.length ? listId : undefined}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          mono
        />
      </Field>
      {models && models.length > 0 && (
        <datalist id={listId}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}
      <Field label="Shape" kind="group" hint="Portrait (2:3) suits character art.">
        <Segmented value={aspectRatio(img)} options={ASPECT_OPTIONS} onChange={(a) => void updateImage({ aspectRatio: a })} />
      </Field>
      <Note title="Seed">
        Grok Imagine picks its own seed, so Seed doesn't apply here. Each character keeps their look from the art tags on their card.
      </Note>
    </div>
  )
}

function A1111Fields({ settings, samplers }: { settings: Settings; samplers: string[] | null }) {
  const updateImage = useSettings((st) => st.updateImage)
  const img = settings.image
  const initial = a1111Host(img.baseUrl)
  const [hostMode, setHostMode] = useState<HostMode>(initial.mode)
  const [lanHost, setLanHost] = useState(initial.host)
  const options = samplerChoices(img.sampler, samplers).map((v) => ({ value: v, label: v }))

  const pickHostMode = (mode: HostMode) => {
    setHostMode(mode)
    if (mode === 'device') void updateImage({ baseUrl: a1111Url('device', '') })
    else if (lanHost.trim()) void updateImage({ baseUrl: a1111Url('lan', lanHost) })
  }
  const changeLanHost = (host: string) => {
    setLanHost(host)
    if (host.trim()) void updateImage({ baseUrl: a1111Url('lan', host) })
  }

  return (
    <div className={styles.group}>
      <div className={styles.where}>
        <Field label="Where is it running?" kind="group">
          <Segmented value={hostMode} options={HOST_OPTIONS} onChange={pickHostMode} />
        </Field>
        {hostMode === 'lan' ? (
          <>
            <Field
              label="Your PC's address"
              htmlFor="img-lanhost"
              hint={`The PC's local IP, like 192.168.1.20. Port ${A1111_PORT} is added for you.`}
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
              Launch it with <code>--api --listen --cors-allow-origins=*</code> so it answers on your network. This works in
              the Android app. The web version, served over https, can't reach plain http addresses on your network.
            </Note>
          </>
        ) : (
          <p className={styles.fine}>
            A server on this same machine, launched with <code>--api --cors-allow-origins=*</code>. On a phone, that means one
            running on the phone itself; most people pick PC on my Wi-Fi.
          </p>
        )}
      </div>

      <Field label="Server address" htmlFor="img-url" hint="Filled in from the choice above; change it if your server uses another port.">
        <TextInput
          value={img.baseUrl}
          onChange={(baseUrl) => void updateImage({ baseUrl })}
          placeholder={`http://127.0.0.1:${A1111_PORT}`}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          mono
        />
      </Field>

      <div className={sectionStyles.grid2}>
        <Field label="Width" htmlFor="img-w">
          <Stepper value={img.width} min={512} max={1536} step={64} unit="px" name="width" onChange={(width) => void updateImage({ width })} />
        </Field>
        <Field label="Height" htmlFor="img-h">
          <Stepper value={img.height} min={512} max={1536} step={64} unit="px" name="height" onChange={(height) => void updateImage({ height })} />
        </Field>
        <Field label="Steps" htmlFor="img-steps">
          <Stepper value={img.steps} min={4} max={80} name="steps" onChange={(steps) => void updateImage({ steps })} />
        </Field>
        <Field label="CFG scale" htmlFor="img-cfg">
          <Stepper value={img.cfg} min={2} max={15} step={0.5} name="CFG scale" onChange={(cfg) => void updateImage({ cfg })} />
        </Field>
      </div>

      <div className={sectionStyles.grid2}>
        <Field
          label="Sampler"
          htmlFor="img-sampler"
          hint={samplers?.length ? "From your server's list." : 'Test image generation reads the list from your server.'}
        >
          <Select value={img.sampler} options={options} onChange={(sampler) => void updateImage({ sampler })} />
        </Field>
        <Field
          label="Seed"
          kind="group"
          hint={img.seedMode === 'fixed' ? 'Each character keeps one seed, so they look consistent across tiers.' : 'A new seed every time.'}
        >
          <Segmented
            value={img.seedMode}
            options={[
              { value: 'fixed', label: 'Fixed per character' },
              { value: 'random', label: 'Random' },
            ]}
            onChange={(seedMode) => void updateImage({ seedMode })}
          />
        </Field>
      </div>
    </div>
  )
}

/** The locked safety text, read-only: what every prompt gets, whatever the prefix or a mod says. */
function SafetyText({ provider }: { provider: ImageProvider }) {
  const titleId = useId()
  return (
    <section className={styles.locked} aria-labelledby={titleId}>
      <h3 className={styles.lockedTitle} id={titleId}>
        <LockIcon />
        Safety text
      </h3>
      <p className={styles.lockedNote}>
        Safety text is added to every image prompt automatically and can't be edited. Every character is also described as an
        adult with their age, like "adult woman, 28 years old".
      </p>
      <dl className={styles.clauses}>
        <div>
          <dt>Every prompt ends with</dt>
          <dd>
            <blockquote className={styles.clause}>{IMAGE_SAFETY.positiveClause}</blockquote>
          </dd>
        </div>
        {provider === 'grok' ? (
          <div>
            <dt>Grok Imagine has no negative prompt, so its prompts also say</dt>
            <dd>
              <blockquote className={styles.clause}>{IMAGE_SAFETY.grokClause}</blockquote>
            </dd>
          </div>
        ) : (
          <div>
            <dt>Every negative prompt starts with</dt>
            <dd>
              <blockquote className={styles.clause}>{IMAGE_SAFETY.negative}</blockquote>
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}

type TestState = (
  | { phase: 'idle' }
  | { phase: 'testing' | 'painting'; message?: string }
  | { phase: 'failed'; message: string }
  | { phase: 'done'; message: string; url: string }
) & {
  /** The provider the result is for (another provider's result isn't shown). */
  provider?: ImageProvider
}

const IDLE: TestState = { phase: 'idle' }

/** The character the test picture shows: a bundled adult card, sweet heat, tier 1. */
function testCharacter() {
  return bundledEntry('nova')?.character ?? BUNDLED_CHARACTERS[0]?.character
}

/** Why the provider can't be tried yet, or '' when it can. */
function missingText(s: Settings): string {
  if (imageProvider(s.image) === 'grok') return hasGrokKey(s) ? '' : 'Add your xAI key on the Grok card in Connection first.'
  return s.image.baseUrl.trim() ? '' : "Add your server's address first."
}

function ImageTest({ onListed }: { onListed: (items: string[]) => void }) {
  const [result, setState] = useState<TestState>(IDLE)
  const abortRef = useRef<AbortController | null>(null)
  const urlRef = useRef<string | null>(null)
  const provider = useSettings((st) => imageProvider(st.settings.image))

  const dropUrl = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
  }
  useEffect(
    () => () => {
      abortRef.current?.abort()
      dropUrl()
    },
    [],
  )
  // Another provider: a test in flight stops, and the last result (someone else's) isn't shown.
  useEffect(() => {
    abortRef.current?.abort()
  }, [provider])
  const state = result.provider && result.provider !== provider ? IDLE : result

  const run = async () => {
    abortRef.current?.abort()
    dropUrl()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const current = useSettings.getState().settings
    const id = imageProvider(current.image)
    // Only the latest run speaks; one stopped by a provider switch goes back to idle.
    const show = (next: TestState) => {
      if (abortRef.current === ctrl) setState({ ...next, provider: id })
    }
    // The test runs whether or not "Generate art" is on yet.
    const s: Settings = { ...current, image: { ...current.image, enabled: true, provider: id } }
    const missing = missingText(s)
    if (missing) {
      show({ phase: 'failed', message: missing })
      return
    }
    const p = providerById(id)
    if (!p.available(s)) {
      show({ phase: 'failed', message: 'The image settings above are missing something this provider needs.' })
      return
    }
    show({ phase: 'testing' })
    let debugId: string | null = null
    try {
      const t = await p.test(s, ctrl.signal)
      if (ctrl.signal.aborted) throw new DOMException('Stopped', 'AbortError')
      // A1111 lists its samplers, Grok Imagine the image models the key can use.
      const listed = p.id === 'a1111' ? t.samplers : t.models
      if (listed?.length) onListed(listed)
      if (!t.ok) {
        show({ phase: 'failed', message: t.message })
        return
      }
      show({ phase: 'painting', message: t.message })
      const character = testCharacter()
      if (!character) {
        show({ phase: 'done', message: t.message, url: '' })
        return
      }
      const slot: ArtSlot = { kind: 'tier', characterId: character.id, tier: 1 }
      const small = testImageSettings(s.image)
      const built = buildImagePrompt({ slot, characters: [character], heat: 1, settings: small, scene: sceneFor(slot, [character]) })
      debugId = useDebug.getState().log({
        kind: 'image',
        characterId: character.id,
        prompt: `Test image (${p.label})\n\nPrompt:\n${built.prompt}\n\nNegative prompt:\n${p.id === 'grok' ? 'Grok Imagine has no negative prompt: the safety clause is at the start and the end of the prompt.' : built.negative}`,
      })
      const apiKey = apiKeyFor(s)
      const out = await p.generate({ prompt: built.prompt, negative: built.negative, seed: built.seed, settings: small, ...(apiKey ? { apiKey } : {}) }, ctrl.signal)
      if (ctrl.signal.aborted) throw new DOMException('Stopped', 'AbortError')
      useDebug.getState().patch(debugId, { response: `Test image: ${out.blob.type || 'image'}, ${Math.round(out.blob.size / 1024)} KB, seed ${out.seed}.` })
      if (abortRef.current !== ctrl) return
      const url = URL.createObjectURL(out.blob)
      urlRef.current = url
      show({ phase: 'done', message: 'It works: here is a small test picture.', url })
    } catch (e) {
      if (ctrl.signal.aborted) {
        if (debugId) useDebug.getState().patch(debugId, { error: 'Stopped.' })
        show(IDLE)
        return
      }
      const message = e instanceof Error ? e.message : String(e)
      if (debugId) useDebug.getState().patch(debugId, { error: message })
      show({ phase: 'failed', message })
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
    }
  }

  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setState(IDLE)
  }

  const busy = state.phase === 'testing' || state.phase === 'painting'
  return (
    <div className={styles.test}>
      <div className={styles.testRow}>
        <Button variant="secondary" loading={busy} onClick={() => void run()}>
          Test image generation
        </Button>
        {busy && (
          <Button variant="ghost" onClick={stop}>
            Stop
          </Button>
        )}
      </div>
      <p className={styles.fine} aria-live="polite">
        {state.phase === 'testing'
          ? 'Checking the server'
          : state.phase === 'painting'
            ? 'Painting a small test picture'
            : state.phase === 'idle'
              ? provider === 'grok'
                ? 'Paints one small picture. xAI bills it like any other.'
                : 'Checks the server, reads its samplers and paints one small picture.'
              : ''}
      </p>
      {state.phase === 'failed' && (
        <Note tone="lipstick" title="Image generation isn't working yet" role="alert">
          {state.message}
        </Note>
      )}
      {state.phase === 'done' && (
        <div className={styles.result} role="status">
          {state.url && <img className={styles.testImage} src={state.url} alt="The test picture" decoding="async" />}
          <p className={styles.resultText}>{state.message}</p>
        </div>
      )}
    </div>
  )
}
