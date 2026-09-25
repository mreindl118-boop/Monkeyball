import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APK_ASSET,
  buildFromTag,
  checkForUpdate,
  currentBuild,
  describeUpdate,
  latestReleaseApi,
  newestRelease,
  parseRelease,
  releasesApi,
  UPDATE_REPO,
} from './updates'

/** A GitHub "latest release" body as the CI publishes it. */
function release(n: number, patch: Record<string, unknown> = {}) {
  return {
    tag_name: `build-${n}`,
    name: `crushLAB build ${n}`,
    html_url: `https://github.com/${UPDATE_REPO}/releases/tag/build-${n}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: `crushlab-${n}.apk`,
        browser_download_url: `https://github.com/${UPDATE_REPO}/releases/download/build-${n}/crushlab-${n}.apk`,
      },
      {
        name: APK_ASSET,
        browser_download_url: `https://github.com/${UPDATE_REPO}/releases/download/build-${n}/crushlab.apk`,
      },
    ],
    ...patch,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('release tags', () => {
  it('reads build-<n> tags only', () => {
    expect(buildFromTag('build-12')).toBe(12)
    expect(buildFromTag(' build-7 ')).toBe(7)
    expect(buildFromTag('v1.2.0')).toBeNull()
    expect(buildFromTag('build-')).toBeNull()
    expect(buildFromTag('build-0')).toBeNull()
    expect(buildFromTag(12)).toBeNull()
  })
})

describe('parseRelease', () => {
  it('offers build 12 to build 10, with the fixed-name APK', () => {
    const info = parseRelease(release(12), 10)
    expect(info).toEqual({
      current: 10,
      latest: 12,
      available: true,
      apkUrl: `https://github.com/${UPDATE_REPO}/releases/download/build-12/crushlab.apk`,
      releaseUrl: `https://github.com/${UPDATE_REPO}/releases/tag/build-12`,
    })
  })

  it('says nothing new when this is the newest build (or newer)', () => {
    expect(parseRelease(release(12), 12)?.available).toBe(false)
    expect(parseRelease(release(12), 13)?.available).toBe(false)
  })

  it('never offers an update to a development build (0)', () => {
    const info = parseRelease(release(12), 0)
    expect(info?.available).toBe(false)
    expect(info?.latest).toBe(12)
  })

  it('falls back to crushlab-<n>.apk, and to none', () => {
    const other = release(5, {
      assets: [
        { name: 'notes.txt', browser_download_url: 'https://example.com/notes.txt' },
        { name: 'crushlab-5.apk', browser_download_url: 'https://example.com/crushlab-5.apk' },
      ],
    })
    expect(parseRelease(other, 1)?.apkUrl).toBe('https://example.com/crushlab-5.apk')
    expect(parseRelease(release(5, { assets: [] }), 1)?.apkUrl).toBeUndefined()
    expect(parseRelease(release(5, { assets: [{ name: 'x.apk', browser_download_url: 'http://insecure/x.apk' }] }), 1)?.apkUrl).toBeUndefined()
  })

  it("ignores another app's build release (this repo used to ship one)", () => {
    const foreign = release(40, {
      assets: [
        {
          name: 'rollin-rascals-40.apk',
          browser_download_url: `https://github.com/${UPDATE_REPO}/releases/download/build-40/rollin-rascals-40.apk`,
        },
      ],
    })
    expect(parseRelease(foreign, 10)).toBeNull()
    expect(newestRelease([foreign, release(12), release(11), release(13, { prerelease: true })], 10)).toMatchObject({
      latest: 12,
      available: true,
    })
    expect(newestRelease([foreign], 10)).toBeNull()
    expect(newestRelease({}, 10)).toBeNull()
  })

  it('ignores anything that is not a build release', () => {
    expect(parseRelease(null, 1)).toBeNull()
    expect(parseRelease({ tag_name: 'v2' }, 1)).toBeNull()
    expect(parseRelease(release(9, { draft: true }), 1)).toBeNull()
  })
})

describe('checkForUpdate', () => {
  let urls: string[] = []
  beforeEach(() => {
    urls = []
  })

  function feed(res: () => Response) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        urls.push(url)
        expect(new Headers(init.headers).get('accept')).toBe('application/vnd.github+json')
        return res()
      }),
    )
  }

  it('reads the latest release of the repo', async () => {
    feed(() => new Response(JSON.stringify(release(12)), { headers: { 'content-type': 'application/json' } }))
    const info = await checkForUpdate(UPDATE_REPO, { current: 10 })
    expect(urls).toEqual([latestReleaseApi(UPDATE_REPO)])
    expect(urls[0]).toBe('https://api.github.com/repos/mreindl118-boop/Monkeyball/releases/latest')
    expect(info?.available).toBe(true)
    expect(info?.latest).toBe(12)
  })

  it("looks past a latest release that is another app's", async () => {
    const foreign = release(40, {
      assets: [{ name: 'rollin-rascals-40.apk', browser_download_url: 'https://example.com/rollin-rascals-40.apk' }],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        const body = url.endsWith('/releases/latest') ? foreign : [foreign, release(12), release(11)]
        return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
      }),
    )
    const info = await checkForUpdate(UPDATE_REPO, { current: 10 })
    expect(urls).toEqual([latestReleaseApi(UPDATE_REPO), releasesApi(UPDATE_REPO)])
    expect(info).toMatchObject({ latest: 12, available: true })
    expect(info?.apkUrl).toMatch(/build-12\/crushlab\.apk$/)
  })

  it('resolves null when there is no release, GitHub is rate limiting, or the phone is offline', async () => {
    feed(() => new Response('{"message":"Not Found"}', { status: 404 }))
    expect(await checkForUpdate(UPDATE_REPO, { current: 10 })).toBeNull()
    feed(() => new Response('{"message":"API rate limit exceeded"}', { status: 403 }))
    expect(await checkForUpdate(UPDATE_REPO, { current: 10 })).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await checkForUpdate(UPDATE_REPO, { current: 10 })).toBeNull()
    feed(() => new Response('<html>', { status: 200 }))
    expect(await checkForUpdate(UPDATE_REPO, { current: 10 })).toBeNull()
  })
})

describe('build number and wording', () => {
  it('reads the build number baked in at build time', () => {
    vi.stubEnv('VITE_BUILD_NUMBER', '10')
    expect(currentBuild()).toBe(10)
    vi.stubEnv('VITE_BUILD_NUMBER', '0')
    expect(currentBuild()).toBe(0)
    vi.stubEnv('VITE_BUILD_NUMBER', 'dev')
    expect(currentBuild()).toBe(0)
  })

  it('describes what a check found', () => {
    expect(describeUpdate({ current: 10, latest: 12, available: true })).toBe('Build 12 is ready. You have build 10.')
    expect(describeUpdate({ current: 12, latest: 12, available: false })).toBe('You have the newest build (12).')
    expect(describeUpdate({ current: 0, latest: 12, available: false })).toMatch(/development build/)
  })
})
