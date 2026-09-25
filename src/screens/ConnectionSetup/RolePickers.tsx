import { useId } from 'react'
import { chatModels, JUDGE_TEMPERATURE, roleTakesTemperature } from '../../llm'
import { PRESET_LIST, presetFor } from '../../llm/presets'
import { resolveRoute, rolePreset } from '../../llm/routes'
import { useSettings } from '../../store/settings'
import type { ConnectionPreset, ConnectionSettings } from '../../types'
import { Field } from '../../ui/Field'
import { Select, Slider, TextInput, type SelectOption } from '../../ui/Inputs'
import { Stepper } from '../../ui/Stepper'
import styles from './ConnectionForm.module.css'
import { judgePresetPatch, listedModel, slotUsable, storyPresetPatch } from './connectionHelpers'
import { listedNow, useAutoList, usePresetModels } from './modelLists'

/** Provider options, each marked when it isn't set up yet. */
function providerOptions(conn: ConnectionSettings, same?: string): SelectOption[] {
  const opts: SelectOption[] = same ? [{ value: 'same', label: same }] : []
  for (const p of PRESET_LIST) {
    const usable = slotUsable(conn, p.id)
    const note = usable ? '' : p.key === 'required' ? ' (needs a key)' : ' (needs an address)'
    opts.push({ value: p.id, label: `${p.label}${note}` })
  }
  return opts
}

/** Model options: the listed models, the current one when it isn't listed, and an optional "same". */
function modelOptions(models: string[], current: string, sameLabel?: string): SelectOption[] {
  const opts: SelectOption[] = []
  if (sameLabel !== undefined) opts.push({ value: '', label: sameLabel })
  else if (!current) opts.push({ value: '', label: 'Pick a model' })
  if (current && !listedModel(models, current)) opts.push({ value: current, label: `${current} (not in the list)` })
  for (const m of models) opts.push({ value: m, label: m })
  return opts
}

interface ModelInputProps {
  preset: ConnectionPreset
  models: string[]
  value: string
  placeholder: string
  sameLabel?: string
  onChange: (model: string) => void
}

/** A picker when the preset's models are listed, a text field otherwise. */
function ModelInput({ preset, models, value, placeholder, sameLabel, onChange }: ModelInputProps) {
  if (models.length) {
    return <Select value={value} options={modelOptions(models, value, sameLabel)} onChange={onChange} />
  }
  return (
    <TextInput
      value={value}
      onChange={onChange}
      placeholder={placeholder || (preset === 'ollama' ? 'llama3.1:8b' : 'Model id')}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      mono
    />
  )
}

/**
 * The two roles: the story model (writes the character's replies) and the judge model (scores
 * the player's messages), each a provider plus a model from that provider's list.
 */
export function RolePickers({ idPrefix }: { idPrefix: string }) {
  const conn = useSettings((s) => s.settings.connection)
  const updateConnection = useSettings((s) => s.updateConnection)
  const storyPreset = rolePreset(conn, 'story')
  const judgePreset = rolePreset(conn, 'judge')
  useAutoList(storyPreset)
  useAutoList(judgePreset, judgePreset !== storyPreset)
  const storyListed = usePresetModels(storyPreset)
  const judgeListed = usePresetModels(judgePreset)
  const storyModels = chatModels(storyPreset, storyListed)
  const judgeModels = chatModels(judgePreset, judgeListed)
  const storyTitle = useId()
  const judgeTitle = useId()

  const story = resolveRoute(conn, 'story')
  const judge = resolveRoute(conn, 'judge')
  const storyValue = conn.story.model.trim() || story.model
  const judgeShares = judgePreset === storyPreset
  const judgeDefault = presetFor(judgePreset).defaults?.judge ?? ''
  const takesTemperature = roleTakesTemperature(conn, 'story')
  const judgeTakesTemperature = roleTakesTemperature(conn, 'judge')
  const usesOther = presetFor(storyPreset).group === 'other' || presetFor(judgePreset).group === 'other'

  return (
    <div className={styles.roles}>
      <div className={styles.role} role="group" aria-labelledby={storyTitle}>
        <div className={styles.roleHead}>
          <h4 className={styles.roleTitle} id={storyTitle}>
            Story model
          </h4>
          <p className={styles.roleHelp}>Writes the character's replies and remembers each date.</p>
        </div>
        <div className={styles.grid2}>
          <Field label="Provider" htmlFor={`${idPrefix}-story-provider`}>
            <Select
              value={storyPreset}
              options={providerOptions(conn)}
              onChange={(v) => void updateConnection(storyPresetPatch(conn, v as ConnectionPreset, listedNow(v as ConnectionPreset)))}
            />
          </Field>
          <Field
            label="Model"
            htmlFor={`${idPrefix}-story-model`}
            hint={storyModels.length ? undefined : 'Type a model id, or test the provider to pick from its list.'}
          >
            <ModelInput
              preset={storyPreset}
              models={storyModels}
              value={storyValue}
              placeholder={presetFor(storyPreset).defaults?.story ?? ''}
              onChange={(model) => void updateConnection({ story: { preset: storyPreset, model } })}
            />
          </Field>
        </div>
        {takesTemperature ? (
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
        ) : (
          <div className={styles.info}>
            <span>Story temperature</span>
            <strong>Not used by this model</strong>
          </div>
        )}
      </div>

      <div className={styles.role} role="group" aria-labelledby={judgeTitle}>
        <div className={styles.roleHead}>
          <h4 className={styles.roleTitle} id={judgeTitle}>
            Judge model
          </h4>
          <p className={styles.roleHelp}>Scores your messages. A smaller, faster model works well.</p>
        </div>
        <div className={styles.grid2}>
          <Field label="Provider" htmlFor={`${idPrefix}-judge-provider`}>
            <Select
              value={conn.judge.preset}
              options={providerOptions(conn, `Same as story (${presetFor(storyPreset).label})`)}
              onChange={(v) => {
                const next = v as ConnectionPreset | 'same'
                const models = listedNow(next === 'same' ? storyPreset : next)
                void updateConnection(judgePresetPatch(conn, next, models))
              }}
            />
          </Field>
          <Field
            label="Model"
            htmlFor={`${idPrefix}-judge-model`}
            hint={judgeModels.length ? undefined : 'Type a model id, or leave it empty to use the story model.'}
          >
            <ModelInput
              preset={judgePreset}
              models={judgeModels}
              value={conn.judge.model}
              placeholder={judgeShares ? 'Same as story model' : judgeDefault}
              sameLabel={judgeShares ? `Same as story model (${story.model || 'not picked'})` : undefined}
              onChange={(model) => void updateConnection({ judge: { preset: conn.judge.preset, model } })}
            />
          </Field>
        </div>
        <div className={styles.info}>
          <span>Judge temperature is fixed so scoring stays steady.</span>
          <strong>{judgeTakesTemperature ? JUDGE_TEMPERATURE.toFixed(1) : 'Not used by this model'}</strong>
        </div>
        {!judge.model && <p className={styles.stepDetail}>Pick a judge model, or test the provider to fill one in.</p>}
      </div>

      {usesOther && (
        <Field
          label="Max tokens"
          htmlFor={`${idPrefix}-maxtokens`}
          hint="The longest a single reply can be on Ollama, LM Studio, OpenRouter and custom servers. Claude, ChatGPT and Grok get more room because they think before they answer."
        >
          <Stepper
            value={conn.maxTokens}
            min={100}
            max={4000}
            step={50}
            name="max tokens"
            onChange={(maxTokens) => void updateConnection({ maxTokens })}
          />
        </Field>
      )}
    </div>
  )
}
