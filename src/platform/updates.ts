// Update check for the Android app (ARCHITECTURE, Android first). CI publishes every build as a
// GitHub release tagged build-<n> with crushlab.apk attached, and bakes the same <n> into the web
// build (import.meta.env.VITE_BUILD_NUMBER, 0 for local builds). The APK compares the two and
// offers the newer APK. The request is a plain GET of the public release feed; it sends nothing
// about the player. The web app and PWA update themselves through the service worker instead.

import { getText } from './http'
import { isNative } from './platform'

/** The GitHub repo whose releases are the update feed. */
export const UPDATE_REPO = 'mreindl118-boop/Monkeyball'

/** The APK every release carries under a fixed name (crushlab-<n>.apk is the same file). */
export const APK_ASSET = 'crushlab.apk'

export interface UpdateInfo {
  /** This build's number (0 for a local or development build). */
  current: number
  /** The newest published build number. */
  latest: number
  /** True when `latest` is newer than `current` (never for a development build). */
  available: boolean
  /** Direct download of the newest APK, when the release has one. */
  apkUrl?: string
  /** The release page on GitHub. */
  releaseUrl?: string
}

/** This build's number, from the build-time define (0 when missing or malformed). */
export function currentBuild(): number {
  const raw: unknown = import.meta.env.VITE_BUILD_NUMBER
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** The build number in a release tag ("build-12" -> 12), or null for any other tag. */
export function buildFromTag(tag: unknown): number | null {
  if (typeof tag !== 'string') return null
  const m = /^build-(\d+)$/.exec(tag.trim())
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function isHttpsUrl(u: unknown): u is string {
  if (typeof u !== 'string') return false
  try {
    return new URL(u).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Read a GitHub "latest release" object. Null when it isn't a build-<n> release. The APK is the
 * asset named crushlab.apk, else the first .apk asset.
 */
export function parseRelease(release: unknown, current: number): UpdateInfo | null {
  if (!release || typeof release !== 'object') return null
  const r = release as { tag_name?: unknown; html_url?: unknown; assets?: unknown; draft?: unknown; prerelease?: unknown }
  if (r.draft === true) return null
  const latest = buildFromTag(r.tag_name)
  if (latest === null) return null
  const assets = Array.isArray(r.assets) ? (r.assets as { name?: unknown; browser_download_url?: unknown }[]) : []
  const apks = assets.filter(
    (a) => a && typeof a.name === 'string' && /\.apk$/i.test(a.name) && isHttpsUrl(a.browser_download_url),
  )
  const apk = apks.find((a) => a.name === APK_ASSET) ?? apks[0]
  const info: UpdateInfo = { current, latest, available: current > 0 && latest > current }
  if (apk) info.apkUrl = apk.browser_download_url as string
  if (isHttpsUrl(r.html_url)) info.releaseUrl = r.html_url
  return info
}

/** https://api.github.com/repos/<repo>/releases/latest */
export function latestReleaseApi(repo: string): string {
  return `https://api.github.com/repos/${repo}/releases/latest`
}

/** The release page for people (always shows the newest build). */
export function latestReleasePage(repo = UPDATE_REPO): string {
  return `https://github.com/${repo}/releases/latest`
}

export interface CheckOptions {
  /** Defaults to this build's number. */
  current?: number
  signal?: AbortSignal
  /** Default 15 s. */
  timeoutMs?: number
}

/**
 * Ask GitHub for the newest build. Resolves null when the feed can't be read (offline, rate
 * limited, no build-<n> release yet); never throws.
 */
export async function checkForUpdate(repo = UPDATE_REPO, opts: CheckOptions = {}): Promise<UpdateInfo | null> {
  const current = opts.current ?? currentBuild()
  try {
    const res = await getText(latestReleaseApi(repo), {
      headers: { Accept: 'application/vnd.github+json' },
      timeoutMs: opts.timeoutMs ?? 15_000,
      signal: opts.signal,
    })
    if (res.status < 200 || res.status >= 300) return null
    return parseRelease(JSON.parse(res.text), current)
  } catch {
    return null
  }
}

/**
 * Open a link outside the app. In the APK a top-level navigation to another site is handed to
 * Android (Capacitor opens it with the system browser, which downloads an APK and offers to
 * install it); on the web it opens a new tab.
 */
export function openExternal(url: string): void {
  if (typeof window === 'undefined') return
  if (isNative()) {
    window.location.assign(url)
    return
  }
  window.open(url, '_blank', 'noopener')
}

/**
 * Web and PWA: ask the service worker to look for a new version now. The new version is used the
 * next time crushLAB opens. Resolves false when there is no service worker (dev, private mode).
 */
export async function refreshWebApp(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return false
    await reg.update()
    return true
  } catch {
    return false
  }
}
