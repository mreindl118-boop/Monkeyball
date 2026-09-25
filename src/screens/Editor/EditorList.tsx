import { useState, type CSSProperties } from 'react'
import { portraitAccent } from '../../art/Portrait.model'
import { BUNDLED_SET_IDS } from '../../data/bundled'
import { slugify } from '../../mods/normalize'
import { useNav } from '../../store/nav'
import { CUSTOM_SET_ID, selectSetEntries, useRoster } from '../../store/roster'
import { useSettings } from '../../store/settings'
import type { RosterEntry } from '../../types'
import { Button, IconButton } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Sheet } from '../../ui/Sheet'
import { toast } from '../../ui/toastStore'
import { TopBar } from '../../ui/TopBar'
import { exportCharacterFile } from '../CharacterSets/exportPack'
import { ImportModButton } from '../CharacterSets/ModImport'
import { PackExportSheet } from '../CharacterSets/PackExportSheet'
import { withPartners } from '../CharacterSets/setsModel'
import styles from './Editor.module.css'
import { NEW_CHARACTER_ID } from './editorModel'

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="5.5" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.8" fill="currentColor" />
    </svg>
  )
}

export function EditorList({ ready }: { ready: boolean }) {
  const back = useNav((s) => s.back)
  const go = useNav((s) => s.go)
  const sets = useRoster((s) => s.sets)
  const entries = useRoster((s) => s.entries)
  const profileName = useSettings((s) => s.profile?.name ?? '')
  const heat = useSettings((s) => s.settings.heat)
  const [menu, setMenu] = useState<RosterEntry | null>(null)
  const [deleting, setDeleting] = useState<RosterEntry | null>(null)
  const [zipFor, setZipFor] = useState<RosterEntry | null>(null)
  const [busy, setBusy] = useState(false)

  const duplicate = async (e: RosterEntry) => {
    setBusy(true)
    const newId = await useRoster.getState().duplicateCharacter(e.character.id)
    setBusy(false)
    setMenu(null)
    if (!newId) {
      toast("Couldn't make a copy.", 'error')
      return
    }
    toast(`Made a copy of ${e.character.name}.`, 'success')
    go({ name: 'editor', id: newId })
  }

  const remove = async () => {
    if (!deleting) return
    const ok = await useRoster.getState().deleteCustomCharacter(deleting.character.id)
    toast(ok ? `${deleting.character.name} was deleted. Your progress with them is kept.` : "Couldn't delete them.", ok ? 'success' : 'error')
    setDeleting(null)
  }

  const zipSet = zipFor ? sets.find((s) => s.id === zipFor.setId) : undefined
  const zipCharacters = zipFor ? withPartners(zipFor.character.id, entries) : []

  return (
    <main className={`screen ${styles.root}`} aria-busy={!ready || undefined}>
      <TopBar title="Character editor" onBack={back} />

      <p className={styles.intro}>
        Make characters from scratch, copy the ones that come with crushLAB to remix them, and share them as mods. Everyone
        is 21 or older, and the world rules stay locked.
      </p>

      <div className={styles.topActions}>
        <Button variant="primary" onClick={() => go({ name: 'editor', id: NEW_CHARACTER_ID })}>
          New character
        </Button>
        <ImportModButton label="Import mod file" />
      </div>

      {sets.map((set) => {
        const members = selectSetEntries({ sets, entries }, set.id)
        if (!members.length) return null
        const bundled = BUNDLED_SET_IDS.includes(set.id)
        return (
          <section key={set.id} className={styles.setGroup} aria-labelledby={`ed-set-${set.id}`}>
            <div className={styles.setHead}>
              <h2 className={styles.setName} id={`ed-set-${set.id}`}>
                {set.name}
              </h2>
              {bundled && <Chip tone="brass">Read-only</Chip>}
            </div>
            <ul className={styles.charList}>
              {members.map((e) => {
                const c = e.character
                const name = c.name.trim() || c.id
                return (
                  <li key={c.id} className={styles.charRow} style={{ '--accent': portraitAccent(c.accent) } as CSSProperties}>
                    <button type="button" className={styles.charMain} onClick={() => go({ name: 'editor', id: c.id })}>
                      <span className={styles.swatch} aria-hidden="true" />
                      <span className={styles.charText}>
                        <span className={styles.charName}>{name}</span>
                        <span className={styles.charMeta}>{c.id}</span>
                      </span>
                    </button>
                    <IconButton label={`More for ${name}`} onClick={() => setMenu(e)}>
                      <DotsIcon />
                    </IconButton>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {!sets.some((s) => s.id === CUSTOM_SET_ID) && (
        <p className={styles.fine}>Characters you make land in My characters, unless you save them into an imported pack.</p>
      )}

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={<span className="name">{menu?.character.name ?? ''}</span>}>
        {menu && (
          <div className={styles.menu}>
            {menu.source === 'bundled' ? (
              <>
                <Button variant="primary" block loading={busy} onClick={() => void duplicate(menu)}>
                  Duplicate to edit
                </Button>
                <Button
                  variant="secondary"
                  block
                  onClick={() => {
                    setMenu(null)
                    go({ name: 'editor', id: menu.character.id })
                  }}
                >
                  View the card
                </Button>
                <Button
                  variant="secondary"
                  block
                  aria-describedby="ed-template-note"
                  onClick={() => {
                    const c = menu.character
                    setMenu(null)
                    void exportCharacterFile(c, { bundled: true })
                  }}
                >
                  Export JSON
                </Button>
                <p className={styles.fine} id="ed-template-note">
                  Exports a template: crushLAB already has {menu.character.name}, so change the id before importing it.
                </p>
              </>
            ) : (
              <>
                <Button
                  variant="primary"
                  block
                  onClick={() => {
                    setMenu(null)
                    go({ name: 'editor', id: menu.character.id })
                  }}
                >
                  Edit
                </Button>
                <Button variant="secondary" block loading={busy} onClick={() => void duplicate(menu)}>
                  Duplicate
                </Button>
                <Button
                  variant="secondary"
                  block
                  onClick={() => {
                    const c = menu.character
                    setMenu(null)
                    void exportCharacterFile(c)
                  }}
                >
                  Export JSON
                </Button>
                <Button
                  variant="secondary"
                  block
                  onClick={() => {
                    setZipFor(menu)
                    setMenu(null)
                  }}
                >
                  Export as .zip pack
                </Button>
                <Button
                  variant="danger"
                  block
                  onClick={() => {
                    setDeleting(menu)
                    setMenu(null)
                  }}
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.character.name ?? 'this character'}?`}
        message="They leave the roster and the editor. Your progress with them is kept, so importing them again picks up where you left off."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />

      <PackExportSheet
        open={!!zipFor}
        onClose={() => setZipFor(null)}
        title={zipFor ? `Export ${zipFor.character.name}` : 'Export'}
        characters={zipCharacters}
        relationships={zipSet?.relationships}
        defaults={
          zipFor
            ? {
                // Named after the character, never the pack's own id: importing a one-character
                // pack under that id would replace the whole pack.
                name: zipFor.character.name,
                id: slugify(zipFor.character.name) || zipFor.character.id,
                author: zipSet?.author ?? profileName,
                blurb:
                  zipSet && zipSet.id !== CUSTOM_SET_ID
                    ? zipSet.blurb
                    : `${zipFor.character.name}, ${zipFor.character.occupation.charAt(0).toLowerCase()}${zipFor.character.occupation.slice(1)}.`,
                heat: zipSet?.heat ?? heat,
              }
            : {}
        }
      />
    </main>
  )
}
