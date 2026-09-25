// A custom or imported character's own picture for one gallery tier, from the editor: Add image
// (imported into the images table under the tier's slot, where it wins over any other art),
// Replace image and Remove image, with a thumbnail. Bundled characters can't be edited; players
// add their own images for any slot from the gallery's viewer instead.

import { useMemo, useRef, useState } from 'react'
import { importImage, removeImported } from '../../art/generate'
import { useArt } from '../../art/resolve'
import type { ArtSlot } from '../../art/types'
import type { TierNumber } from '../../types'
import { Button } from '../../ui/Button'
import { toast } from '../../ui/toastStore'
import { importErrorText } from '../Gallery/galleryModel'
import styles from './Editor.module.css'

export interface TierImageProps {
  /** The saved character's id: images are stored under it. */
  characterId: string
  tier: TierNumber
  /** The tier's title, for the thumbnail's alt text. */
  title: string
  name: string
}

export function TierImage({ characterId, tier, title, name }: TierImageProps) {
  const slot = useMemo<ArtSlot>(() => ({ kind: 'tier', characterId, tier }), [characterId, tier])
  const { art, loading } = useArt(slot)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'add' | 'remove' | null>(null)
  // Pack art isn't the player's own image: it shows as "No image" here, and an added image wins.
  const mine = art?.source === 'imported' && !art.pack && art.url ? art.url : undefined
  const row = `Tier ${tier}`

  const onFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setBusy('add')
    try {
      await importImage(slot, file)
      toast(`Added the image for tier ${tier}.`, 'success')
    } catch (e) {
      toast(importErrorText(e), 'error', 6000)
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy('remove')
    try {
      await removeImported(slot)
      toast(`Removed the image for tier ${tier}.`, 'success')
    } catch {
      toast("Couldn't remove the image.", 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.tierImage}>
      <div className={styles.thumb}>
        {mine ? (
          <img src={mine} alt={`${name.trim() || 'Your character'}, ${title.trim() || row}`} decoding="async" loading="lazy" />
        ) : (
          <span className={styles.thumbEmpty}>{loading ? '' : 'No image'}</span>
        )}
      </div>
      <div className={styles.thumbActions}>
        <Button
          variant="secondary"
          size="small"
          loading={busy === 'add'}
          disabled={busy === 'remove'}
          aria-label={`${row} ${mine ? 'Replace image' : 'Add image'}`}
          onClick={() => fileRef.current?.click()}
        >
          {mine ? 'Replace image' : 'Add image'}
        </Button>
        {mine && (
          <Button variant="ghost" size="small" loading={busy === 'remove'} disabled={busy === 'add'} aria-label={`${row} Remove image`} onClick={() => void remove()}>
            Remove image
          </Button>
        )}
        <p className={styles.thumbNote}>Shows in the gallery once the tier unlocks.</p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/*"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void onFile(e.target.files)}
      />
    </div>
  )
}
