import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { portraitAccent } from '../../art/Portrait.model'
import { slugify, normalizeCharacter } from '../../mods/normalize'
import { validateCharacter, type ValidationIssue } from '../../mods/validate'
import { success } from '../../platform/haptics'
import { pushOverlay } from '../../platform/overlays'
import { TEMPLATES } from '../../prompts/build'
import { useNav } from '../../store/nav'
import { useGame } from '../../store/game'
import { CUSTOM_SET_ID, STORAGE_FIELD, selectValidationContext, useRoster } from '../../store/roster'
import type { Character } from '../../types'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Field } from '../../ui/Field'
import { Select, type SelectOption } from '../../ui/Inputs'
import { Note, Panel } from '../../ui/Panel'
import { toast } from '../../ui/toastStore'
import { TopBar } from '../../ui/TopBar'
import { BUNDLED_SET_IDS } from '../../data/bundled'
import styles from './Editor.module.css'
import {
  BasicsSection,
  GallerySection,
  PartnersSection,
  PlacesSection,
  SecretsSection,
  TraitsSection,
  WritingSection,
  type FormApi,
} from './EditorSections'
import {
  anchorFor,
  cleanDraft,
  editorIssues,
  fieldLabel,
  inFormOrder,
  issuesByAnchor,
  parseAge,
  savedTraitIds,
  worldRules,
} from './editorModel'

