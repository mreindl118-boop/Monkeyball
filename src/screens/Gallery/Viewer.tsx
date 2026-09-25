// The full-screen gallery viewer: one picture at a time, swipe (or Previous and Next) between the
// unlocked ones, and the picture's actions: Favorite, Save image, Use my own image, Remove my
// image, and Regenerate for generated art (the new picture shows next to the current one and
// nothing changes until "Keep new"). Registers as an overlay, so the Android back button and
// Escape close it (or step out of a comparison first).
//
// Only the picture on screen is loaded; neighbours load when they're swiped to.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { acceptCandidate, generateArt, generateCandidate, importImage, removeImported, setFavorite, useArtJob } from '../../art/generate'
import { PortraitPlaceholder } from '../../art/Portrait'
import { portraitAccent } from '../../art/Portrait.model'
import { providerFor } from '../../art/providers'
import { useArt } from '../../art/resolve'
import type { ArtSlot, ResolvedArt } from '../../art/types'
import { FileSaveUnavailableError, saveFile } from '../../platform/files'
import { tap } from '../../platform/haptics'
import { isTopOverlay, pushOverlay } from '../../platform/overlays'
import { useSettings } from '../../store/settings'
import type { Character } from '../../types'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { cx } from '../../ui/cx'
import { Kiss } from '../../ui/Kiss'
import { toast } from '../../ui/toastStore'
import { dragOffset, firstName, imageFileName, importErrorText, stepIndex, swipeDirection } from './galleryModel'
import styles from './Viewer.module.css'

export interface ViewerItem {
  slot: ArtSlot
  /** slotKey(slot). */
  key: string
  /** Whose gallery the picture is in (accent, name, placeholder). */
  character: Character
  title: string
  /** "Tier 3", "Ending", "With Kai". */
  kicker: string
  scene: string
}

export interface ViewerProps {
  items: readonly ViewerItem[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
  /** Favorites known before the viewer resolved the picture itself. */
  favorites: ReadonlySet<string>
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The viewer, over everything, while open. */
export function Viewer(props: ViewerProps) {
  if (typeof document === 'undefined' || !props.items[props.index]) return null
  return createPortal(<ViewerInner {...props} />, document.body)
}

type Mode = 'view' | 'generating' | 'compare'

interface Candidate {
  blob: Blob
  prompt: string
  seed: number
  url: string
}

function HeartKiss({ on }: { on: boolean }) {
  return <Kiss filled={on} className={cx(styles.kiss, on && styles.kissOn)} />
}

function ViewerInner({ items, index, onIndex, onClose, favorites }: ViewerProps) {
  const item = items[index]
  const { character, slot, key } = item
  const name = character.name.trim() || character.id
  const first = firstName(name)
  const settings = useSettings((s) => s.settings)
  const provider = useMemo(() => providerFor(settings), [settings])
  const canGenerate = !!provider
  const { art, loading } = useArt(slot)
  const job = useArtJob(slot)
  const rootRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [mode, setMode] = useState<Mode>('view')
  const [working, setWorking] = useState('')
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [busy, setBusy] = useState<'favorite' | 'save' | 'import' | 'remove' | 'keep' | 'generate' | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [favs, setFavs] = useState<Record<string, boolean>>({})
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; dx: number } | null>(null)
  const favorite = favs[key] ?? art?.favorite ?? favorites.has(key)
  const hasImage = !!art && art.source !== 'placeholder' && !!art.url
  const count = items.length

  // Leaving a picture (or the viewer) drops a comparison in progress.
  const dropCandidate = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setCandidate((c) => {
      if (c) URL.revokeObjectURL(c.url)
      return null
    })
    setMode('view')
  }
  const dropRef = useRef(dropCandidate)
  useEffect(() => {
    dropRef.current = dropCandidate
  })
  useEffect(() => () => dropRef.current(), [key])

  // Back and Escape step out of a comparison or a generation first, then close the viewer.
  const backRef = useRef(() => {})
  useEffect(() => {
    backRef.current = () => {
      if (confirmRemove) return
      if (mode !== 'view') dropCandidate()
      else onClose()
    }
  })

  // Overlay, scroll lock, focus in and back out.
  useEffect(() => {
    const close = () => backRef.current()
    const unregister = pushOverlay(close)
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    rootRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopOverlay(close)) {
        e.preventDefault()
        close()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      unregister()
      document.body.style.overflow = overflow
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])

  const go = (dir: -1 | 1) => {
    const next = stepIndex(index, count, dir)
    if (next !== index) onIndex(next)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab' && rootRef.current) {
      const els = Array.from(rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
      if (!els.length) return
      const firstEl = els[0]
      const lastEl = els[els.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
      return
    }
    if (mode !== 'view' || confirmRemove) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(1)
    }
  }

