import { GIFTS } from '../../data/gifts'
import { HEAT_LEVELS } from '../../data/heat'
import { VENUES } from '../../data/venues'
import { TIER_UNLOCKS } from '../../mods/normalize'
import type { Character, Difficulty, Gender, HeatLevel, Jealousy, PartnerRelation, Secret, Style } from '../../types'
import { Button, IconButton } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { Field } from '../../ui/Field'
import { Select, TextArea, TextInput, type SelectOption } from '../../ui/Inputs'
import { Panel } from '../../ui/Panel'
import { Segmented, type SegmentedOption } from '../../ui/Segmented'
import { Toggle } from '../../ui/Toggle'
import { CheckChips } from './CheckChips'
import { TierImage } from './TierImage'
import styles from './Editor.module.css'
import {
  OPPOSITE,
  TRAIT_SECTIONS,
  parseOptionalNumber,
  toggleIn,
  withLabel,
  type PlaceKey,
  type TraitKey,
} from './editorModel'

/** What every section needs from the form. */
export interface FormApi {
  draft: Character
  set: (patch: Partial<Character>) => void
  /** Messages for a field's control, once it has been touched (or the summary is open). */
  error: (field: string) => string | undefined
  touch: (field: string) => void
  /** Element id for a field's control. */
  anchor: (field: string) => string
  /** Trait ids the saved card already has: they don't follow label edits. */
  savedTraitIds: ReadonlySet<string>
}

const GENDER_OPTIONS: SegmentedOption<Gender>[] = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'nonbinary', label: 'Nonbinary' },
]

const ATTRACTION_OPTIONS = [
  { value: 'woman', label: 'Women' },
  { value: 'man', label: 'Men' },
  { value: 'nonbinary', label: 'Nonbinary people' },
]

const STYLE_OPTIONS: SegmentedOption<Style>[] = [
  { value: 'monogamous', label: 'Monogamous' },
  { value: 'open', label: 'Open' },
  { value: 'polyamorous', label: 'Polyamorous' },
  { value: 'flexible', label: 'Flexible' },
]

