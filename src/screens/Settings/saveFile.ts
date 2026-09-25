// Temporary web-only download. ARCHITECTURE routes every export through
// src/platform/files.ts `saveFile(blob, filename, mime)` (share sheet in the APK); switch this
// import over once the platform layer lands.

export async function saveFile(blob: Blob, filename: string, mime: string): Promise<void> {
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
