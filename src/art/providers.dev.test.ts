// @vitest-environment jsdom
// The dev-only xAI address override (DEV_XAI_BASE_KEY) that scripts/e2e/phase5.mjs uses to point
// Grok Imagine at the mock. Vitest runs as a dev build (import.meta.env.DEV); production builds
// drop the branch, which `npm run build` plus a grep of dist/ shows (see PROGRESS.md).
import { afterEach, describe, expect, it } from 'vitest'
import type { FallbackInit } from '../platform/http'
import { defaultSettings } from '../store/defaults'
import { createGrokProvider, DEV_XAI_BASE_KEY } from './providers'

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

function capture() {
  const urls: string[] = []
  const fetch = async (url: string, init?: FallbackInit) => {
    urls.push(url)
    void init
    return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200 })
  }
  return { urls, fetch }
}

const req = () => ({ prompt: 'adult woman, 28 years old', negative: '', seed: 1, settings: defaultSettings().image, apiKey: 'k' })

afterEach(() => localStorage.removeItem(DEV_XAI_BASE_KEY))

describe('the dev-only xAI address override', () => {
  it('is api.x.ai unless the dev key names another http(s) address', async () => {
    const plain = capture()
    await createGrokProvider({ fetch: plain.fetch }).generate(req())
    expect(plain.urls).toEqual(['https://api.x.ai/v1/images/generations'])

    localStorage.setItem(DEV_XAI_BASE_KEY, 'http://127.0.0.1:9999/v1/')
    const mocked = capture()
    await createGrokProvider({ fetch: mocked.fetch }).generate(req())
    expect(mocked.urls).toEqual(['http://127.0.0.1:9999/v1/images/generations'])

    localStorage.setItem(DEV_XAI_BASE_KEY, 'javascript:alert(1)')
    const junk = capture()
    await createGrokProvider({ fetch: junk.fetch }).generate(req())
    expect(junk.urls).toEqual(['https://api.x.ai/v1/images/generations'])
  })

  it('never overrides an address a caller passed in', async () => {
    localStorage.setItem(DEV_XAI_BASE_KEY, 'http://127.0.0.1:9999/v1')
    const c = capture()
    await createGrokProvider({ fetch: c.fetch, grokBaseUrl: 'https://xai.test/v1' }).generate(req())
    expect(c.urls).toEqual(['https://xai.test/v1/images/generations'])
  })
})
