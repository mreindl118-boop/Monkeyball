// Define the relationship on the date screen: the sheet with the four choices, the brass banner
// when the character brings it up, the brass bar while the talk is open (with Close the talk), and
// the outcome in the transcript once the Agreement prompt has answered. Brass throughout: it's
// about agreements.

import { useId, useRef, useState, type KeyboardEvent } from 'react'
import type { AgreementType, DtrRecord } from '../../types'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Sheet } from '../../ui/Sheet'
import { firstName } from './dateModel'
import styles from './Dtr.module.css'
import {
  DTR_CHOICES,
  dtrOpenLine,
  dtrOutcome,
  initialChoice,
  offerDetail,
  offerText,
  type DtrChoiceType,
} from './dtrModel'

export function DtrSheet({
  open,
  name,
  offer,
  current,
  onAsk,
  onClose,
}: {
  open: boolean
  name: string
  /** What the character asked for, when they brought it up. */
  offer: AgreementType | null
  current: AgreementType
  onAsk: (type: DtrChoiceType) => void
  onClose: () => void
}) {
  const [choice, setChoice] = useState<DtrChoiceType>(() => initialChoice(offer, current))
  // Each time the sheet opens it starts on what they asked for (or the agreement you have).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setChoice(initialChoice(offer, current))
  }
  const group = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const first = firstName(name)

  // Arrow keys move through the choices, like any radio group.
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const n = DTR_CHOICES.length
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight'
    const backward = e.key === 'ArrowUp' || e.key === 'ArrowLeft'
    if (!forward && !backward) return
    e.preventDefault()
    const next = forward ? (i + 1) % n : (i - 1 + n) % n
    setChoice(DTR_CHOICES[next].type)
    refs.current[next]?.focus()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Define the relationship"
      description={
        offer
          ? `${offerDetail(name, offer)} Ask for what you want; the answer can be yes, a counter with other terms, or no.`
          : `Ask ${first} what you are. The answer can be yes, a counter with other terms, or no.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button variant="brass" onClick={() => onAsk(choice)}>
            Ask {first}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-labelledby={`${group}-label`} className={styles.group}>
        <p id={`${group}-label`} className="visually-hidden">
          What you'd like to be
        </p>
        {DTR_CHOICES.map((c, i) => {
          const on = c.type === choice
          return (
            <button
              key={c.type}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className={cx(styles.choice, on && styles.chosen)}
              onClick={() => setChoice(c.type)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <span className={styles.radio} aria-hidden="true" />
              <span className={styles.choiceText}>
                <span className={styles.choiceTitle}>
                  {c.title}
                  {offer === c.type && <span className={styles.theirs}>What {first} wants</span>}
                  {current === c.type && offer !== c.type && <span className={styles.theirs}>What you have now</span>}
                </span>
                <span className={styles.choiceLine}>{c.line}</span>
              </span>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}

/** The character brings it up: Talk opens the sheet on what they want, Not now lets it go. */
export function DtrOffer({
  name,
  offer,
  onTalk,
  onLater,
}: {
  name: string
  offer: AgreementType | null
  onTalk: () => void
  onLater: () => void
}) {
  return (
    <div className={styles.banner} role="status">
      <div className={styles.bannerText}>
        <p className={styles.bannerTitle}>{offerText(name)}</p>
        <p className={styles.bannerLine}>{offerDetail(name, offer)}</p>
      </div>
      <div className={styles.bannerActions}>
        <Button variant="brass" size="small" onClick={onTalk}>
          Talk
        </Button>
        <Button variant="ghost" size="small" onClick={onLater}>
          Not now
        </Button>
      </div>
    </div>
  )
}

/** While the talk is open: what was asked, and Close the talk. */
export function DtrOpen({
  name,
  dtr,
  closing,
  disabled,
  onClose,
}: {
  name: string
  dtr: DtrRecord
  closing: boolean
  disabled: boolean
  onClose: () => void
}) {
  return (
    <div className={cx(styles.banner, styles.open)} role="status">
      <div className={styles.bannerText}>
        <p className={styles.bannerTitle}>Defining the relationship</p>
        <p className={styles.bannerLine}>{dtrOpenLine(name, dtr.requested, dtr.by)}</p>
      </div>
      <div className={styles.bannerActions}>
        <Button variant="brass" size="small" loading={closing} disabled={disabled} onClick={onClose}>
          Close the talk
        </Button>
      </div>
    </div>
  )
}

/** How the talk ended, in the transcript: accepted, countered or declined, in their words. */
export function DtrResult({ name, dtr, current }: { name: string; dtr: DtrRecord; current: AgreementType }) {
  if (!dtr.result) return null
  const out = dtrOutcome(name, dtr.requested, dtr.result, { type: current })
  return (
    <div className={cx(styles.result, styles[out.kind])} role="note">
      <p className={styles.resultTitle}>{out.title}</p>
      <p className={styles.resultLine}>{out.line}</p>
      {out.terms && (
        <blockquote className={styles.resultTerms}>
          <p>{out.terms}</p>
        </blockquote>
      )}
    </div>
  )
}
