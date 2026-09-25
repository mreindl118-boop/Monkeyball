import { useCallback, useEffect, useState } from 'react'
import {
  createSlot,
  deleteSlot,
  exportSave,
  listSlots,
  restoreSlot,
  saveFileName,
  SaveFormatError,
  type SlotInfo,
} from '../../db/repo'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Field } from '../../ui/Field'
import { TextInput } from '../../ui/Inputs'
import { Divider } from '../../ui/Panel'
import { toast } from '../../ui/toastStore'
import { Toggle } from '../../ui/Toggle'
import { canSaveFiles, FileSaveUnavailableError, saveFile } from '../../platform/files'
import { isAutosave } from '../Ending/endingModel'
import styles from './Settings.module.css'
import own from './SavesSection.module.css'
import { SaveImportButton } from './SaveImport'
import { reloadToHub } from './saveImportModel'

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function describeSlot(s: SlotInfo): string {
  const when = isAutosave(s.id) ? `Saved automatically ${dateFmt.format(s.createdAt)}` : `Saved ${dateFmt.format(s.createdAt)}`
  return `${when}. ${plural(s.characters, 'character', 'characters')}, ${plural(s.dates, 'date', 'dates')}.`
}


const EXPORT_UNAVAILABLE =
  "This device can't save files from crushLAB. Your progress is safe here; save slots below work as usual."

type Pending =
  | { kind: 'restore'; slot: SlotInfo }
  | { kind: 'delete'; slot: SlotInfo }
  | null

export function SavesSection() {
  const [includeImages, setIncludeImages] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [slots, setSlots] = useState<SlotInfo[] | null>(null)
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<Pending>(null)

  const refresh = useCallback(async () => {
    try {
      setSlots(await listSlots())
    } catch {
      setSlots([])
    }
  }, [])

  useEffect(() => {
    let alive = true
    listSlots()
      .then((s) => {
        if (alive) setSlots(s)
      })
      .catch(() => {
        if (alive) setSlots([])
      })
    return () => {
      alive = false
    }
  }, [])

  const doExport = async () => {
    if (!canSaveFiles()) {
      toast(EXPORT_UNAVAILABLE, 'info', 6000)
      return
    }
    setExporting(true)
    try {
      const blob = await exportSave({ includeImages })
      // Web: a download. Android app: the share sheet (save to Files, Drive, send it...).
      const result = await saveFile(blob, saveFileName(), 'application/json')
      if (result !== 'cancelled') toast('Save file ready.', 'success')
    } catch (e) {
      if (e instanceof FileSaveUnavailableError) toast(EXPORT_UNAVAILABLE, 'info', 6000)
      else toast(`Couldn't export: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setExporting(false)
    }
  }

  const doSlot = async () => {
    setSaving(true)
    try {
      const row = await createSlot(label || `Save ${dateFmt.format(Date.now())}`)
      setLabel('')
      await refresh()
      toast(`Saved "${row.label}".`, 'success')
    } catch (e) {
      toast(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const confirm = async () => {
    if (!pending) return
    try {
      if (pending.kind === 'restore') {
        await restoreSlot(pending.slot.id)
        setPending(null)
        reloadToHub(`Restored "${pending.slot.label}".`)
      } else {
        await deleteSlot(pending.slot.id)
        setPending(null)
        await refresh()
        toast('Save deleted.')
      }
    } catch (e) {
      setPending(null)
      const msg =
        e instanceof SaveFormatError ? e.message : `Something went wrong: ${e instanceof Error ? e.message : String(e)}`
      toast(msg, 'error', 6000)
    }
  }

  const dialog =
    pending?.kind === 'restore'
      ? {
          title: `Restore "${pending.slot.label}"?`,
          message: 'Your current progress is replaced by this save. Your connection and settings stay as they are.',
          confirmLabel: 'Restore',
          tone: 'danger' as const,
        }
      : pending?.kind === 'delete'
        ? {
            title: `Delete "${pending.slot.label}"?`,
            message: 'This save slot is gone for good. Your current game is untouched.',
            confirmLabel: 'Delete save',
            tone: 'danger' as const,
          }
        : null

  return (
    <div className={styles.stack}>
      <div className={styles.toggles}>
        <Toggle
          checked={includeImages}
          onChange={setIncludeImages}
          label="Include images"
          description="Imported, generated and pack art. Makes the file much bigger. Everything else (profile, settings without API keys, progress, characters, packs and dates) is always in it."
        />
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" loading={exporting} onClick={doExport}>
          Export save file
        </Button>
        <SaveImportButton />
      </div>

      <Divider />

      <Field
        label="Save slots"
        htmlFor="slot-label"
        hint="A snapshot of your progress on this device. Settings and connection aren't part of it. The first time someone reaches 100, a save from just before their epilogue is kept here, so you can go back and try for another ending."
      >
        <div className={styles.newSlot}>
          <TextInput
            value={label}
            onChange={setLabel}
            placeholder="Name this save"
            maxLength={60}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doSlot()
            }}
          />
          <Button variant="brass" loading={saving} onClick={doSlot}>
            Save
          </Button>
        </div>
      </Field>

      {slots === null ? null : slots.length === 0 ? (
        <p className={styles.empty}>No saves yet.</p>
      ) : (
        <ul className={styles.slots} aria-label="Save slots">
          {slots.map((s) => (
            <li key={s.id} className={styles.slot}>
              <div>
                <p className={styles.slotLabel}>
                  {s.label}
                  {isAutosave(s.id) && <span className={own.auto}>Automatic</span>}
                </p>
                <p className={styles.slotMeta}>{describeSlot(s)}</p>
              </div>
              <div className={styles.slotActions}>
                <Button size="small" variant="secondary" onClick={() => setPending({ kind: 'restore', slot: s })}>
                  Restore
                </Button>
                <Button size="small" variant="ghost" onClick={() => setPending({ kind: 'delete', slot: s })}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!dialog}
        title={dialog?.title ?? ''}
        message={dialog?.message}
        confirmLabel={dialog?.confirmLabel ?? 'Confirm'}
        tone={dialog?.tone}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
