// Update check for the Android app (ARCHITECTURE, Android first). CI publishes every build as a
// GitHub release tagged build-<n> with crushlab.apk attached, and bakes the same <n> into the web
// build (import.meta.env.VITE_BUILD_NUMBER, 0 for local builds). The APK compares the two and
// offers the newer APK. The request is a plain GET of the public release feed; it sends nothing
// about the player. The web app and PWA update themselves through the service worker instead.

import { fetchWithFallback } from './http'
import { isNative } from './platform'

/** The GitHub repo whose releases are the update feed. */
export const UPDATE_REPO = 'mreindl118-boop/Monkeyball'

/** The APK every release carries under a fixed name (crushlab-<n>.apk is the same file). */
export const APK_ASSET = 'crushlab.apk'

/** crushlab.apk or crushlab-<n>.apk. The same repo once published another game's build-<n> APKs. */
function isCrushlabApk(name: string): boolean {
  return /^crushlab(-\d+)?\.apk$/i.test(name)
}

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
 * Read a GitHub release object. Null when it isn't a crushLAB build-<n> release (a draft, another
 * tag, or a release whose APKs are all another app's). The APK is the asset named crushlab.apk,
 * else crushlab-<n>.apk.
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
  const ours = apks.filter((a) => isCrushlabApk(a.name as string))
  if (apks.length > 0 && ours.length === 0) return null
  const apk = ours.find((a) => a.name === APK_ASSET) ?? ours[0]
  const info: UpdateInfo = { current, latest, available: current > 0 && latest > current }
  if (apk) info.apkUrl = apk.browser_download_url as string
  if (isHttpsUrl(r.html_url)) info.releaseUrl = r.html_url
  return info
}

/** What a check found, in one or two sentences (Settings shows it). */
export function describeUpdate(info: UpdateInfo): string {
  if (info.current === 0) {
    return `This is a development build, so there's nothing to compare it with. The newest release is build ${info.latest}.`
  }
  if (info.available) return `Build ${info.latest} is ready. You have build ${info.current}.`
  return `You have the newest build (${info.current}).`
}

/** https://api.github.com/repos/<repo>/releases/latest */
export function latestReleaseApi(repo: string): string {
  return `https://api.github.com/repos/${repo}/releases/latest`
}

/** https://api.github.com/repos/<repo>/releases (newest first), for when "latest" isn't ours. */
export function releasesApi(repo: string, perPage = 20): string {
  return `https://api.github.com/repos/${repo}/releases?per_page=${perPage}`
}

/** The newest crushLAB release in a GitHub release list, or null. */
export function newestRelease(list: unknown, current: number): UpdateInfo | null {
  if (!Array.isArray(list)) return null
  let best: UpdateInfo | null = null
  for (const item of list) {
    if (item && typeof item === 'object' && (item as { prerelease?: unknown }).prerelease === true) continue
    const info = parseRelease(item, current)
    if (info && (!best || info.latest > best.latest)) best = info
  }
  return best
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
  const timeoutMs = opts.timeoutMs ?? 15_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onOuter = () => controller.abort()
  opts.signal?.addEventListener('abort', onOuter, { once: true })
  const get = async (url: string): Promise<unknown> => {
    const res = await fetchWithFallback(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
      timeoutMs,
    })
    return res.ok ? (JSON.parse(await res.text()) as unknown) : undefined
  }
  try {
    const latest = await get(latestReleaseApi(repo))
    if (latest === undefined) return null
    const info = parseRelease(latest, current)
    if (info) return info
    // "Latest" can be another app's build (this repo used to ship one); look further back.
    return newestRelease(await get(releasesApi(repo)), current)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onOuter)
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
