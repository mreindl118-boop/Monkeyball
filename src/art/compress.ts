// Making stored pictures smaller (Phase 5). Pure apart from the browser's image decoding: where
// createImageBitmap or OffscreenCanvas is missing (tests, old WebViews) the picture is kept as it is.
//
// Two sizes are kept per stored picture (StoredImage): the picture itself, at most MAX_SIDE on its
// longest side, and a thumbnail at most THUMB_SIDE, which coasters, the profile strip and gallery
// tiles show. A mid-range phone then decodes a few hundred kilobytes per tile instead of several
// megabytes; only the viewer, the recap's print and the editor decode the full picture.

/** Longest side kept when a picture is stored (larger ones are scaled down where the browser can). */
export const MAX_SIDE = 2048

/** Longest side of a thumbnail: sharp on a 3x phone for a gallery tile, a fraction of the memory. */
export const THUMB_SIDE = 640

/** Scale a picture to fit `maxSide` and encode it as WebP; null when the browser can't. */
async function reencode(blob: Blob, maxSide: number, onlyWhenLarger: boolean): Promise<{ out: Blob; scaled: boolean } | null> {
  if (blob.type === 'image/gif' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null
  try {
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height, 1))
    if (onlyWhenLarger && scale >= 1) {
      bmp.close()
      return null
    }
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bmp.close()
      return null
    }
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
    return out.type === 'image/webp' ? { out, scaled: scale < 1 } : null
  } catch {
    return null
  }
}

/**
 * A picture made smaller: scaled to `maxSide` and re-encoded as WebP when the browser can
 * (OffscreenCanvas), keeping the original when that isn't smaller. GIFs stay as they are.
 */
export async function compressImage(blob: Blob, maxSide = MAX_SIDE): Promise<Blob> {
  const r = await reencode(blob, maxSide, false)
  return r && (r.out.size < blob.size || r.scaled) ? r.out : blob
}

/**
 * A thumbnail of a stored picture (longest side THUMB_SIDE), or undefined when the picture is
 * already that small, is a GIF, or the browser can't make one: the picture itself serves then.
 */
export async function makeThumbnail(blob: Blob): Promise<Blob | undefined> {
  const r = await reencode(blob, THUMB_SIDE, true)
  return r ? r.out : undefined
}
