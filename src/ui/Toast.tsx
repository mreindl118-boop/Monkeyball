import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { cx } from './cx'
import styles from './Toast.module.css'
import { useToasts } from './toastStore'

/** Renders toasts. Mount once near the app root. */
export function ToastHost() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  const reduce = useReducedMotion()
  return (
    <div className={styles.host} role="status" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout={!reduce}
            className={cx(styles.toast, t.tone === 'success' && styles.success, t.tone === 'error' && styles.error)}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
          >
            <span className={styles.text}>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  dismiss(t.id)
                  t.action?.run()
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className={styles.dismiss} onClick={() => dismiss(t.id)}>
              Dismiss
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
