import {
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cx } from './cx'
import { useField } from './fieldContext'
import styles from './Inputs.module.css'

function describedBy(own: string | undefined, ctx: string | undefined): string | undefined {
  return [own, ctx].filter(Boolean).join(' ') || undefined
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  onChange?: (value: string) => void
  mono?: boolean
}

export function TextInput({ id, className, onChange, mono, type = 'text', ...rest }: TextInputProps) {
  const f = useField(id)
  return (
    <input
      {...rest}
      type={type}
      id={f.id}
      aria-describedby={describedBy(rest['aria-describedby'], f.describedBy)}
      aria-invalid={f.invalid || undefined}
      required={rest.required ?? (f.required || undefined)}
      className={cx(styles.input, mono && styles.mono, className)}
      onChange={(e) => onChange?.(e.target.value)}
    />
  )
}

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  onChange?: (value: string) => void
  mono?: boolean
}

export function TextArea({ id, className, onChange, mono, rows = 3, ...rest }: TextAreaProps) {
  const f = useField(id)
  return (
    <textarea
      {...rest}
      rows={rows}
      id={f.id}
      aria-describedby={describedBy(rest['aria-describedby'], f.describedBy)}
      aria-invalid={f.invalid || undefined}
      className={cx(styles.input, styles.textarea, mono && styles.mono, className)}
      onChange={(e) => onChange?.(e.target.value)}
    />
  )
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[]
  onChange?: (value: string) => void
}

export function Select({ id, className, options, onChange, ...rest }: SelectProps) {
  const f = useField(id)
  return (
    <div className={styles.selectWrap}>
      <select
        {...rest}
        id={f.id}
        aria-describedby={describedBy(rest['aria-describedby'], f.describedBy)}
        aria-invalid={f.invalid || undefined}
        className={cx(styles.input, styles.select, className)}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <svg className={styles.chevron} viewBox="0 0 14 14" aria-hidden="true">
        <path d="M3 5.5 7 9.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export interface MaskedInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  onChange?: (value: string) => void
  /** What the value is, for the show/hide button's accessible name. */
  noun?: string
}

/** A secret field (API keys): masked by default with a show/hide toggle. */
export function MaskedInput({ id, className, onChange, noun = 'key', ...rest }: MaskedInputProps) {
  const f = useField(id)
  const [shown, setShown] = useState(false)
  return (
    <div className={styles.masked}>
      <input
        {...rest}
        type={shown ? 'text' : 'password'}
        id={f.id}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-describedby={describedBy(rest['aria-describedby'], f.describedBy)}
        aria-invalid={f.invalid || undefined}
        className={cx(styles.input, styles.mono, className)}
        onChange={(e) => onChange?.(e.target.value)}
      />
      <button
        type="button"
        className={styles.reveal}
        aria-pressed={shown}
        aria-label={shown ? `Hide ${noun}` : `Show ${noun}`}
        aria-controls={f.id}
        onClick={() => setShown((v) => !v)}
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

export interface SliderProps {
  id?: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  /** Formats the readout next to the slider. */
  format?: (value: number) => string
  disabled?: boolean
}

/** A range slider with a numeric readout. */
export function Slider({
  id,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v) => String(v),
  disabled,
}: SliderProps) {
  const f = useField(id)
  const fill = `${((value - min) / (max - min)) * 100}%`
  return (
    <div className={styles.sliderRow}>
      <input
        type="range"
        id={f.id}
        className={styles.slider}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-describedby={f.describedBy}
        aria-valuetext={format(value)}
        style={{ '--fill': fill } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output className={styles.sliderValue} htmlFor={f.id} aria-hidden="true">
        {format(value)}
      </output>
    </div>
  )
}
