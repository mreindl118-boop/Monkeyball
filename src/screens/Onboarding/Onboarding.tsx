import { useEffect, useRef, useState } from 'react'
import { testConnection } from '../../llm/diagnose'
import { rolePreset, slotFor } from '../../llm/routes'
import { useNav } from '../../store/nav'
import { useSettings } from '../../store/settings'
import { afterTestPatch, slotSignature } from '../ConnectionSetup/connectionHelpers'
import { setOnboardingProblem } from '../ConnectionSetup/lastCheck'
import { useModelLists } from '../ConnectionSetup/modelLists'
import type { OrientationMode, PlayerProfile } from '../../types'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { Panel } from '../../ui/Panel'
import { Segmented } from '../../ui/Segmented'
import { Wordmark } from '../../ui/Wordmark'
import styles from './Onboarding.module.css'
import { ORIENTATION_OPTIONS } from './profile'
import { ProfileForm } from './ProfileForm'

/**
 * Player profile, right after the 18+ gate. On save it quietly tests the model connection:
 * reachable goes to the hub, anything else goes to connection setup.
 */
export default function Onboarding() {
  const profile = useSettings((s) => s.profile)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const setProfile = useSettings((s) => s.setProfile)
  const updateConnection = useSettings((s) => s.updateConnection)
  const reset = useNav((s) => s.reset)

  const [orientation, setOrientation] = useState<OrientationMode>(settings.orientationMode)
  const [checking, setChecking] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const pendingRef = useRef<PlayerProfile | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const finish = async (p: PlayerProfile, target: 'hub' | 'connection-setup') => {
    await update({ onboarded: true, orientationMode: orientation })
    reset({ name: target })
    await setProfile(p)
  }

  const onSubmit = async (p: PlayerProfile) => {
    pendingRef.current = p
    setChecking(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const conn = useSettings.getState().settings.connection
    try {
      const result = await testConnection(conn, { signal: ctrl.signal, completionTimeoutMs: 60_000 })
      if (ctrl.signal.aborted) return
      if (result.ok) {
        // Fill any empty role models from the story provider's list, and remember the list.
        const preset = rolePreset(conn, 'story')
        const sig = slotSignature(slotFor(conn, preset))
        if (result.models.length) useModelLists.getState().put(preset, sig, result.models)
        useModelLists.getState().markReady(preset, sig)
        const patch = afterTestPatch(conn, preset, result.models)
        if (patch) await updateConnection(patch)
        await finish(p, 'hub')
      } else {
        setOnboardingProblem(result.problem ?? null)
        await finish(p, 'connection-setup')
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setOnboardingProblem({
          kind: 'other',
          message: "The connection check didn't finish.",
          fix: e instanceof Error ? e.message : String(e),
        })
        await finish(p, 'connection-setup')
      }
    } finally {
      setChecking(false)
    }
  }

  const skipCheck = async () => {
    abortRef.current?.abort()
    const p = pendingRef.current
    if (p) await finish(p, 'hub')
  }

  return (
    <main className={`screen ${styles.root}`} aria-labelledby="onboarding-title">
      <Wordmark size={30} />
      <div className={styles.head}>
        <p className={styles.step}>Your profile</p>
        <h1 className={styles.title} id="onboarding-title">
          Who's walking in tonight?
        </h1>
        <p className={styles.sub}>
          Characters use this to talk to you and about you. It stays on this device, and you can
          change it any time in Settings.
        </p>
      </div>

      <Panel as="div">
        <ProfileForm
          initial={profile}
          onSubmit={onSubmit}
          submitLabel={checking ? 'Checking your model' : 'Save and continue'}
          busy={checking}
          idPrefix="onboarding"
          status={checking ? 'Looking for your model server. A local model can take a moment to wake up.' : undefined}
          actions={
            checking ? (
              <Button variant="ghost" onClick={skipCheck}>
                Skip the check
              </Button>
            ) : undefined
          }
        >
          <Field
            label="Who's into you"
            kind="group"
            htmlFor="onboarding-orientation"
            hint="You can switch this later in Settings."
          >
            <Segmented
              variant="cards"
              value={orientation}
              options={ORIENTATION_OPTIONS}
              onChange={setOrientation}
            />
          </Field>
        </ProfileForm>
      </Panel>
    </main>
  )
}
