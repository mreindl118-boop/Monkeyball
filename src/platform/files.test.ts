// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({
  native: false,
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  rmdir: vi.fn(),
  share: vi.fn(),
}))

vi.mock('./platform', () => ({
  isNative: () => env.native,
  platformName: () => (env.native ? 'android' : 'web'),
  isAndroidApp: () => env.native,
  hasPlugin: () => env.native,
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: env.writeFile, appendFile: env.appendFile, rmdir: env.rmdir },
}))

vi.mock('@capacitor/share', () => ({
  Share: { share: env.share },
}))

import { blobToBase64, canSaveFiles, FileSaveUnavailableError, safeFileName, saveFile, WRITE_CHUNK_BYTES } from './files'

beforeEach(() => {
  env.native = false
  env.writeFile.mockReset()
  env.appendFile.mockReset()
  env.rmdir.mockReset()
  env.share.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('saveFile on the web', () => {
  it('downloads through an anchor with the file name', async () => {
    const created = vi.fn(() => 'blob:crushlab/1')
    const revoked = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }))
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })

    const result = await saveFile(new Blob(['{"a":1}']), 'crushlab-save.json', 'application/json')

    expect(result).toBe('downloaded')
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('crushlab-save.json')
    expect(clicked[0].href).toBe('blob:crushlab/1')
    // The anchor doesn't linger in the page.
    expect(document.querySelector('a[download]')).toBeNull()
    // The blob gets the requested type when it had none.
    const blob = (created.mock.calls[0] as unknown as [Blob])[0]
    expect(blob.type).toBe('application/json')
    expect(env.writeFile).not.toHaveBeenCalled()
  })

  it('can save wherever there is a page', () => {
    expect(canSaveFiles()).toBe(true)
  })
})

describe('saveFile in the Android app', () => {
  beforeEach(() => {
    env.native = true
    env.writeFile.mockResolvedValue({ uri: 'file:///data/user/0/app.crushlab.game/cache/exports/save.json' })
    env.share.mockResolvedValue({ activityType: 'com.google.android.documentsui' })
  })

  it('writes JSON to the cache as UTF-8 and opens the share sheet on it', async () => {
    const result = await saveFile(new Blob(['{"a":1}']), 'save.json', 'application/json')
    expect(result).toBe('shared')
    expect(env.writeFile).toHaveBeenCalledWith({
      path: 'exports/save.json',
      directory: 'CACHE',
      recursive: true,
      data: '{"a":1}',
      encoding: 'utf8',
    })
    expect(env.share).toHaveBeenCalledWith(
      expect.objectContaining({ files: ['file:///data/user/0/app.crushlab.game/cache/exports/save.json'] }),
    )
  })

  it('writes binary files as base64', async () => {
    await saveFile(new Blob([new Uint8Array([80, 75, 3, 4])]), 'pack.zip', 'application/zip')
    const opts = env.writeFile.mock.calls[0][0] as { data: string; encoding?: string }
    expect(opts.data).toBe('UEsDBA==')
    expect(opts.encoding).toBeUndefined()
  })

  it('clears earlier exports, then writes a large binary file in base64 pieces', async () => {
    env.rmdir.mockRejectedValue(new Error('Directory does not exist'))
    const size = WRITE_CHUNK_BYTES * 2 + 10
    const bytes = new Uint8Array(size).map((_, i) => (i * 7) % 256)
    await saveFile(new Blob([bytes]), 'save-with-images.json.zip', 'application/zip')
    expect(env.rmdir).toHaveBeenCalledWith({ path: 'exports', directory: 'CACHE', recursive: true })
    expect(env.writeFile).toHaveBeenCalledTimes(1)
    expect(env.appendFile).toHaveBeenCalledTimes(2)
    const pieces = [env.writeFile.mock.calls[0][0], ...env.appendFile.mock.calls.map((c) => c[0])] as { data: string; path: string }[]
    expect(pieces.every((p) => p.path === 'exports/save-with-images.json.zip')).toBe(true)
    // Each piece is whole base64 (no padding mid-file), and together they are the file.
    expect(pieces.slice(0, -1).every((p) => !p.data.endsWith('='))).toBe(true)
    const joined = pieces.map((p) => atob(p.data)).join('')
    expect(joined.length).toBe(size)
    expect(joined.charCodeAt(size - 1)).toBe(((size - 1) * 7) % 256)
  })

  it('writes large text in UTF-8 pieces without splitting a character', async () => {
    const text = `${'a'.repeat(WRITE_CHUNK_BYTES - 1)}\u00e9${'b'.repeat(20)}`
    await saveFile(new Blob([text]), 'save.json', 'application/json')
    expect(env.appendFile).toHaveBeenCalledTimes(1)
    const first = env.writeFile.mock.calls[0][0] as { data: string; encoding: string }
    const second = env.appendFile.mock.calls[0][0] as { data: string; encoding: string }
    expect(first.encoding).toBe('utf8')
    expect(second.encoding).toBe('utf8')
    expect(first.data + second.data).toBe(text)
  })

  it('writes an empty file', async () => {
    await saveFile(new Blob([]), 'empty.json', 'application/json')
    expect(env.writeFile).toHaveBeenCalledWith(expect.objectContaining({ data: '', path: 'exports/empty.json' }))
    expect(env.share).toHaveBeenCalled()
  })

  it('treats a dismissed share sheet as cancelled, not an error', async () => {
    env.share.mockRejectedValue(new Error('Share canceled'))
    expect(await saveFile(new Blob(['x']), 'save.json', 'application/json')).toBe('cancelled')
  })

  it('reports a shell without the plugins as unavailable', async () => {
    env.writeFile.mockRejectedValue(Object.assign(new Error('"Filesystem" plugin is not implemented on android'), { code: 'UNIMPLEMENTED' }))
    await expect(saveFile(new Blob(['x']), 'save.json', 'application/json')).rejects.toBeInstanceOf(FileSaveUnavailableError)
  })

  it('passes other failures through', async () => {
    env.writeFile.mockRejectedValue(new Error('No space left on device'))
    await expect(saveFile(new Blob(['x']), 'save.json', 'application/json')).rejects.toThrow('No space left')
  })
})

describe('file helpers', () => {
  it('makes file names safe', () => {
    expect(safeFileName('crushlab-save-2026-09-25.json')).toBe('crushlab-save-2026-09-25.json')
    expect(safeFileName('my/save: "best".json')).toBe('my-save- -best-.json')
    expect(safeFileName('../../etc')).toBe('etc')
    expect(safeFileName('')).toBe('crushlab-file')
  })

  it('base64-encodes large blobs', async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256)
    const b64 = await blobToBase64(new Blob([bytes]))
    expect(atob(b64).length).toBe(100_000)
    expect(atob(b64).charCodeAt(99_999)).toBe(99_999 % 256)
  })
})
