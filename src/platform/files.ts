// Every export in the app goes through saveFile(). On the web it is an anchor download. In the
// APK the WebView ignores blob downloads, so the file is written to the app's cache directory
// with @capacitor/filesystem (in pieces of WRITE_CHUNK_BYTES) and handed to the Android share
// sheet with @capacitor/share, where the player picks Files, Drive, a messenger and so on
// (ARCHITECTURE, Android first).

import { isNative } from './platform'

/** Thrown by saveFile() where this build can't hand a file to the player. */
export class FileSaveUnavailableError extends Error {
  constructor(message = "This device can't save files from crushLAB.") {
    super(message)
    this.name = 'FileSaveUnavailableError'
  }
}

/**
 * How a save ended: downloaded by the browser, handed to another app through the share sheet,
 * or the player closed the share sheet without picking anything.
 */
export type SaveFileResult = 'downloaded' | 'shared' | 'cancelled'

/** False where saveFile() would throw FileSaveUnavailableError (no DOM and no native layer). */
export function canSaveFiles(): boolean {
  return isNative() || typeof document !== 'undefined'
}

/** A file name that is safe on every platform: no path separators or control characters. */
export function safeFileName(name: string): string {
  const swapped = Array.from(name, (c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '-' : c)).join('')
  const cleaned = swapped.replace(/-{2,}/g, '-').replace(/^[.\s-]+/, '').trim()
  return cleaned.slice(0, 120) || 'crushlab-file'
}

/** Text formats go to the native layer as UTF-8; everything else as base64. */
function isTextType(mime: string): boolean {
  return /^text\/|[/+](json|xml|csv)\b|^application\/(json|xml|javascript)\b/i.test(mime)
}

/** Base64 of a blob's bytes, in chunks so large exports don't overflow the call stack. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function isCancel(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /cancel/i.test(msg)
}

function isUnimplemented(e: unknown): boolean {
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined
  const msg = e instanceof Error ? e.message : String(e)
  return code === 'UNIMPLEMENTED' || code === 'UNAVAILABLE' || /not implemented/i.test(msg)
}

/**
 * Bytes per write across the native bridge. The bridge JSON-encodes every call, so a large export
 * sent in one piece exists several times over in the WebView; mid-range phones can run out of
 * memory on a save with images. A multiple of 3, so each base64 piece stands on its own.
 */
export const WRITE_CHUNK_BYTES = 3 * 512 * 1024

/** The blob as the pieces written to disk: UTF-8 text, or base64 of whole bytes. */
async function* chunksOf(blob: Blob, text: boolean, size = WRITE_CHUNK_BYTES): AsyncGenerator<string> {
  // Text is decoded slice by slice; the decoder carries a character split across two slices.
  const decoder = text ? new TextDecoder() : null
  for (let start = 0; start < blob.size; start += size) {
    const part = blob.slice(start, start + size)
    if (decoder) {
      const last = start + size >= blob.size
      yield decoder.decode(new Uint8Array(await part.arrayBuffer()), { stream: !last })
    } else {
      yield await blobToBase64(part)
    }
  }
}

/** Android: write to the cache dir in pieces, then open the share sheet on it. */
async function shareNative(blob: Blob, filename: string, mime: string): Promise<SaveFileResult> {
  let uri = ''
  try {
    const { Directory, Encoding, Filesystem } = await import('@capacitor/filesystem')
    const text = isTextType(mime)
    const encoding = text ? { encoding: Encoding.UTF8 } : {}
    const path = `exports/${filename}`
    // Earlier exports have been shared already; don't let them pile up in the cache.
    try {
      await Filesystem.rmdir({ path: 'exports', directory: Directory.Cache, recursive: true })
    } catch {
      // Nothing there yet.
    }
    let written = false
    for await (const data of chunksOf(blob, text)) {
      if (!written) {
        uri = (await Filesystem.writeFile({ path, directory: Directory.Cache, recursive: true, data, ...encoding })).uri
        written = true
      } else {
        await Filesystem.appendFile({ path, directory: Directory.Cache, data, ...encoding })
      }
    }
    if (!written) {
      uri = (await Filesystem.writeFile({ path, directory: Directory.Cache, recursive: true, data: '', ...encoding })).uri
    }
  } catch (e) {
    if (isUnimplemented(e)) throw new FileSaveUnavailableError()
    throw e
  }
  try {
    const { Share } = await import('@capacitor/share')
    await Share.share({ title: filename, files: [uri], dialogTitle: `Save ${filename}` })
    return 'shared'
  } catch (e) {
    if (isCancel(e)) return 'cancelled'
    if (isUnimplemented(e)) throw new FileSaveUnavailableError()
    throw e
  }
}

/** Web: a plain anchor download. */
function downloadWeb(blob: Blob, filename: string, mime: string): SaveFileResult {
  const typed = blob.type ? blob : new Blob([blob], { type: mime })
  const url = URL.createObjectURL(typed)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return 'downloaded'
}

/**
 * Hand a file to the player: a download on the web, the share sheet in the Android app.
 * Resolves 'cancelled' when the player dismisses the share sheet (not an error).
 */
export async function saveFile(blob: Blob, filename: string, mime: string): Promise<SaveFileResult> {
  const name = safeFileName(filename)
  if (isNative()) return shareNative(blob, name, mime)
  if (typeof document === 'undefined') throw new FileSaveUnavailableError()
  return downloadWeb(blob, name, mime)
}
