import { useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Sheet } from './Sheet'

export interface ConfirmDialogProps {
  open: boolean
  title: ReactNode
  message?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** 'danger' for destructive actions. */
  tone?: 'danger' | 'primary'
  /** May return a promise; the button shows a spinner until it settles. */
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  children?: ReactNode
}

/** A confirmation sheet. Focus starts on Cancel so a stray Enter never destroys anything. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={busy ? () => {} : onCancel}
      title={title}
      description={message}
      role="alertdialog"
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Sheet>
  )
}
