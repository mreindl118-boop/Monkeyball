// The recap's unlock reveal: each new tier (and an epilogue's ending art) develops as an instant
// film print, one after another as they come on screen, once per unlock. A tap on a developing
// print shows it at once. Prints that already played on an earlier visit show developed.

import { useEffect, useState } from 'react'
import { useArtJob } from '../../art/generate'
import { PortraitPlaceholder } from '../../art/Portrait'
import { useArt } from '../../art/resolve'
import type { Character } from '../../types'
import { InstantFilm } from '../../ui/InstantFilm'
import type { FilmState } from '../../ui/InstantFilm.model'
import styles from './Recap.module.css'
import type { RevealItem } from './revealModel'

/** How long a print waits for its art before developing the placeholder instead. */
const ART_WAIT_MS = 4000
/** How long it waits while the art is being painted (the unlock started it in the background). */
const PAINT_WAIT_MS = 90_000

export interface RevealFilmProps {
  character: Pick<Character, 'id' | 'name' | 'accent' | 'gallery'>
  item: RevealItem
  state: FilmState
  onDone: (key: string) => void
  className?: string
}

/** One print: the slot's art (or its placeholder) on instant film. */
export function RevealFilm({ character, item, state, onDone, className }: RevealFilmProps) {
  const { art, loading } = useArt(item.slot)
  const job = useArtJob(item.slot)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [gaveUp, setGaveUp] = useState(false)
  const url = art && art.source !== 'placeholder' && art.url && art.url !== failedUrl ? art.url : undefined
  // Art being painted right now is worth waiting for: the print stays undeveloped meanwhile.
  const painting = job.generating && !url
  const ready = (!loading && !painting && (!url || loadedUrl === url)) || gaveUp
  const name = character.name.trim() || character.id

  // Never keep the reveal waiting on a lookup or a slow image.
  useEffect(() => {
    if (ready) return
    const t = setTimeout(() => setGaveUp(true), painting ? PAINT_WAIT_MS : ART_WAIT_MS)
    return () => clearTimeout(t)
  }, [ready, painting])

  return (
    <>
    <InstantFilm title={item.title} kicker={item.kicker} state={state} ready={ready} onDone={() => onDone(item.key)} className={className}>
      {url ? (
        <img
          src={url}
          alt={`${name}, ${item.title}`}
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedUrl(url)}
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <PortraitPlaceholder
          character={character}
          tier={item.slot.kind === 'tier' ? item.slot.tier : undefined}
          caption={{ title: item.title }}
          size="small"
        />
      )}
    </InstantFilm>
    {painting && state === 'developing' && !gaveUp && (
      <p className={styles.note} role="status">
        Still developing: the picture is being painted.
      </p>
    )}
    </>
  )
}
