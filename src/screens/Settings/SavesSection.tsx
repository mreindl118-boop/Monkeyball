import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createSlot,
  deleteSlot,
  exportSave,
  importSave,
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
import { flashNextLoad, toast } from '../../ui/toastStore'
import { Toggle } from '../../ui/Toggle'
import { canSaveFiles, FileSaveUnavailableError, saveFile } from '../../platform/files'
import styles from './Settings.module.css'

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
  return `Saved ${dateFmt.format(s.createdAt)}. ${plural(s.characters, 'character', 'characters')}, ${plural(s.dates, 'date', 'dates')}.`
}

/** Reload the app on the hub so every store re-reads the replaced data. */
function reloadToHub(message: string) {
  flashNextLoad(message)
  window.location.hash = '#/hub'
  window.location.reload()
}

const EXPORT_UNAVAILABLE =
  "Export isn't available in the Android app yet. Your progress is safe on this phone; save slots below work as usual."

type Pending =
  | { kind: 'import'; file: File }
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
  const fileRef = useRef<HTMLInputElement>(null)

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
      await saveFile(blob, saveFileName(), 'application/json')
      toast('Save file ready.', 'success')
    } catch (e) {
      if (e instanceof FileSaveUnavailableError) toast(EXPORT_UNAVAILABLE, 'info', 6000)
      else toast(`Couldn't export: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setExporting(false)
    }
  }

  const onFile = (files: FileList | null) => {
    const file = files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (file) setPending({ kind: 'import', file })
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
      if (pending.kind === 'import') {
        await importSave(pending.file)
        setPending(null)
        reloadToHub('Save file loaded.')
      } else if (pending.kind === 'restore') {
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
    pending?.kind === 'import'
      ? {
          title: 'Replace everything with this save?',
          message: `Your profile, progress, characters and dates on this device are replaced by "${pending.file.name}". Export first if you want to keep them.`,
          confirmLabel: 'Replace everything',
          tone: 'danger' as const,
        }
      : pending?.kind === 'restore'
        ? {
            title: `Restore "${pending.slot.label}"?`,
            message:
              'Your current progress is replaced by this save. Your connection and settings stay as they are.',
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
          description="Imported and generated art. Makes the file much bigger."
        />
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" loading={exporting} onClick={doExport}>
          Export save file
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          Import save file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => onFile(e.target.files)}
        />
      </div>

      <Divider />

      <Field
        label="Save slots"
        htmlFor="slot-label"
        hint="A snapshot of your progress on this device. Settings and connection aren't part of it."
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
                <p className={styles.slotLabel}>{s.label}</p>
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
