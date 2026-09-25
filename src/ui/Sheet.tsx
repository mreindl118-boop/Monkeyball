import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { isTopOverlay, pushOverlay } from './overlays'
import styles from './Sheet.module.css'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Buttons pinned to the bottom of the sheet. */
  footer?: ReactNode
  role?: 'dialog' | 'alertdialog'
  /** Tapping the backdrop closes the sheet (default true). */
  dismissible?: boolean
  /** Element to focus first; defaults to the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.offsetParent !== null,
  )
}

/** A bottom sheet (a centered dialog on wide screens). Escape and the back button close it. */
export function Sheet(props: SheetProps) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>{props.open && <SheetInner key="sheet" {...props} />}</AnimatePresence>,
    document.body,
  )
}

function SheetInner({
  onClose,
  title,
  description,
  children,
  footer,
  role = 'dialog',
  dismissible = true,
  initialFocusRef,
}: SheetProps) {
  const reduce = useReducedMotion()
  const id = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  // Register in the overlay stack, lock page scroll, manage focus.
  useEffect(() => {
    const close = () => closeRef.current()
    const unregister = pushOverlay(close)
    const previous = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const panel = panelRef.current
    if (panel) {
      const target = initialFocusRef?.current ?? focusables(panel)[0] ?? panel
      target.focus({ preventScroll: true })
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopOverlay(close)) {
        e.preventDefault()
        close()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      unregister()
      document.body.style.overflow = prevOverflow
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
    // Runs once per open: the ref object is stable for the sheet's lifetime.
  }, [initialFocusRef])

  // Focus trap-lite: Tab wraps inside the sheet.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return
    const items = focusables(panelRef.current)
    if (!items.length) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const fade = { duration: reduce ? 0 : 0.2 }
  const slide = reduce
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 38, mass: 0.9 }

  return (
    <>
      <motion.div
        className={styles.backdrop}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={fade}
        onClick={dismissible ? () => closeRef.current() : undefined}
        aria-hidden="true"
      />
      <div className={styles.wrap}>
        <motion.div
          ref={panelRef}
          role={role}
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          aria-describedby={description ? `${id}-desc` : undefined}
          tabIndex={-1}
          className={styles.sheet}
          initial={reduce ? { opacity: 0 } : { y: '100%' }}
          animate={reduce ? { opacity: 1 } : { y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: '100%' }}
          transition={slide}
          onKeyDown={onKeyDown}
        >
          <div>
            <div className={styles.handle} aria-hidden="true" />
            <div className={styles.head}>
              <h2 className={styles.title} id={`${id}-title`}>
                {title}
              </h2>
              {description && (
                <p className={styles.description} id={`${id}-desc`}>
                  {description}
                </p>
              )}
            </div>
          </div>
          {children ? <div className={styles.body}>{children}</div> : <div />}
          {footer ? <div className={styles.footer}>{footer}</div> : <div />}
        </motion.div>
      </div>
    </>
  )
}
