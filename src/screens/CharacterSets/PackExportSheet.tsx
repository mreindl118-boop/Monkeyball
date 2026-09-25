import { useMemo, useState } from 'react'
import { HEAT_LEVELS } from '../../data/heat'
import { slugify } from '../../mods/normalize'
import { validateManifest } from '../../mods/validate'
import type { Character, HeatLevel, SetManifest } from '../../types'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { Select, TextArea, TextInput, type SelectOption } from '../../ui/Inputs'
import { Note } from '../../ui/Panel'
import { Sheet } from '../../ui/Sheet'
import { joinAnd } from '../../engine/stages'
import styles from './CharacterSets.module.css'
import { exportSetZip } from './exportPack'
import { TAKEN_SET_IDS, packManifest, type PackDraft } from './setsModel'

const HEAT_OPTIONS: SelectOption[] = [
  { value: '', label: 'No recommendation' },
  ...HEAT_LEVELS.map((h) => ({ value: String(h.level), label: `${h.level}, ${h.name}` })),
]

export interface PackExportSheetProps {
  open: boolean
  onClose: () => void
  /** Sheet title, e.g. "Export My characters". */
  title: string
  characters: readonly Character[]
  defaults: Partial<PackDraft>
  relationships?: SetManifest['relationships']
}

/**
 * Name a pack before exporting it: a pack needs its own id (My characters can't travel as
 * "custom"), a name and a blurb. The manifest is checked with the same rules as an import.
 */
export function PackExportSheet(props: PackExportSheetProps) {
  // Mount the form only while open, so each opening starts from the defaults.
  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      description="Packs travel as a .zip with a manifest. Anyone can import it from Settings."
    >
      {props.open && <PackExportForm {...props} />}
    </Sheet>
  )
}

function PackExportForm({ onClose, characters, defaults, relationships }: PackExportSheetProps) {
  const [draft, setDraft] = useState<PackDraft>(() => ({
    name: defaults.name ?? '',
    id: defaults.id ?? slugify(defaults.name ?? ''),
    author: defaults.author ?? '',
    blurb: defaults.blurb ?? '',
    heat: defaults.heat ?? null,
  }))
  const [idTouched, setIdTouched] = useState(!!defaults.id)
  const [busy, setBusy] = useState(false)
  const manifest = useMemo(() => packManifest(draft, characters, relationships), [draft, characters, relationships])
  const issues = useMemo(
    () => validateManifest(manifest, { characterIds: characters.map((c) => c.id), existingSetIds: TAKEN_SET_IDS }),
    [manifest, characters],
  )
  const errorFor = (field: string) => issues.filter((i) => i.field === field).map((i) => i.message).join(' ') || undefined
  const other = issues.filter((i) => !['id', 'name', 'blurb', 'heat', 'author'].includes(i.field))

  const set = (patch: Partial<PackDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const names = characters.map((c) => c.name.trim() || c.id)

  const doExport = async () => {
    setBusy(true)
    const ok = await exportSetZip(manifest, characters)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <div className={styles.form}>
      <p className={styles.includes}>Includes {joinAnd(names)}.</p>
      <Field label="Pack name" htmlFor="pack-name" error={errorFor('name')}>
        <TextInput
          value={draft.name}
          maxLength={60}
          onChange={(name) => set(idTouched ? { name } : { name, id: slugify(name) })}
        />
      </Field>
      <Field
        label="Pack id"
        htmlFor="pack-id"
        hint="Lowercase words joined by hyphens. Importing a pack with the same id replaces the earlier import."
        error={errorFor('id')}
      >
        <TextInput
          mono
          value={draft.id}
          maxLength={40}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(id) => {
            setIdTouched(true)
            set({ id: id.toLowerCase() })
          }}
        />
      </Field>
      <Field label="Author" htmlFor="pack-author" optional error={errorFor('author')}>
        <TextInput value={draft.author} maxLength={60} onChange={(author) => set({ author })} />
      </Field>
      <Field label="Blurb" htmlFor="pack-blurb" hint="A line or two on who's in it and what it's like." error={errorFor('blurb')}>
        <TextArea value={draft.blurb} rows={3} maxLength={600} onChange={(blurb) => set({ blurb })} />
      </Field>
      <Field label="Recommended heat" htmlFor="pack-heat" error={errorFor('heat')}>
        <Select
          value={draft.heat == null ? '' : String(draft.heat)}
          options={HEAT_OPTIONS}
          onChange={(v) => set({ heat: v ? (Number(v) as HeatLevel) : null })}
        />
      </Field>
      {other.length > 0 && (
        <Note tone="lipstick" title="This pack wouldn't import" role="alert">
          <ul className={styles.problems}>
            {other.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        </Note>
      )}
      <div className={styles.formActions}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" loading={busy} disabled={issues.length > 0} onClick={() => void doExport()}>
          Export .zip
        </Button>
      </div>
    </div>
  )
}
