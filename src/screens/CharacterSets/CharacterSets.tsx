import { useState } from 'react'
import { BUNDLED_SET_IDS } from '../../data/bundled'
import { useNav } from '../../store/nav'
import { CUSTOM_SET_ID, selectSetEntries, useRoster } from '../../store/roster'
import { useSettings } from '../../store/settings'
import type { SetManifest } from '../../types'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { cx } from '../../ui/cx'
import { Toggle } from '../../ui/Toggle'
import { toast } from '../../ui/toastStore'
import { TopBar } from '../../ui/TopBar'
import { useRosterAndGame } from '../Hub/useRosterGame'
import styles from './CharacterSets.module.css'
import { exportSetZip } from './exportPack'
import { ImportModButton } from './ModImport'
import { PackExportSheet } from './PackExportSheet'
import {
  characterCount,
  heatText,
  removeMessage,
  relationKindText,
  knowsLine,
  offSetNote,
  setRelationLines,
  setSource,
  sourceLabel,
} from './setsModel'

export default function CharacterSets() {
  const back = useNav((s) => s.back)
  const go = useNav((s) => s.go)
  const ready = useRosterAndGame()
  const sets = useRoster((s) => s.sets)
  const profileName = useSettings((s) => s.profile?.name ?? '')
  const heat = useSettings((s) => s.settings.heat)
  const [removing, setRemoving] = useState<SetManifest | null>(null)
  const [exportingCustom, setExportingCustom] = useState(false)
  const entries = useRoster((s) => s.entries)
  const customCharacters = selectSetEntries({ sets, entries }, CUSTOM_SET_ID).map((e) => e.character)

  const removingMembers = removing ? selectSetEntries({ sets, entries }, removing.id) : []
  const removingOwn = removingMembers.filter((e) => e.source === 'custom').map((e) => e.character.name.trim() || e.character.id)
  const removingCount = removingMembers.length - removingOwn.length

  const remove = async () => {
    if (!removing) return
    const moved = await useRoster.getState().removePack(removing.id)
    toast(
      moved.length
        ? `${removing.name} was removed. ${characterCount(moved.length)} you made in it moved to My characters. Progress is kept.`
        : `${removing.name} was removed. Progress with its characters is kept.`,
      'success',
      moved.length ? 7000 : undefined,
    )
    setRemoving(null)
  }

  return (
    <main className={`screen ${styles.root}`} aria-busy={!ready || undefined}>
      <TopBar title="Character sets" onBack={back} />

      <p className={styles.intro}>
        Sets in play fill the city together. Turning one off hides its characters from the hub; their progress stays.
      </p>

      <div className={styles.topActions}>
        <ImportModButton label="Import a pack" variant="primary" />
        <Button variant="secondary" onClick={() => go({ name: 'editor' })}>
          Character editor
        </Button>
      </div>

      <ul className={styles.list} aria-label="Character sets">
        {sets.map((set) => (
          <SetCard
            key={set.id}
            set={set}
            onRemove={() => setRemoving(set)}
            onExportCustom={() => setExportingCustom(true)}
          />
        ))}
      </ul>

      {!sets.some((s) => s.id === CUSTOM_SET_ID) && (
        <p className={styles.fine}>
          Characters you make in the editor, or import one at a time, gather in a set called My characters.
        </p>
      )}

      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.name ?? 'this pack'}?`}
        message={removeMessage(removingCount, removingOwn)}
        confirmLabel="Remove pack"
        tone="danger"
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />

      <PackExportSheet
        open={exportingCustom}
        onClose={() => setExportingCustom(false)}
        title="Export My characters"
        characters={customCharacters}
        defaults={{
          name: profileName ? `${profileName}'s characters` : 'My characters pack',
          author: profileName,
          blurb: 'Characters made in the crushLAB editor.',
          heat,
        }}
      />
    </main>
  )
}

