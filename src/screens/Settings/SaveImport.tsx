// "Import save file": pick a save, confirm replacing everything, load it and reload on the hub.
// Used by Settings (Saves) and by onboarding ("I have a save file") so a new phone can pick up a
// game before making a profile.

import { useRef, useState, type ReactNode } from 'react'
import { importSave, SaveFormatError } from '../../db/repo'
import { Button, type ButtonProps } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { toast } from '../../ui/toastStore'
import { reloadToHub, SAVE_ACCEPT } from './saveImportModel'

export function SaveImportButton({
  children = 'Import save file',
  variant = 'secondary',
  size,
  block,
}: {
  children?: ReactNode
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  block?: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)

  const onFile = (files: FileList | null) => {
    const f = files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (f) setFile(f)
  }

  const confirm = async () => {
    if (!file) return
    try {
      await importSave(file)
      setFile(null)
      reloadToHub('Save file loaded.')
    } catch (e) {
      setFile(null)
      toast(e instanceof SaveFormatError ? e.message : `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, 'error', 6000)
    }
  }

  return (
    <>
      <Button variant={variant} {...(size ? { size } : {})} {...(block ? { block } : {})} onClick={() => fileRef.current?.click()}>
        {children}
      </Button>
      <input ref={fileRef} type="file" accept={SAVE_ACCEPT} hidden onChange={(e) => onFile(e.target.files)} />
      <ConfirmDialog
        open={!!file}
        title="Replace everything with this save?"
        message={`Your profile, settings, progress, characters, packs and dates on this device are replaced by "${file?.name ?? ''}". Your API keys stay, and so do your pictures unless the file brings its own. Export first if you want to keep what's here.`}
        confirmLabel="Replace everything"
        tone="danger"
        onConfirm={confirm}
        onCancel={() => setFile(null)}
      />
    </>
  )
}
