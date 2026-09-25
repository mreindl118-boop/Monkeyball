import { DEFAULT_STYLE_PREFIXES } from '../../store/defaults'
import { useSettings } from '../../store/settings'
import type { StylePreset } from '../../types'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { Select, TextArea, TextInput } from '../../ui/Inputs'
import { Note } from '../../ui/Panel'
import { Segmented, type SegmentedOption } from '../../ui/Segmented'
import { Stepper } from '../../ui/Stepper'
import { Toggle } from '../../ui/Toggle'
import styles from './Settings.module.css'

const STYLE_OPTIONS: SegmentedOption<StylePreset>[] = [
  { value: 'anime', label: 'Anime' },
  { value: 'semiReal', label: 'Semi-real' },
  { value: 'painterly', label: 'Painterly' },
]

const SAMPLERS = [
  'DPM++ 2M',
  'DPM++ 2M SDE',
  'DPM++ SDE',
  'Euler a',
  'Euler',
  'DDIM',
  'UniPC',
  'LCM',
]

export function ImageSection() {
  const img = useSettings((st) => st.settings.image)
  const updateImage = useSettings((st) => st.updateImage)
  const prefix = img.stylePrefixes[img.stylePreset]
  const isDefaultPrefix = prefix === DEFAULT_STYLE_PREFIXES[img.stylePreset]
  const samplerOptions = (SAMPLERS.includes(img.sampler) ? SAMPLERS : [img.sampler, ...SAMPLERS]).map(
    (v) => ({ value: v, label: v }),
  )

  const setPrefix = (text: string) =>
    void updateImage({ stylePrefixes: { ...img.stylePrefixes, [img.stylePreset]: text } })

  return (
    <div className={styles.stack}>
      <Toggle
        checked={img.enabled}
        onChange={(enabled) => void updateImage({ enabled })}
        label="Generate art"
        description="Paint unlocked tiers with an Automatic1111 or Forge server when there's no imported or bundled art. Off shows placeholders."
      />

      <Field
        label="Image server URL"
        htmlFor="img-url"
        hint="Launch it with --api and --cors-allow-origins so the app can reach it."
      >
        <TextInput
          value={img.baseUrl}
          onChange={(baseUrl) => void updateImage({ baseUrl })}
          placeholder="http://127.0.0.1:7860"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          mono
        />
      </Field>

      <Field label="Style" kind="group" htmlFor="img-style">
        <Segmented
          value={img.stylePreset}
          options={STYLE_OPTIONS}
          onChange={(stylePreset) => void updateImage({ stylePreset })}
        />
      </Field>

      <Field
        label="Style prefix"
        htmlFor="img-prefix"
        aside={
          isDefaultPrefix ? undefined : (
            <Button
              variant="ghost"
              size="small"
              onClick={() => setPrefix(DEFAULT_STYLE_PREFIXES[img.stylePreset])}
            >
              Restore default
            </Button>
          )
        }
        hint="Goes at the start of every prompt for this style. Edit freely."
      >
        <TextArea value={prefix} onChange={setPrefix} rows={3} mono />
      </Field>

      <Note tone="brass" title="Safety text is always added">
        Every prompt also states each character's adult age, and every negative prompt rules out
        childlike or underage looks and non-consent. That part is added automatically and can't be
        edited.
      </Note>

      <div className={styles.grid2}>
        <Field label="Width" htmlFor="img-w">
          <Stepper
            value={img.width}
            min={512}
            max={1536}
            step={64}
            unit="px"
            name="width"
            onChange={(width) => void updateImage({ width })}
          />
        </Field>
        <Field label="Height" htmlFor="img-h">
          <Stepper
            value={img.height}
            min={512}
            max={1536}
            step={64}
            unit="px"
            name="height"
            onChange={(height) => void updateImage({ height })}
          />
        </Field>
        <Field label="Steps" htmlFor="img-steps">
          <Stepper
            value={img.steps}
            min={4}
            max={80}
            name="steps"
            onChange={(steps) => void updateImage({ steps })}
          />
        </Field>
        <Field label="CFG scale" htmlFor="img-cfg">
          <Stepper
            value={img.cfg}
            min={1}
            max={15}
            step={0.5}
            name="CFG scale"
            onChange={(cfg) => void updateImage({ cfg })}
          />
        </Field>
      </div>

      <div className={styles.grid2}>
        <Field label="Sampler" htmlFor="img-sampler">
          <Select
            value={img.sampler}
            options={samplerOptions}
            onChange={(sampler) => void updateImage({ sampler })}
          />
        </Field>
        <Field
          label="Seed"
          kind="group"
          htmlFor="img-seed"
          hint={
            img.seedMode === 'fixed'
              ? 'Each character keeps one seed, so they look consistent across tiers.'
              : 'A new seed every time.'
          }
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
