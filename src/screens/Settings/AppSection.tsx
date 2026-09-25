import { useState } from 'react'
import { isNative } from '../../platform/platform'
import {
  checkForUpdate,
  currentBuild,
  latestReleasePage,
  openExternal,
  refreshWebApp,
  type UpdateInfo,
} from '../../platform/updates'
import { useSettings } from '../../store/settings'
import { APP_VERSION } from '../../ui/appVersion'
import { Button } from '../../ui/Button'
import { Toggle } from '../../ui/Toggle'
import styles from './Settings.module.css'

type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'done'; info: UpdateInfo }
  | { state: 'failed' }

/** What the manual check found, in one or two sentences. */
export function describeUpdate(info: UpdateInfo): string {
  if (info.current === 0) {
    return `This is a development build, so there's nothing to compare it with. The newest release is build ${info.latest}.`
  }
  if (info.available) return `Build ${info.latest} is ready. You have build ${info.current}.`
  return `You have the newest build (${info.current}).`
}

function NativeUpdates() {
  const autoUpdateCheck = useSettings((s) => s.settings.autoUpdateCheck)
  const update = useSettings((s) => s.update)
  const [check, setCheck] = useState<Check>({ state: 'idle' })

  const run = async () => {
    setCheck({ state: 'checking' })
    const info = await checkForUpdate()
    setCheck(info ? { state: 'done', info } : { state: 'failed' })
  }

  const info = check.state === 'done' ? check.info : null
  const downloadUrl = info && (info.available || info.current === 0) ? (info.apkUrl ?? info.releaseUrl) : undefined

  return (
    <>
      <div className={styles.actions}>
        <Button variant="secondary" loading={check.state === 'checking'} onClick={run}>
          Check for updates
        </Button>
        {downloadUrl && (
          <Button variant="brass" onClick={() => openExternal(downloadUrl)}>
            Download
          </Button>
        )}
      </div>
      <p className={styles.appNote} role="status" aria-live="polite">
        {info
          ? `${describeUpdate(info)}${downloadUrl ? ' Download opens the new APK in your browser; open it to install over this one. Your progress stays on this phone.' : ''}`
          : check.state === 'failed'
            ? "Couldn't reach GitHub to check. Check your connection and try again."
            : ''}
      </p>
      <div className={styles.toggles}>
        <Toggle
          checked={autoUpdateCheck}
          onChange={(on) => void update({ autoUpdateCheck: on })}
          label="Check for updates on launch"
          description="Looks at the newest crushLAB release on GitHub when the app opens. Sends nothing about you."
        />
      </div>
    </>
  )
}

function WebUpdates() {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    const ok = await refreshWebApp()
    setBusy(false)
    setNote(
      ok
        ? "Checked. If there's a new version, crushLAB uses it the next time you open it."
        : 'Reload the page to get the newest version.',
    )
  }

  return (
    <>
      <p className={styles.appNote}>
        The web app updates itself: a new version downloads in the background and is used the next
        time you open crushLAB.
      </p>
      <div className={styles.actions}>
        <Button variant="secondary" loading={busy} onClick={run}>
          Check for updates
        </Button>
        <Button variant="ghost" onClick={() => openExternal(latestReleasePage())}>
          Get the Android app
        </Button>
      </div>
      <p className={styles.appNote} role="status" aria-live="polite">
        {note}
      </p>
      <p className={styles.appNote}>
        The Android app can also talk to Ollama or LM Studio on a PC on your Wi-Fi, which this page
        can't when it's opened over https.
      </p>
    </>
  )
}

/** Settings, App: version and build, and updates (the APK checks GitHub; the web updates itself). */
export function AppSection() {
  const native = isNative()
  const build = currentBuild()
  return (
    <div className={styles.stack}>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Version</dt>
          <dd>{APP_VERSION}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Build</dt>
          <dd>{build > 0 ? build : 'Development build'}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Running as</dt>
          <dd>{native ? 'Android app' : 'Web app'}</dd>
        </div>
      </dl>
      <div className={styles.appUpdates}>{native ? <NativeUpdates /> : <WebUpdates />}</div>
    </div>
  )
}
