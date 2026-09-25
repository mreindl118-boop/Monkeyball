// A picture to open in the viewer when a character's gallery opens (the profile's strip hands the
// tapped slot over this way; the route itself only names the character).

let pending: string | null = null

/** The next #/gallery/:id screen opens its viewer on this slot key. */
export function openGalleryAt(key: string | null): void {
  pending = key
}

/** The slot key handed over (read it while rendering; clear it once the screen is up). */
export function peekGalleryOpenAt(): string | null {
  return pending
}

export function clearGalleryOpenAt(): void {
  pending = null
}
