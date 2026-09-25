import { useState, type FormEvent, type ReactNode } from 'react'
import { defaultProfile } from '../../store/defaults'
import type { PlayerGender, PlayerProfile } from '../../types'
import { Button } from '../../ui/Button'
import { Chip, ChipRow } from '../../ui/Chip'
import { Field } from '../../ui/Field'
import { TextArea, TextInput } from '../../ui/Inputs'
import { Segmented } from '../../ui/Segmented'
import {
  cleanProfile,
  GENDER_OPTIONS,
  MATCH_OPTIONS,
  NAME_MAX,
  PRONOUN_SUGGESTIONS,
  PRONOUNS_FOR,
  STYLE_OPTIONS,
  validateProfile,
  type ProfileErrors,
} from './profile'
import styles from './ProfileForm.module.css'

export interface ProfileFormProps {
  initial: PlayerProfile | null
  onSubmit: (p: PlayerProfile) => void | Promise<void>
  submitLabel: string
  /** Extra fields rendered before the actions (Onboarding adds orientation mode). */
  children?: ReactNode
  /** Extra buttons next to submit. */
  actions?: ReactNode
  /** Disable submit until something changed (Settings). */
  requireChange?: boolean
  busy?: boolean
  /** Status text next to the actions. */
  status?: ReactNode
  idPrefix?: string
}

/** The player profile form, shared by Onboarding and Settings. */
export function ProfileForm({
  initial,
  onSubmit,
  submitLabel,
  children,
  actions,
  requireChange,
  busy,
  status,
  idPrefix = 'profile',
}: ProfileFormProps) {
  const [draft, setDraft] = useState<PlayerProfile>(() => ({ ...defaultProfile(), ...initial }))
  const [baseline, setBaseline] = useState(() => JSON.stringify(cleanProfile({ ...defaultProfile(), ...initial })))
  const [tried, setTried] = useState(false)
  const errors = validateProfile(draft)
  const shown: ProfileErrors = tried ? errors : {}
  const changed = JSON.stringify(cleanProfile(draft)) !== baseline

  // Pronouns follow the gender picker until the player types or picks their own.
  const [pronounsTouched, setPronounsTouched] = useState(() => {
    const p = { ...defaultProfile(), ...initial }
    return !!p.pronouns.trim() && p.pronouns.trim() !== PRONOUNS_FOR[p.gender]
  })

  const patch = (p: Partial<PlayerProfile>) => setDraft((d) => ({ ...d, ...p }))

  const setPronouns = (pronouns: string) => {
    setPronounsTouched(true)
    patch({ pronouns })
  }

  const setGender = (gender: PlayerGender) => {
    setDraft((d) => {
      const follow = !pronounsTouched || !d.pronouns.trim()
      return {
        ...d,
        gender,
        pronouns: follow ? (PRONOUNS_FOR[gender] ?? d.pronouns) : d.pronouns,
        matchAs: gender === 'custom' ? (d.matchAs ?? 'nonbinary') : d.matchAs,
      }
    })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (Object.keys(errors).length) {
      const first = Object.keys(errors)[0]
      document.getElementById(`${idPrefix}-${first}`)?.focus()
      return
    }
    const clean = cleanProfile(draft)
    await onSubmit(clean)
    setBaseline(JSON.stringify(clean))
    setTried(false)
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Field label="Name" htmlFor={`${idPrefix}-name`} error={shown.name} required>
        <TextInput
          value={draft.name}
          onChange={(name) => patch({ name })}
          autoComplete="nickname"
          maxLength={NAME_MAX}
          placeholder="What should they call you?"
        />
      </Field>

      <Field label="Gender" kind="group" htmlFor={`${idPrefix}-gender`}>
        <Segmented value={draft.gender} options={GENDER_OPTIONS} onChange={setGender} />
      </Field>

      {draft.gender === 'custom' && (
        <div className={styles.pair}>
          <Field
            label="Your gender"
            htmlFor={`${idPrefix}-customGender`}
            hint="This is the word characters use for you."
            error={shown.customGender}
          >
            <TextInput
              value={draft.customGender ?? ''}
              onChange={(customGender) => patch({ customGender })}
              placeholder="For example genderfluid, agender, two-spirit"
              maxLength={40}
            />
          </Field>
          <Field
            label="For who's into you, count me as"
            kind="group"
            htmlFor={`${idPrefix}-matchAs`}
            hint="Only used in realistic mode, to work out who's attracted to you. Nobody sees this choice."
          >
            <Segmented
              value={draft.matchAs ?? 'nonbinary'}
              options={MATCH_OPTIONS}
              onChange={(matchAs) => patch({ matchAs })}
            />
          </Field>
        </div>
      )}

      <Field
        label="Pronouns"
        htmlFor={`${idPrefix}-pronouns`}
        error={shown.pronouns}
        hint="Characters use these without being asked. Getting them wrong is a bug, never a plot point."
      >
        <div className={styles.pronounRow}>
          <TextInput
            value={draft.pronouns}
            onChange={setPronouns}
            placeholder="she/her, he/him, they/them, or your own"
            maxLength={40}
            autoCapitalize="off"
          />
          <ChipRow label="Pronoun suggestions">
            {PRONOUN_SUGGESTIONS.map((p) => (
              <Chip key={p} selected={draft.pronouns.trim() === p} onClick={() => setPronouns(p)}>
                {p}
              </Chip>
            ))}
          </ChipRow>
        </div>
      </Field>

      <Field
        label="Body notes"
        optional
        htmlFor={`${idPrefix}-bodyNotes`}
        hint="Only used at heat 4 and 5, to describe you in intimate scenes. Leave it blank and the story keeps your body vague."
      >
        <TextArea
          value={draft.bodyNotes}
          onChange={(bodyNotes) => patch({ bodyNotes })}
          placeholder="For example: tall, soft stomach, freckles everywhere, a scar on one knee"
          maxLength={400}
          rows={3}
        />
      </Field>

      <Field
        label="How you date"
        kind="group"
        htmlFor={`${idPrefix}-style`}
        hint="Characters only learn this when you tell them, or when it comes up. It's never announced for you."
      >
        <Segmented
          value={draft.relationshipStyle}
          options={STYLE_OPTIONS}
          onChange={(relationshipStyle) => patch({ relationshipStyle })}
        />
      </Field>

      {children}

      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={requireChange && !changed}
        >
          {submitLabel}
        </Button>
        {actions}
        {status && (
          <p className={styles.status} role="status">
            {status}
          </p>
        )}
      </div>
    </form>
  )
}
