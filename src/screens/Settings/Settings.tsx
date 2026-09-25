import { useEffect, useState } from 'react'
import { wipeAll } from '../../db/repo'
import { useNav } from '../../store/nav'
import { useSettings } from '../../store/settings'
import type { PlayerProfile } from '../../types'
import { APP_VERSION } from '../../ui/appVersion'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Panel } from '../../ui/Panel'
import { toast } from '../../ui/toastStore'
import { TopBar } from '../../ui/TopBar'
import { useLongPress } from '../../ui/useLongPress'
import { ConnectionForm } from '../ConnectionSetup/ConnectionForm'
import { ProfileForm } from '../Onboarding/ProfileForm'
import { AppSection } from './AppSection'
import { ImageSection } from './ImageSection'
import { ModsSection } from './ModsSection'
import { PlaySection } from './PlaySection'
import { SavesSection } from './SavesSection'
import styles from './Settings.module.css'

const SECTIONS = [
  { id: 'connection', label: 'Connection' },
  { id: 'profile', label: 'Profile' },
  { id: 'play', label: 'Play' },
  { id: 'images', label: 'Images' },
  { id: 'mods', label: 'Sets and mods' },
  { id: 'saves', label: 'Saves' },
  { id: 'app', label: 'App' },
  { id: 'reset', label: 'Reset' },
] as const

function scrollToSection(id: string, smooth: boolean) {
  const el = document.getElementById(`settings-${id}`)
  if (!el) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: smooth && !reduce ? 'smooth' : 'auto', block: 'start' })
}

export default function Settings() {
  const screen = useNav((s) => s.screen)
  const back = useNav((s) => s.back)
  const go = useNav((s) => s.go)
  const replace = useNav((s) => s.replace)
  const profile = useSettings((s) => s.profile)
  const setProfile = useSettings((s) => s.setProfile)
  const resetInMemory = useSettings((s) => s.resetInMemory)
  const [confirmWipe, setConfirmWipe] = useState(false)
  // The section asked for on arrival; later jumps scroll themselves.
  const [initialSection] = useState(() => (screen.name === 'settings' ? screen.section : undefined))

  useEffect(() => {
    if (!initialSection) return
    const raf = requestAnimationFrame(() => scrollToSection(initialSection, false))
    return () => cancelAnimationFrame(raf)
  }, [initialSection])

  const jump = (id: string) => {
    replace({ name: 'settings', section: id })
    scrollToSection(id, true)
  }

  const saveProfile = async (p: PlayerProfile) => {
    await setProfile(p)
    toast('Profile saved.', 'success')
  }

  const wipe = async () => {
    await wipeAll()
    resetInMemory()
    window.location.hash = '#/gate'
    window.location.reload()
  }

  const versionPress = useLongPress(() => go({ name: 'debug' }))

  return (
    <main className={`screen ${styles.root}`}>
      <TopBar title="Settings" onBack={back} />

      <nav className={styles.jump} aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <Chip key={s.id} onClick={() => jump(s.id)}>
            {s.label}
          </Chip>
        ))}
      </nav>

      <Panel
        id="settings-connection"
        className={styles.section}
        title="Connection"
        description="The models that play every character. Your messages and keys go only to the providers you pick."
      >
        <ConnectionForm idPrefix="settings-conn" />
      </Panel>

      <Panel
        id="settings-profile"
        className={styles.section}
        title="Player profile"
        description="Goes into every story prompt, so characters get your name and pronouns right."
      >
        <ProfileForm
          key={profile ? 'loaded' : 'empty'}
          initial={profile}
          onSubmit={saveProfile}
          submitLabel="Save profile"
          requireChange
          idPrefix="settings-profile"
        />
      </Panel>

      <Panel id="settings-play" className={styles.section} title="Play">
        <PlaySection />
      </Panel>

      <Panel
        id="settings-images"
        className={styles.section}
        title="Image generation"
        description="Optional. Without it, locked and unlocked tiers use imported art, bundled art or placeholders."
      >
        <ImageSection />
      </Panel>

      <Panel
        id="settings-mods"
        className={styles.section}
        title="Character sets and mods"
        description="Mix sets, import packs, and make your own characters."
      >
        <ModsSection />
      </Panel>

      <Panel
        id="settings-saves"
        className={styles.section}
        title="Saves"
        description="Move your game between devices, or keep snapshots to try a different approach. Save files never include your API keys."
      >
        <SavesSection />
      </Panel>

      <Panel
        id="settings-app"
        className={styles.section}
        title="App"
        description="Which crushLAB this is, and how it stays up to date."
      >
        <AppSection />
      </Panel>

      <Panel
        id="settings-reset"
        className={styles.section}
        title="Reset"
        description="Wipe everything crushLAB stores on this device: profile, progress, characters, saves, images and settings."
      >
        <div className={styles.actions}>
          <Button variant="danger" onClick={() => setConfirmWipe(true)}>
            Wipe everything
          </Button>
        </div>
      </Panel>

      <footer className={styles.footer}>
        <button
          type="button"
          className={`${styles.version} long-press`}
          aria-label={`crushLAB version ${APP_VERSION}. Long-press for the debug panel.`}
          {...versionPress}
        >
          crushLAB {APP_VERSION}
        </button>
        <p className={styles.fine}>Made for adults. Nothing about you leaves this device except the model calls you set up.</p>
      </footer>

      <ConfirmDialog
        open={confirmWipe}
        title="Wipe everything?"
        message="This deletes your profile, progress, characters, saves, images and settings from this device. It can't be undone. Export a save file first if you might want it back."
        confirmLabel="Wipe everything"
        tone="danger"
        onConfirm={wipe}
        onCancel={() => setConfirmWipe(false)}
      />
    </main>
  )
}