function SetCard({ set, onRemove, onExportCustom }: { set: SetManifest; onRemove: () => void; onExportCustom: () => void }) {
  const go = useNav((s) => s.go)
  const entries = useRoster((s) => s.entries)
  const sets = useRoster((s) => s.sets)
  const setActive = useRoster((s) => s.setActive)
  const activeSets = useSettings((s) => s.settings.activeSets)
  const active = activeSets.includes(set.id)
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const source = setSource(set.id, BUNDLED_SET_IDS)
  const members = selectSetEntries({ sets, entries }, set.id)
  const relations = setRelationLines(set, entries)
  const knows = knowsLine(set, sets)
  const heat = heatText(set.heat)
  const detailsId = `set-${set.id}-details`

  const exportZip = async () => {
    if (source === 'custom') {
      onExportCustom()
      return
    }
    setExporting(true)
    await exportSetZip(
      set,
      members.map((m) => m.character),
      { bundled: source === 'bundled' },
    )
    setExporting(false)
  }

  return (
    <li className={cx(styles.card, active && styles.active)}>
      <div className={styles.cardHead}>
        <h2 className={styles.setName}>{set.name}</h2>
        <Chip tone={source === 'bundled' ? 'brass' : 'default'}>{sourceLabel(source)}</Chip>
      </div>
      {set.author && <p className={styles.author}>By {set.author}</p>}
      <p className={styles.blurb}>{set.blurb}</p>

      <dl className={styles.stats}>
        <div>
          <dt>Characters</dt>
          <dd>{members.length}</dd>
        </div>
        {heat && (
          <div>
            <dt>Recommended heat</dt>
            <dd>{heat}</dd>
          </div>
        )}
      </dl>

      <Toggle
        checked={active}
        onChange={(on) => void setActive(set.id, on)}
        label={
          <>
            In play<span className="visually-hidden">: {set.name}</span>
          </>
        }
        description={active ? 'Their characters are on the hub.' : 'Hidden from the hub. Progress is kept.'}
      />

      <button
        type="button"
        className={styles.disclosure}
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {open ? 'Hide who is in it' : 'Who is in it'}
          <span className="visually-hidden">, {set.name}</span>
        </span>
        <span className={styles.disclosureCount}>{characterCount(members.length)}</span>
      </button>

      {open && (
        <div className={styles.details} id={detailsId}>
          <h3 className={styles.detailsTitle}>Characters</h3>
          <ul className={styles.people}>
            {members.map(({ character: c }) => (
              <li key={c.id}>
                <button type="button" className={styles.person} onClick={() => go({ name: 'profile', id: c.id })}>
                  <span className={styles.personName}>{c.name || c.id}</span>
                  {c.identity && <span className={styles.personIdentity}>{c.identity}</span>}
                  <span className={styles.personJob}>{c.occupation}</span>
                </button>
              </li>
            ))}
          </ul>
          <h3 className={styles.detailsTitle}>Relationships</h3>
          {knows && <p className={styles.fine}>{knows}</p>}
          {relations.length === 0 ? (
            <p className={styles.fine}>No relationships between these characters.</p>
          ) : (
            <ul className={styles.relations}>
              {relations.map((r) => (
                <li key={`${r.a}-${r.b}-${r.kind}`} className={styles.relation}>
                  <p className={styles.relationHead}>
                    <span className="name">{r.aName}</span> and <span className="name">{r.bName}</span>
                    <span className={styles.kind}>{relationKindText(r.kind)}</span>
                  </p>
                  {r.note && <p className={styles.relationNote}>{r.note}</p>}
                  {offSetNote(r, set.id, entries, sets, activeSets) && (
                    <p className={styles.relationNote}>{offSetNote(r, set.id, entries, sets, activeSets)}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={styles.cardActions}>
        <Button size="small" variant="secondary" loading={exporting} disabled={members.length === 0} onClick={() => void exportZip()}>
          Export .zip<span className="visually-hidden">: {set.name}</span>
        </Button>
        {source === 'custom' && (
          <Button size="small" variant="ghost" onClick={() => go({ name: 'editor' })}>
            Edit characters
          </Button>
        )}
        {source === 'imported' && (
          <Button size="small" variant="danger" onClick={onRemove}>
            Remove pack<span className="visually-hidden">: {set.name}</span>
          </Button>
        )}
      </div>
    </li>
  )
}
