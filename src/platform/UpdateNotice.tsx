import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect } from 'react'
import { Button } from '../ui/Button'
import { useUpdateOffer } from './updateOffer'
import { latestReleasePage, openExternal } from './updates'
import styles from './UpdateNotice.module.css'

/** How long the launch notice stays up on its own. Settings keeps a manual check. */
const SHOW_MS = 20_000

/**
 * "Build 14 is ready" with Download and Not now, pinned under the status bar. Raised by the
 * on-launch update check in the Android app; mount once near the app root.
 */
export function UpdateNotice() {
  const offer = useUpdateOffer((s) => s.offer)
  const dismiss = useUpdateOffer((s) => s.dismiss)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!offer) return
    const t = setTimeout(dismiss, SHOW_MS)
    return () => clearTimeout(t)
  }, [offer, dismiss])

  const download = () => {
    if (!offer) return
    openExternal(offer.apkUrl ?? offer.releaseUrl ?? latestReleasePage())
    dismiss()
  }

  return (
    <div className={styles.host}>
      <AnimatePresence>
        {offer && (
          <motion.div
            key="update"
            className={styles.notice}
            role="status"
            aria-live="polite"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
          >
            <p className={styles.text}>
              <span className={styles.title}>A new crushLAB is ready</span>
              <span className={styles.detail}>
                Build {offer.latest} is out. You have build {offer.current}. Your progress stays on this phone.
              </span>
            </p>
            <div className={styles.actions}>
              <Button variant="ghost" onClick={dismiss}>
                Not now
              </Button>
              <Button variant="brass" onClick={download}>
                Download
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
