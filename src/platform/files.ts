// Every export in the app goes through saveFile(). On the web it is an anchor download. In the
// APK the WebView ignores blob downloads, so until the Filesystem + Share plugins are wired in
// (ARCHITECTURE: write to the cache dir, open the share sheet) saving files there is reported as
// unavailable instead of pretending to work.

import { isNative } from './platform'

/** Thrown by saveFile() where this build can't hand a file to the player. */
export class FileSaveUnavailableError extends Error {
  constructor(message = "Saving files isn't available in the Android app yet.") {
    super(message)
    this.name = 'FileSaveUnavailableError'
  }
}

/** False where saveFile() would throw FileSaveUnavailableError (the Android app, for now). */
export function canSaveFiles(): boolean {
  return !isNative() && typeof document !== 'undefined'
}

/** Hand a file to the player: a download on the web. */
export async function saveFile(blob: Blob, filename: string, mime: string): Promise<void> {
  if (!canSaveFiles()) throw new FileSaveUnavailableError()
  const typed = blob.type ? blob : new Blob([blob], { type: mime })
  const url = URL.createObjectURL(typed)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