export interface EditorFormProps {
  initial: Character
  /** The set the character is in (or will be saved into). */
  setId: string
  /** null for a new character, else the id being edited. */
  previousId: string | null
  /** Bundled characters open read-only, with a way to duplicate them. */
  readOnly?: boolean
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={styles.lockIcon}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** The locked WORLD RULES of the story engine, quoted from the prompt itself. */
export function WorldRulesPanel({ name }: { name: string }) {
  const rules = worldRules(TEMPLATES.story, name.trim() || 'The character')
  return (
    <Panel
      tone="brass"
      className={styles.section}
      title={
        <span className={styles.lockedTitle}>
          <LockIcon />
          World rules
        </span>
      }
      description="Every story prompt starts with these. They are locked: they can't be edited here or anywhere else in crushLAB, and custom prompts only ever add to them."
    >
      <blockquote className={styles.rules}>
        <ul>
          {rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </blockquote>
    </Panel>
  )
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

export function EditorForm({ initial, setId: initialSetId, previousId, readOnly = false }: EditorFormProps) {
  const back = useNav((s) => s.back)
  const replace = useNav((s) => s.replace)
  const sets = useRoster((s) => s.sets)
  const entries = useRoster((s) => s.entries)
  const isNew = previousId === null

  const [draft, setDraft] = useState<Character>(initial)
  const [setId, setSetId] = useState(initialSetId)
  const [baseline, setBaseline] = useState(() => JSON.stringify({ c: initial, s: initialSetId }))
  const [ageText, setAgeText] = useState(Number.isFinite(initial.age) ? String(initial.age) : '')
  const [idAuto, setIdAuto] = useState(isNew && !initial.id)
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const [showAll, setShowAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [storeIssues, setStoreIssues] = useState<ValidationIssue[]>([])
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [duplicating, setDuplicating] = useState(false)

  const dirty = !readOnly && JSON.stringify({ c: draft, s: setId }) !== baseline
  const lockedTraitIds = useMemo(() => savedTraitIds(isNew ? null : initial), [isNew, initial])
  // A new id that a deleted character used still has their progress stored (it's kept so a
  // re-import picks up where it left off): say so before this character inherits it.
  const draftId = draft.id.trim()
  const leftover = useGame(
    (s) => !readOnly && !!draftId && draftId !== previousId && !entries[draftId] && !!s.relationships[draftId],
  )

  // Live validation, exactly as the roster will check it on save.
  const issues = useMemo(() => {
    const card = normalizeCharacter(cleanDraft(draft))
    const ctx = selectValidationContext({ sets, entries }, setId, previousId, card.id)
    return editorIssues(validateCharacter(card, ctx), card.age)
  }, [draft, sets, entries, setId, previousId])
  const shownIssues = useMemo(() => inFormOrder(storeIssues.length ? storeIssues : issues), [storeIssues, issues])
  const byAnchor = useMemo(() => issuesByAnchor(shownIssues), [shownIssues])
  const valid = issues.length === 0
  // A blank new card hasn't failed anything yet: no count until the player starts filling it in.
  const fresh = isNew && touched.size === 0 && !showAll && storeIssues.length === 0

  // The Android back button asks before throwing away edits.
  useEffect(() => {
    if (!dirty) return
    return pushOverlay(() => setConfirmLeave(true))
  }, [dirty])

  const touch = (field: string) => {
    const a = anchorFor(field)
    if (!a || touched.has(a)) return
    setTouched((t) => new Set(t).add(a))
  }

  const f: FormApi = {
    draft,
    set: (patch) => {
      setDraft((d) => ({ ...d, ...patch }))
      setStoreIssues([])
    },
    error: (field) => {
      const a = anchorFor(field)
      if (!a || !(showAll || touched.has(a))) return undefined
      return byAnchor.get(a)?.join(' ')
    },
    touch,
    anchor: (field) => anchorFor(field) || `ed-${field}`,
    savedTraitIds: lockedTraitIds,
  }

  const onName = (name: string) => {
    f.set(idAuto ? { name, id: slugify(name) } : { name })
    if (idAuto) touch('id')
  }
  const onId = (id: string) => {
    setIdAuto(false)
    f.set({ id: id.toLowerCase() })
    touch('id')
  }
  const onAge = (text: string) => {
    setAgeText(text)
    f.set({ age: parseAge(text) })
    touch('age')
  }

  const focusField = (field: string) => {
    const a = anchorFor(field)
    setShowAll(true)
    if (!a) return
    const el = document.getElementById(a)
    if (!el) return
    // Groups (radio pills, chip lists, trait lists) focus their first control.
    const controls = 'input, select, textarea, button'
    const target = el.matches(controls) ? el : (el.querySelector<HTMLElement>(controls) ?? el)
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    target.focus({ preventScroll: true })
  }

  const leave = () => {
    if (dirty) setConfirmLeave(true)
    else back()
  }

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    const card = cleanDraft(draft)
    const problems = await useRoster.getState().saveCustomCharacter(card, setId, previousId)
    setSaving(false)
    // Storage refusing the write isn't a problem with the card: it's saved for this session.
    const storage = problems.find((p) => p.field === STORAGE_FIELD)
    const cardProblems = problems.filter((p) => p.field !== STORAGE_FIELD)
    if (cardProblems.length) {
      setStoreIssues(cardProblems)
      setShowAll(true)
      toast(`Not saved: ${cardProblems[0].message}`, 'error', 6000)
      return
    }
    if (storage) {
      toast(`${card.name} is saved for now. ${storage.message}`, 'error', 10_000)
    } else {
      void success()
      toast(`Saved ${card.name}.`, 'success')
    }
    setBaseline(JSON.stringify({ c: draft, s: setId }))
    if (previousId !== card.id) replace({ name: 'editor', id: card.id })
  }

  const duplicate = async () => {
    if (!previousId) return
    setDuplicating(true)
    const newId = await useRoster.getState().duplicateCharacter(previousId)
    setDuplicating(false)
    if (!newId) {
      toast("Couldn't make a copy.", 'error')
      return
    }
    toast('Made an editable copy.', 'success')
    replace({ name: 'editor', id: newId })
  }

  // Where a new character can go: My characters or an imported pack.
  const targets: SelectOption[] = [
    { value: CUSTOM_SET_ID, label: 'My characters' },
    ...sets
      .filter((s) => s.id !== CUSTOM_SET_ID && !BUNDLED_SET_IDS.includes(s.id))
      .map((s) => ({ value: s.id, label: s.name })),
  ]
  const setName = sets.find((s) => s.id === setId)?.name ?? (setId === CUSTOM_SET_ID ? 'My characters' : setId)
  const members = Object.values(entries)
    .filter((e) => e.setId === setId && e.character.id !== previousId && e.character.id !== draft.id)
    .map((e) => ({ id: e.character.id, name: e.character.name || e.character.id }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const idHint = leftover
    ? "Someone you've played with before had this id, so saving picks up that progress: affection, trust, secrets and unlocked art. Pick another id to start fresh."
    : isNew
      ? 'Follows the name until you change it. Lowercase words joined by hyphens.'
      : 'Changing the id starts their progress over.'
  const title = isNew ? 'New character' : draft.name.trim() || initial.name || 'Character'
  const style = { '--accent': portraitAccent(draft.accent) } as CSSProperties

  return (
    <main className={`screen ${styles.root}`} style={style}>
      <TopBar title={<span className={isNew ? undefined : 'name'}>{title}</span>} onBack={leave} />

      {readOnly ? (
        <Note tone="brass" title="Read-only">
          {initial.name} comes with crushLAB, so this card can't be changed. Duplicate them to edit a copy of your own.
        </Note>
      ) : isNew ? (
        <Field label="Save into" htmlFor="ed-setId" hint="My characters, or one of your imported packs.">
          <Select value={setId} options={targets} onChange={setSetId} />
        </Field>
      ) : (
        <p className={styles.where}>In {setName}.</p>
      )}

      {!readOnly && (
        <section className={styles.summary} aria-label="Checks">
          {shownIssues.length > 0 && fresh ? (
            <Note tone="brass" title="Fill in the basics to save">
              Each check shows at its field as you go.
              <button type="button" className={styles.summaryToggle} aria-expanded={false} onClick={() => setShowAll(true)}>
                Show what's needed
              </button>
            </Note>
          ) : shownIssues.length > 0 ? (
            <Note tone="lipstick" title={`${plural(shownIssues.length, 'thing', 'things')} to fix before saving`}>
              <button type="button" className={styles.summaryToggle} aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Hide the list' : 'Show the list'}
              </button>
              {showAll && (
                <ul className={styles.issueList}>
                  {shownIssues.map((i, n) => (
                    <li key={`${i.field}-${n}`}>
                      <button type="button" className={styles.issue} onClick={() => focusField(i.field)}>
                        <span className={styles.issueField}>{fieldLabel(i.field)}</span>
                        <span>{i.message}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Note>
          ) : (
            <Note tone="brass" title="Ready to save">
              Every check passes: age, attractions, traits, venues and gifts, gallery, partners and the safety scan.
            </Note>
          )}
        </section>
      )}

      <fieldset className={styles.fieldset} disabled={readOnly}>
        <legend className="visually-hidden">Character card</legend>
        <BasicsSection f={f} ageText={ageText} onAge={onAge} onName={onName} onId={onId} idHint={idHint} />
        <WritingSection f={f} />
        <TraitsSection f={f} />
        <PlacesSection f={f} />
        <SecretsSection f={f} />
        <GallerySection f={f} images={{ owner: readOnly ? undefined : previousId }} />
        <PartnersSection f={f} members={members} />
      </fieldset>

      <WorldRulesPanel name={draft.name} />

      {!readOnly && (
        <div className={styles.saveBar} data-keyboard-static>
          <p className={styles.saveStatus} aria-live="polite">
            {!valid ? (fresh ? 'Fill in the basics to save' : plural(issues.length, 'thing to fix', 'things to fix')) : dirty ? 'Unsaved changes' : 'All saved'}
          </p>
          <Button variant="primary" loading={saving} disabled={!valid || !dirty} onClick={() => void save()}>
            {isNew ? 'Save character' : 'Save'}
          </Button>
        </div>
      )}

      {readOnly && (
        <div className={styles.saveBar} data-keyboard-static>
          <p className={styles.saveStatus}>Read-only</p>
          <Button variant="primary" loading={duplicating} onClick={() => void duplicate()}>
            Duplicate to edit
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmLeave}
        title="Discard your changes?"
        message="What you changed since the last save is lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          setConfirmLeave(false)
          setBaseline(JSON.stringify({ c: draft, s: setId }))
          back()
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </main>
  )
}