  // Swipe: the picture follows the finger sideways; a long enough swipe moves to the next one.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== 'view' || count < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return
    setDrag({ id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0 })
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.id) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (drag.dx === 0 && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      setDrag(null)
      return
    }
    // Keep the drag once it's clearly sideways, even if the finger leaves the picture.
    const el = e.currentTarget
    if (Math.abs(dx) > 6 && typeof el.setPointerCapture === 'function' && !el.hasPointerCapture?.(e.pointerId)) {
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // The pointer is already gone.
      }
    }
    setDrag({ ...drag, dx })
  }
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!drag || e.pointerId !== drag.id) return
    const dir = cancelled ? 0 : swipeDirection(e.clientX - drag.x, e.clientY - drag.y, e.currentTarget.clientWidth)
    setDrag(null)
    if (dir) go(dir)
  }

  const toggleFavorite = async () => {
    const on = !favorite
    setFavs((f) => ({ ...f, [key]: on }))
    setBusy('favorite')
    void tap()
    try {
      await setFavorite(slot, on)
    } catch {
      setFavs((f) => ({ ...f, [key]: !on }))
      toast("Couldn't save that favorite.", 'error')
    } finally {
      setBusy(null)
    }
  }

  const saveImage = async () => {
    if (!art?.url) return
    setBusy('save')
    try {
      const blob = await (await fetch(art.url)).blob()
      const type = blob.type || 'image/png'
      const result = await saveFile(blob, imageFileName(name, item.title, type), type)
      if (result === 'downloaded') toast('Image saved.', 'success')
    } catch (e) {
      if (e instanceof FileSaveUnavailableError) toast("This device can't save files from crushLAB.", 'info', 6000)
      else toast("Couldn't save the image.", 'error')
    } finally {
      setBusy(null)
    }
  }

  const onFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setBusy('import')
    try {
      await importImage(slot, file)
      toast(`Your image is in ${first}'s gallery now.`, 'success')
    } catch (e) {
      toast(importErrorText(e), 'error', 6000)
    } finally {
      setBusy(null)
    }
  }

  const removeMine = async () => {
    setBusy('remove')
    try {
      await removeImported(slot)
      toast('Your image is removed.', 'success')
    } catch {
      toast("Couldn't remove the image.", 'error')
    } finally {
      setBusy(null)
      setConfirmRemove(false)
    }
  }

  const regenerate = async () => {
    dropCandidate()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setWorking('Painting a new one')
    setMode('generating')
    try {
      const c = await generateCandidate(slot, ctrl.signal)
      if (ctrl.signal.aborted) return
      setCandidate({ ...c, url: URL.createObjectURL(c.blob) })
      setMode('compare')
    } catch (e) {
      if (ctrl.signal.aborted) return
      setMode('view')
      toast(`Couldn't paint a new one: ${e instanceof Error ? e.message : String(e)}`, 'error', 8000)
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
    }
  }

  const generateNow = async () => {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy('generate')
    setWorking('Painting it')
    setMode('generating')
    try {
      const img = await generateArt(slot, { signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      if (!img) toast('Image generation is off or not set up.', 'error')
    } catch (e) {
      if (!ctrl.signal.aborted) toast(`Couldn't paint it: ${e instanceof Error ? e.message : String(e)}`, 'error', 8000)
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
      setBusy(null)
      setMode('view')
    }
  }

  const keepNew = async () => {
    if (!candidate) return
    setBusy('keep')
    try {
      await acceptCandidate(slot, { blob: candidate.blob, prompt: candidate.prompt, seed: candidate.seed })
      dropCandidate()
      toast('Kept the new one.', 'success')
    } catch {
      toast("Couldn't keep the new one. Storage may be full.", 'error')
    } finally {
      setBusy(null)
    }
  }

  const style = { '--accent': portraitAccent(character.accent) } as CSSProperties
  const offset = drag ? dragOffset(drag.dx, index, count) : 0

  return (
    <div className={styles.backdrop} style={style}>
      <div
        ref={rootRef}
        className={styles.viewer}
        role="dialog"
        aria-modal="true"
        aria-label={`${name}, ${item.title}`}
        onKeyDown={onKeyDown}
      >
        <header className={styles.top}>
          <Button variant="ghost" className={styles.close} onClick={() => backRef.current()} data-autofocus>
            {mode === 'view' ? 'Close' : mode === 'generating' ? 'Stop' : 'Back'}
          </Button>
          <p className={styles.count} aria-live="polite">
            {count > 1 ? `${index + 1} of ${count}` : ''}
          </p>
        </header>

        {mode === 'compare' && candidate ? (
          <section className={styles.compare} aria-label="Compare the new picture with the current one">
            <figure className={styles.side}>
              <div className={styles.sideArt}>
                <ArtPicture art={art} character={character} slot={slot} title={item.title} />
              </div>
              <figcaption className={styles.sideLabel}>Current</figcaption>
            </figure>
            <figure className={styles.side}>
              <div className={styles.sideArt}>
                <img className={styles.img} src={candidate.url} alt={`${name}, ${item.title}, the new picture`} decoding="async" onLoad={fitToShape} />
              </div>
              <figcaption className={cx(styles.sideLabel, styles.newLabel)}>New</figcaption>
            </figure>
          </section>
        ) : (
          <div
            className={cx(styles.stage, drag && styles.dragging)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endDrag(e)}
            onPointerCancel={(e) => endDrag(e, true)}
          >
            <div className={styles.frame} style={offset ? { transform: `translateX(${offset}px)` } : undefined}>
              <ArtPicture art={loading ? null : art} character={character} slot={slot} title={item.title} key={key} />
              {(mode === 'generating' || (mode === 'view' && job.generating)) && (
                <div className={styles.working} role="status">
                  <span className={styles.spinner} aria-hidden="true" />
                  {mode === 'generating' ? working : 'Painting it'}
                </div>
              )}
            </div>
          </div>
        )}

        <div className={styles.caption}>
          <p className={styles.kicker}>
            {item.kicker}
            {art && art.source !== 'placeholder' && <span className={styles.source}>{sourceText(art.source)}</span>}
          </p>
          <h2 className={styles.title}>{item.title}</h2>
          {item.scene && <p className={styles.scene}>{item.scene}</p>}
          {mode === 'view' && !job.generating && job.error && art?.source !== 'imported' && (
            <p className={styles.jobError} role="note">
              Painting didn't work: {job.error}
            </p>
          )}
        </div>

        {mode === 'compare' ? (
          <div className={styles.decide}>
            <Button variant="primary" loading={busy === 'keep'} onClick={() => void keepNew()}>
              Keep new
            </Button>
            <Button variant="secondary" disabled={busy === 'keep'} onClick={dropCandidate}>
              Keep current
            </Button>
          </div>
        ) : (
          <>
            {count > 1 && (
              <div className={styles.nav}>
                <Button variant="ghost" disabled={index <= 0 || mode !== 'view'} onClick={() => go(-1)}>
                  Previous
                </Button>
                <Button variant="ghost" disabled={index >= count - 1 || mode !== 'view'} onClick={() => go(1)}>
                  Next
                </Button>
              </div>
            )}
            <div className={styles.actions}>
              <Button
                variant="secondary"
                className={cx(styles.fav, favorite && styles.favOn)}
                aria-pressed={favorite}
                icon={<HeartKiss on={favorite} />}
                disabled={mode !== 'view'}
                onClick={() => void toggleFavorite()}
              >
                Favorite
              </Button>
              {hasImage && (
                <Button variant="secondary" loading={busy === 'save'} disabled={mode !== 'view'} onClick={() => void saveImage()}>
                  Save image
                </Button>
              )}
              <Button
                variant="secondary"
                loading={busy === 'import'}
                disabled={mode !== 'view'}
                onClick={() => fileRef.current?.click()}
              >
                Use my own image
              </Button>
              {art?.source === 'imported' && (
                <Button variant="ghost" disabled={mode !== 'view' || busy !== null} onClick={() => setConfirmRemove(true)}>
                  Remove my image
                </Button>
              )}
              {art?.source === 'generated' && canGenerate && (
                <Button variant="brass" disabled={mode !== 'view' || busy !== null || job.generating} onClick={() => void regenerate()}>
                  Regenerate
                </Button>
              )}
              {art?.source === 'placeholder' && canGenerate && !loading && (
                <Button variant="brass" loading={busy === 'generate'} disabled={mode !== 'view' || job.generating} onClick={() => void generateNow()}>
                  Generate art
                </Button>
              )}
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
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title="Remove your image?"
        message={`${first}'s ${item.title.charAt(0).toLowerCase()}${item.title.slice(1)} goes back to the art crushLAB has for it. Your file stays wherever you picked it from.`}
        confirmLabel="Remove"
        tone="danger"
        onConfirm={removeMine}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  )
}

/**
 * Tell the stylesheet the picture's shape (--ar, width over height) once it has loaded, so it
 * scales up or down to fit its box whole, with its ring hugging it (Viewer.module.css).
 */
function fitToShape(e: SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget
  if (img.naturalWidth > 0 && img.naturalHeight > 0) img.style.setProperty('--ar', String(img.naturalWidth / img.naturalHeight))
}

function sourceText(source: ResolvedArt['source']): string {
  switch (source) {
    case 'imported':
      return 'Your image'
    case 'generated':
      return 'Generated'
    case 'bundled':
      return 'Comes with the set'
    default:
      return ''
  }
}

/** The picture itself: the image, or the placeholder card when there's none (or it won't load). */
function ArtPicture({ art, character, slot, title }: { art: ResolvedArt | null; character: Character; slot: ArtSlot; title: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const name = character.name.trim() || character.id
  const url = art && art.source !== 'placeholder' && art.url !== failed ? art.url : undefined
  if (url) {
    return (
      <img
        className={styles.img}
        src={url}
        alt={`${name}, ${title}`}
        decoding="async"
        draggable={false}
        onLoad={fitToShape}
        onError={() => setFailed(url)}
      />
    )
  }
  return (
    <PortraitPlaceholder
      character={character}
      tier={slot.kind === 'tier' ? slot.tier : undefined}
      caption={{ title }}
      size="small"
      className={styles.placeholder}
    />
  )
}
