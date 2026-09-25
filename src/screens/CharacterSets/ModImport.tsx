import { useRef, useState } from 'react'
import { success } from '../../platform/haptics'
import type { PackReplacement } from '../../store/roster'
import { Button, type ButtonVariant } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Sheet } from '../../ui/Sheet'
import { toast } from '../../ui/toastStore'
import styles from './CharacterSets.module.css'
import { MOD_ACCEPT, importModFile } from './importMod'
import { errorWhere, replaceMessage, type ImportReport } from './setsModel'

interface PendingReplace {
  replacement: PackReplacement
  proceed: () => Promise<ImportReport>
  fileName: string
}

export interface ImportModButtonProps {
  label?: string
  variant?: ButtonVariant
  block?: boolean
  className?: string
}

/**
 * "Import mod file": picks a .json character or .zip pack, imports it, and shows what was left
 * out and why. A clean import is just a toast.
 */
export function ImportModButton({ label = 'Import mod file', variant = 'secondary', block, className }: ImportModButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [pending, setPending] = useState<PendingReplace | null>(null)

  const show = (r: ImportReport) => {
    if (r.saved.length) void success()
    if (r.ok) toast(`${r.title}. ${r.summary}`.trim(), 'success', 5000)
    else setReport(r)
  }
  const failed = (name: string, e: unknown) =>
    toast(`Couldn't import ${name}: ${e instanceof Error ? e.message : String(e)}`, 'error', 6000)

  const onFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setBusy(true)
    try {
      const step = await importModFile(file)
      if (step.kind === 'confirm') setPending({ replacement: step.replacement, proceed: step.proceed, fileName: file.name })
      else show(step.report)
    } catch (e) {
      failed(file.name, e)
    } finally {
      setBusy(false)
    }
  }

  const replace = async () => {
    if (!pending) return
    try {
      const r = await pending.proceed()
      setPending(null)
      show(r)
    } catch (e) {
      setPending(null)
      failed(pending.fileName, e)
    }
  }

  return (
    <>
      <Button variant={variant} block={block} className={className} loading={busy} onClick={() => inputRef.current?.click()}>
        {label}
      </Button>
      <input ref={inputRef} type="file" accept={MOD_ACCEPT} hidden onChange={(e) => void onFile(e.target.files)} />
      <ImportReportSheet report={report} onClose={() => setReport(null)} />
      <ConfirmDialog
        open={!!pending}
        title={`Replace ${pending?.replacement.oldName || 'this pack'}?`}
        message={pending ? replaceMessage(pending.replacement) : undefined}
        confirmLabel="Replace pack"
        cancelLabel="Keep the one I have"
        tone="danger"
        onConfirm={replace}
        onCancel={() => setPending(null)}
      />
    </>
  )
}

export function ImportReportSheet({ report, onClose }: { report: ImportReport | null; onClose: () => void }) {
  return (
    <Sheet
      open={!!report}
      onClose={onClose}
      title={report?.title ?? ''}
      description={report?.summary || undefined}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {report && report.errors.length > 0 && (
        <ul className={styles.problems} aria-label="Problems found">
          {report.errors.map((e, i) => (
            <li key={i} className={styles.problem}>
              <span className={styles.problemWhere}>{errorWhere(e)}</span>
              <span className={styles.problemText}>{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