const JEALOUSY_OPTIONS: SegmentedOption<Jealousy>[] = [
  { value: 'compersion', label: 'Compersion' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

const DIFFICULTY_OPTIONS: SegmentedOption<Difficulty>[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
]

const HEAT_CAP_OPTIONS: SelectOption[] = [
  { value: '', label: 'No cap' },
  ...HEAT_LEVELS.map((h) => ({ value: String(h.level), label: `${h.level}, ${h.name}` })),
]

const RELATION_OPTIONS: SelectOption[] = [
  { value: 'partner', label: 'Partner' },
  { value: 'ex', label: 'Ex' },
  { value: 'situationship', label: 'Situationship' },
]

const PRONOUNS = ['she/her', 'he/him', 'they/them']

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** "#3FB8AF" for the colour picker, which only takes six-digit hex. */
function pickerHex(accent: string): string {
  const s = accent.trim()
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
  return '#e0245e'
}

/**
 * A label that reads "Id" on screen and "Like 2 Id" to a screen reader, so repeated controls
 * in a list each have their own name.
 */
function RowLabel({ row, children }: { row: string; children: string }) {
  return (
    <>
      <span className="visually-hidden">{row} </span>
      {children}
    </>
  )
}

function numText(n: number | undefined): string {
  return n == null || Number.isNaN(n) ? '' : String(n)
}

// ---------------------------------------------------------------------------

export function BasicsSection({
  f,
  ageText,
  onAge,
  onName,
  onId,
  idHint,
}: {
  f: FormApi
  ageText: string
  onAge: (text: string) => void
  onName: (name: string) => void
  onId: (id: string) => void
  idHint: string
}) {
  const d = f.draft
  const ace = d.aceSpectrum
  return (
    <Panel title="Basics" className={styles.section}>
      <div className={styles.grid2}>
        <Field label="Name" htmlFor={f.anchor('name')} error={f.error('name')}>
          <TextInput value={d.name} maxLength={60} onChange={onName} onBlur={() => f.touch('name')} placeholder="Sam Ortiz" />
        </Field>
        <Field label="Id" htmlFor={f.anchor('id')} hint={idHint} error={f.error('id')}>
          <TextInput
            mono
            value={d.id}
            maxLength={40}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={onId}
            onBlur={() => f.touch('id')}
            placeholder="sam-ortiz"
          />
        </Field>
      </div>

      <div className={styles.grid2}>
        <Field label="Age" htmlFor={f.anchor('age')} hint="21 or older, always." error={f.error('age')}>
          <TextInput
            type="number"
            inputMode="numeric"
            min={21}
            max={120}
            step={1}
            value={ageText}
            onChange={onAge}
            onBlur={() => f.touch('age')}
          />
        </Field>
        <Field label="Pronouns" htmlFor={f.anchor('pronouns')} error={f.error('pronouns')}>
          <TextInput value={d.pronouns} maxLength={40} onChange={(pronouns) => f.set({ pronouns })} onBlur={() => f.touch('pronouns')} />
          <div className={styles.suggest}>
            {PRONOUNS.map((p) => (
              <Chip key={p} selected={d.pronouns.trim() === p} onClick={() => f.set({ pronouns: p })}>
                {p}
              </Chip>
            ))}
          </div>
        </Field>
      </div>

      <Field label="Gender" kind="group" htmlFor={f.anchor('gender')} error={f.error('gender')}>
        <Segmented
          value={d.gender || null}
          options={GENDER_OPTIONS}
          onChange={(gender) => {
            f.set({ gender })
            f.touch('gender')
          }}
        />
      </Field>

      <Field
        label="Identity"
        optional
        htmlFor={f.anchor('identity')}
        hint="Always shown on their profile, like Trans woman or Nonbinary. Never a secret or a twist."
        error={f.error('identity')}
      >
        <TextInput value={d.identity ?? ''} maxLength={60} onChange={(identity) => f.set({ identity })} onBlur={() => f.touch('identity')} />
      </Field>

      <Field label="Occupation" htmlFor={f.anchor('occupation')} hint="An adult job and life." error={f.error('occupation')}>
        <TextArea rows={2} value={d.occupation} maxLength={160} onChange={(occupation) => f.set({ occupation })} onBlur={() => f.touch('occupation')} />
      </Field>

      <CheckChips
        id={f.anchor('attractedTo')}
        label="Attracted to"
        hint="In realistic mode, players outside this take the friend route."
        error={f.error('attractedTo')}
        options={ATTRACTION_OPTIONS}
        selected={d.attractedTo}
        onToggle={(g, on) => {
          f.set({ attractedTo: toggleIn(d.attractedTo, g, on) as Gender[] })
          f.touch('attractedTo')
        }}
      />

      <Field
        label="Orientation"
        optional
        htmlFor={f.anchor('orientation')}
        hint="Shown once the player learns who they're into: bi, lesbian, gay, pan."
        error={f.error('orientation')}
      >
        <TextInput value={d.orientation ?? ''} maxLength={40} onChange={(orientation) => f.set({ orientation })} onBlur={() => f.touch('orientation')} />
      </Field>

      <Field label="Relationship style" kind="group" htmlFor={f.anchor('relationshipStyle')} error={f.error('relationshipStyle')}>
        <Segmented
          value={d.relationshipStyle || null}
          options={STYLE_OPTIONS}
          onChange={(relationshipStyle) => {
            f.set({ relationshipStyle })
            f.touch('relationshipStyle')
          }}
        />
      </Field>

      <Field label="Jealousy" kind="group" htmlFor={f.anchor('jealousy')} hint="Compersion means happy when you're happy with others." error={f.error('jealousy')}>
        <Segmented
          value={d.jealousy || null}
          options={JEALOUSY_OPTIONS}
          onChange={(jealousy) => {
            f.set({ jealousy })
            f.touch('jealousy')
          }}
        />
      </Field>

      <div className={styles.aceBox}>
        <Toggle
          checked={!!ace}
          onChange={(on) => f.set({ aceSpectrum: on ? { label: '' } : undefined })}
          label="On the ace spectrum"
          description="Their own pace: a heat cap, or trust to earn before heat 3 and up. Chemistry, not a lock to pick."
        />
        {ace && (
          <div className={styles.grid3}>
            <Field label="Label" htmlFor={f.anchor('aceSpectrum.label')} error={f.error('aceSpectrum.label')}>
              <TextInput
                value={ace.label}
                maxLength={40}
                placeholder="Demisexual"
                onChange={(label) => f.set({ aceSpectrum: { ...ace, label } })}
                onBlur={() => f.touch('aceSpectrum.label')}
              />
            </Field>
            <Field label="Heat cap" htmlFor={f.anchor('aceSpectrum.heatCap')} error={f.error('aceSpectrum.heatCap')}>
              <Select
                value={ace.heatCap == null ? '' : String(ace.heatCap)}
                options={HEAT_CAP_OPTIONS}
                onChange={(v) => {
                  const next = { ...ace }
                  if (v) next.heatCap = Number(v) as HeatLevel
                  else delete next.heatCap
                  f.set({ aceSpectrum: next })
                }}
              />
            </Field>
            <Field
              label="Trust before heat 3"
              optional
              htmlFor={f.anchor('aceSpectrum.heatUnlockTrust')}
              error={f.error('aceSpectrum.heatUnlockTrust')}
            >
              <TextInput
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                value={numText(ace.heatUnlockTrust)}
                onChange={(v) => {
                  const next = { ...ace }
                  const n = parseOptionalNumber(v)
                  if (n == null) delete next.heatUnlockTrust
                  else next.heatUnlockTrust = n
                  f.set({ aceSpectrum: next })
                  f.touch('aceSpectrum.heatUnlockTrust')
                }}
              />
            </Field>
          </div>
        )}
      </div>

      <Field label="Difficulty" kind="group" htmlFor={f.anchor('difficulty')} hint="Scales how far each reaction moves affection." error={f.error('difficulty')}>
        <Segmented value={d.difficulty || null} options={DIFFICULTY_OPTIONS} onChange={(difficulty) => f.set({ difficulty })} />
      </Field>

      <Field label="Accent color" htmlFor={f.anchor('accent')} hint="Tints their profile, coaster and date screen." error={f.error('accent')}>
        <div className={styles.accentRow}>
          <input
            type="color"
            className={styles.swatchInput}
            aria-label="Pick an accent color"
            value={pickerHex(d.accent)}
            onChange={(e) => {
              f.set({ accent: e.target.value.toUpperCase() })
              f.touch('accent')
            }}
          />
          <TextInput
            mono
            value={d.accent}
            maxLength={7}
            autoCapitalize="off"
            spellCheck={false}
            onChange={(accent) => f.set({ accent })}
            onBlur={() => f.touch('accent')}
          />
        </div>
      </Field>
    </Panel>
  )
}

// ---------------------------------------------------------------------------

const WRITING: readonly { key: 'look' | 'artTags' | 'bodyNotes' | 'personality' | 'voice' | 'backstory' | 'opener'; label: string; hint: string; rows: number; optional?: boolean }[] = [
  { key: 'look', label: 'Look', hint: 'How they look and dress, in prose.', rows: 3 },
  {
    key: 'artTags',
    label: 'Art tags',
    hint: 'Comma-separated appearance tags for image generation. Start with their adult age, like "adult woman, 28 years old".',
    rows: 3,
  },
  { key: 'bodyNotes', label: 'Body notes', hint: 'How they describe their own body. Only used at heat 4 and 5.', rows: 2, optional: true },
  { key: 'personality', label: 'Personality', hint: 'Who they are, in a sentence or two.', rows: 2 },
  { key: 'voice', label: 'Voice', hint: 'How they talk, and what they call the player once they like them.', rows: 2 },
  { key: 'backstory', label: 'Backstory', hint: 'Where they came from and what their life is like now.', rows: 4 },
  { key: 'opener', label: 'Opener', hint: 'Their first line on a first date.', rows: 2 },
]

export function WritingSection({ f }: { f: FormApi }) {
  return (
    <Panel title="Writing" description="What the story engine reads to play them." className={styles.section}>
      {WRITING.map((w) => (
        <Field key={w.key} label={w.label} optional={w.optional} htmlFor={f.anchor(w.key)} hint={w.hint} error={f.error(w.key)}>
          <TextArea
            value={f.draft[w.key] ?? ''}
            rows={w.rows}
            maxLength={2000}
            onChange={(v) => f.set({ [w.key]: v } as Partial<Character>)}
            onBlur={() => f.touch(w.key)}
          />
        </Field>
      ))}
    </Panel>
  )
}

// ---------------------------------------------------------------------------

export function TraitsSection({ f }: { f: FormApi }) {
  const d = f.draft
  const setList = (key: TraitKey, list: Character[TraitKey]) => f.set({ [key]: list } as Partial<Character>)
  return (
    <Panel
      title="Traits"
      description="Hidden from the player until a date touches one. Ids are short and unique on the card, like slow-dance."
      className={styles.section}
    >
      {TRAIT_SECTIONS.map((s) => {
        const list = d[s.key]
        return (
          <div key={s.key} className={styles.listBlock} id={f.anchor(s.key)} tabIndex={-1}>
            <h3 className={styles.listTitle}>
              {s.title}
              <span className={styles.listCount}>{list.length}</span>
            </h3>
            {f.error(s.key) && (
              <p className={styles.listError} role="alert">
                {f.error(s.key)}
              </p>
            )}
            <ol className={styles.rows}>
              {list.map((t, i) => {
                const base = `${s.key}[${i}]`
                const n = i + 1
                return (
                  <li key={i} className={styles.traitRow}>
                    <Field label={`${s.title.replace(/s$/, '')} ${n}`} htmlFor={f.anchor(`${base}.label`)} error={f.error(`${base}.label`)} className={styles.traitLabel}>
                      <TextInput
                        value={t.label}
                        maxLength={140}
                        onChange={(label) => setList(s.key, list.map((x, j) => (j === i ? withLabel(x, label, f.savedTraitIds) : x)))}
                        onBlur={() => f.touch(`${base}.label`)}
                      />
                    </Field>
                    <Field
                      label={<RowLabel row={`${s.title.replace(/s$/, '')} ${n}`}>Id</RowLabel>}
                      htmlFor={f.anchor(`${base}.id`)}
                      error={f.error(`${base}.id`)}
                      className={styles.traitId}
                    >
                      <TextInput
                        mono
                        value={t.id}
                        maxLength={40}
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        onChange={(id) => {
                          setList(s.key, list.map((x, j) => (j === i ? { ...x, id: id.toLowerCase() } : x)))
                          f.touch(`${base}.id`)
                        }}
                      />
                    </Field>
                    <IconButton
                      label={`Remove ${s.one} ${n}`}
                      className={styles.remove}
                      onClick={() => setList(s.key, list.filter((_, j) => j !== i))}
                    >
                      <XIcon />
                    </IconButton>
                  </li>
                )
              })}
            </ol>
            <Button variant="ghost" size="small" onClick={() => setList(s.key, [...list, { id: '', label: '' }])}>
              Add a {s.one}
            </Button>
          </div>
        )
      })}
    </Panel>
  )
}

// ---------------------------------------------------------------------------

const VENUE_OPTIONS = VENUES.map((v) => ({ value: v.id, label: v.name }))
const GIFT_OPTIONS = GIFTS.map((g) => ({ value: g.id, label: g.name }))

export function PlacesSection({ f }: { f: FormApi }) {
  const d = f.draft
  const toggle = (key: PlaceKey, id: string, on: boolean) => {
    const other = OPPOSITE[key]
    const patch: Partial<Character> = { [key]: toggleIn(d[key], id, on) }
    // Picking one side takes it off the other: a venue is loved or hated, not both.
    if (on) patch[other] = d[other].filter((x) => x !== id)
    f.set(patch)
    f.touch(key)
    f.touch(other)
  }
  const first = VENUES.find((v) => v.id === d.favoriteVenues[0])
  return (
    <Panel title="Venues and gifts" description="Revealed on the profile once the player tries them." className={styles.section}>
      <CheckChips
        id={f.anchor('favoriteVenues')}
        label="Favorite venues"
        hint={first ? `Their epilogue plays at the first one: ${first.name}.` : 'Pick at least one. Their epilogue plays at the first.'}
        error={f.error('favoriteVenues')}
        options={VENUE_OPTIONS}
        selected={d.favoriteVenues}
        onToggle={(id, on) => toggle('favoriteVenues', id, on)}
      />
      <CheckChips
        id={f.anchor('hatedVenues')}
        label="Hated venues"
        error={f.error('hatedVenues')}
        options={VENUE_OPTIONS}
        selected={d.hatedVenues}
        onToggle={(id, on) => toggle('hatedVenues', id, on)}
      />
      <CheckChips
        id={f.anchor('lovedGifts')}
        label="Loved gifts"
        error={f.error('lovedGifts')}
        options={GIFT_OPTIONS}
        selected={d.lovedGifts}
        onToggle={(id, on) => toggle('lovedGifts', id, on)}
      />
      <CheckChips
        id={f.anchor('hatedGifts')}
        label="Hated gifts"
        error={f.error('hatedGifts')}
        options={GIFT_OPTIONS}
        selected={d.hatedGifts}
        onToggle={(id, on) => toggle('hatedGifts', id, on)}
      />
    </Panel>
  )
}

// ---------------------------------------------------------------------------

export function SecretsSection({ f }: { f: FormApi }) {
  const secrets = f.draft.secrets
  const setSecrets = (list: Secret[]) => f.set({ secrets: list })
  const nextAt = [60, 80, 40, 100][secrets.length] ?? 60
  return (
    <Panel
      title="Secrets"
      description="Earned at an affection level on a romantic route, or at that much trust on a friend route."
      className={styles.section}
    >
      {secrets.length === 0 && <p className={styles.fine}>No secrets yet. Two is a good number.</p>}
      <ol className={styles.rows}>
        {secrets.map((s, i) => {
          const base = `secrets[${i}]`
          return (
            <li key={i} className={styles.secretRow}>
              <Field
                label={<RowLabel row={`Secret ${i + 1}`}>Unlocks at</RowLabel>}
                htmlFor={f.anchor(`${base}.unlockAt`)}
                error={f.error(`${base}.unlockAt`)}
                className={styles.secretAt}
              >
                <TextInput
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={numText(s.unlockAt)}
                  onChange={(v) => {
                    const n = parseOptionalNumber(v)
                    setSecrets(secrets.map((x, j) => (j === i ? { ...x, unlockAt: n ?? Number.NaN } : x)))
                    f.touch(`${base}.unlockAt`)
                  }}
                />
              </Field>
              <Field label={`Secret ${i + 1}`} htmlFor={f.anchor(`${base}.text`)} error={f.error(`${base}.text`)} className={styles.secretText}>
                <TextArea
                  value={s.text}
                  rows={2}
                  maxLength={600}
                  onChange={(text) => setSecrets(secrets.map((x, j) => (j === i ? { ...x, text } : x)))}
                  onBlur={() => f.touch(`${base}.text`)}
                />
              </Field>
              <IconButton label={`Remove secret ${i + 1}`} className={styles.remove} onClick={() => setSecrets(secrets.filter((_, j) => j !== i))}>
                <XIcon />
              </IconButton>
            </li>
          )
        })}
      </ol>
      <div>
        <Button variant="ghost" size="small" onClick={() => setSecrets([...secrets, { unlockAt: nextAt, text: '' }])}>
          Add a secret
        </Button>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------

export interface GalleryImages {
  /**
   * The saved character's id, when the player can add their own tier images (custom and imported
   * characters that have been saved); null for a new card; undefined for a read-only one.
   */
  owner?: string | null
}

export function GallerySection({ f, images = {} }: { f: FormApi; images?: GalleryImages }) {
  const gallery = f.draft.gallery
  return (
    <Panel
      title="Gallery"
      description="Five tiers, unlocked at 20, 40, 60, 80 and 100 affection. The scene is what the art shows."
      className={styles.section}
    >
      {images.owner === null && <p className={styles.fine}>Save the character first, then add an image for each tier here.</p>}
      {images.owner === undefined && <p className={styles.fine}>You can add your own image for any tier from the gallery.</p>}
      {f.error('gallery') && (
        <p className={styles.listError} role="alert" id={f.anchor('gallery')} tabIndex={-1}>
          {f.error('gallery')}
        </p>
      )}
      <ol className={styles.tiers}>
        {gallery.map((t, i) => {
          const base = `gallery[${i}]`
          const setTier = (patch: Partial<typeof t>) => f.set({ gallery: gallery.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
          return (
            <li key={t.tier} className={styles.tier}>
              <h3 className={styles.tierTitle}>
                Tier {t.tier}
                <span className={styles.listCount}>Unlocks at {TIER_UNLOCKS[t.tier] ?? t.unlockAt}</span>
              </h3>
              <Field label={<RowLabel row={`Tier ${t.tier}`}>Title</RowLabel>} htmlFor={f.anchor(`${base}.title`)} error={f.error(`${base}.title`)}>
                <TextInput value={t.title} maxLength={80} onChange={(title) => setTier({ title })} onBlur={() => f.touch(`${base}.title`)} />
              </Field>
              <Field label={<RowLabel row={`Tier ${t.tier}`}>Scene</RowLabel>} htmlFor={f.anchor(`${base}.scene`)} error={f.error(`${base}.scene`)}>
                <TextArea value={t.scene} rows={2} maxLength={600} onChange={(scene) => setTier({ scene })} onBlur={() => f.touch(`${base}.scene`)} />
              </Field>
              {images.owner && <TierImage characterId={images.owner} tier={t.tier} title={t.title} name={f.draft.name} />}
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}

// ---------------------------------------------------------------------------

export function PartnersSection({ f, members }: { f: FormApi; members: readonly { id: string; name: string }[] }) {
  const partners = f.draft.partners ?? []
  const setPartners = (list: NonNullable<Character['partners']>) => f.set({ partners: list })
  const unused = members.find((m) => !partners.some((p) => p.characterId === m.id))
  return (
    <Panel
      title="Partners and exes"
      description="Only characters in the same set. They come up once the player gets a little closer."
      className={styles.section}
    >
      {members.length === 0 && <p className={styles.fine}>Nobody else is in this set yet.</p>}
      <ol className={styles.rows}>
        {partners.map((p, i) => {
          const base = `partners[${i}]`
          const known = members.some((m) => m.id === p.characterId)
          const options: SelectOption[] = [
            ...(known ? [] : [{ value: p.characterId, label: p.characterId ? `${p.characterId} (not in this set)` : 'Pick someone' }]),
            ...members.map((m) => ({ value: m.id, label: m.name })),
          ]
          return (
            <li key={i} className={styles.partnerRow}>
              <Field label={`Partner ${i + 1}`} htmlFor={f.anchor(`${base}.characterId`)} error={f.error(`${base}.characterId`)}>
                <Select
                  value={p.characterId}
                  options={options}
                  onChange={(characterId) => {
                    setPartners(partners.map((x, j) => (j === i ? { ...x, characterId } : x)))
                    f.touch(`${base}.characterId`)
                  }}
                />
              </Field>
              <Field
                label={<RowLabel row={`Partner ${i + 1}`}>Relation</RowLabel>}
                htmlFor={f.anchor(`${base}.relation`)}
                error={f.error(`${base}.relation`)}
              >
                <Select
                  value={p.relation}
                  options={RELATION_OPTIONS}
                  onChange={(relation) => setPartners(partners.map((x, j) => (j === i ? { ...x, relation: relation as PartnerRelation } : x)))}
                />
              </Field>
              <IconButton label={`Remove partner ${i + 1}`} className={styles.remove} onClick={() => setPartners(partners.filter((_, j) => j !== i))}>
                <XIcon />
              </IconButton>
            </li>
          )
        })}
      </ol>
      <div>
        <Button
          variant="ghost"
          size="small"
          disabled={!unused}
          onClick={() => unused && setPartners([...partners, { characterId: unused.id, relation: 'partner' }])}
        >
          Add a partner or ex
        </Button>
      </div>
    </Panel>
  )
}
