// The unlock reveal: new art develops like instant film (docs/SPEC.md, Design). A white-bordered
// print starts dark with developer, goes milky, and the picture comes up through it over about
// 2.5 seconds; the tier or ending title is written in brass on the print's wide bottom margin. It
// is the one orchestrated motion moment in the app, so it plays once per unlock (the caller keeps
// track) and only when the print is on screen; a tap shows it at once. With prefers-reduced-motion
// it becomes a plain fade.
//
// Motion is transform and opacity layers, plus one filter on the picture; no blur.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { success } from '../platform/haptics'
import { cx } from './cx'
import { revealDuration, type FilmState } from './InstantFilm.model'
import styles from './InstantFilm.module.css'

export interface InstantFilmProps {
  /** The picture on the print (an image or the placeholder art); it fills the print's window. */
  children: ReactNode
  /** The brass caption on the margin: the tier or ending title. */
  title: string
  /** A small line over the title, like "Tier 3" or "Your ending". */
  kicker?: string
  /**
   * waiting: an undeveloped print (queued behind another). developing: develops once it's ready
   * and on screen, then calls onDone. done: the developed print, still.
   */
  state: FilmState
  /** False holds the development (the art is still being looked up). Default true. */
  ready?: boolean
  /** Called once when the print has developed, or when a tap skipped to the end. */
  onDone?: () => void
  className?: string
}

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

/** The player's reduced-motion preference, followed while the print is on screen. */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => {
    try {
      return typeof window !== 'undefined' && !!window.matchMedia?.(REDUCE_QUERY).matches
    } catch {
      return false
    }
  })
  useEffect(() => {
    let mq: MediaQueryList | undefined
    try {
      mq = window.matchMedia?.(REDUCE_QUERY)
    } catch {
      mq = undefined
    }
    if (!mq?.addEventListener) return
    const onChange = (e: MediaQueryListEvent) => setReduce(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduce
}

/** True once at least 60% of the element has been on screen (true where there's no observer). */
function useSeen(active: boolean): [(el: Element | null) => void, boolean] {
  const [el, setEl] = useState<Element | null>(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (!active || seen || !el) return
    const io = new IntersectionObserver(
      (list) => {
        if (list.some((e) => e.isIntersecting)) setSeen(true)
      },
      { threshold: 0.6 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [active, seen, el])
  return [setEl, seen]
}

export function InstantFilm({ children, title, kicker, state, ready = true, onDone, className }: InstantFilmProps) {
  const reduce = usePrefersReducedMotion()
  const [ref, seen] = useSeen(state === 'developing')
  const running = state === 'developing' && ready && seen
  const [finished, setFinished] = useState(false)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })

  const finish = () => {
    if (finished) return
    setFinished(true)
    void success()
    doneRef.current?.()
  }
  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  })

  // The print develops for the reveal's length, then it's done.
  useEffect(() => {
    if (!running) return
    const t = setTimeout(() => finishRef.current(), revealDuration(reduce))
    return () => clearTimeout(t)
  }, [running, reduce])

  // A new round of developing (the caller queued this print again) starts fresh.
  const [lastState, setLastState] = useState(state)
  if (lastState !== state) {
    setLastState(state)
    if (state !== 'developing') setFinished(false)
  }

  const visual: FilmState = state === 'done' || finished ? 'done' : running ? 'developing' : 'waiting'

  return (
    <figure
      ref={ref}
      className={cx(styles.film, styles[visual], reduce && styles.reduced, className)}
      data-state={visual}
      aria-busy={visual !== 'done' || undefined}
    >
      <div className={styles.window}>
        <div className={styles.picture}>{children}</div>
        <div className={styles.chem} aria-hidden="true" />
        <div className={styles.milk} aria-hidden="true" />
        <div className={styles.gloss} aria-hidden="true" />
      </div>
      <figcaption className={styles.margin}>
        {kicker && <span className={styles.kicker}>{kicker}</span>}
        <span className={styles.title}>{title}</span>
      </figcaption>
      {state === 'developing' && visual !== 'done' && (
        <button type="button" className={styles.skip} onClick={finish}>
          <span className="visually-hidden">Developing {title}. Show it now</span>
        </button>
      )}
    </figure>
  )
}
