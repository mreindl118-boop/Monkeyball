// Pure helpers for Settings, Image generation: the provider choice, the A1111 address ("on this
// device" or "PC on my Wi-Fi", like Ollama's), Grok Imagine's options, and the small test image's
// settings. No React, no stores.

import { DEFAULT_GROK_IMAGE_MODEL } from '../../store/defaults'
import type { ImageAspectRatio, ImageProvider, ImageSettings, Settings } from '../../types'
import { hostModeOf, type HostMode } from '../ConnectionSetup/connectionHelpers'

export { DEFAULT_GROK_IMAGE_MODEL }

/** Automatic1111 and Forge listen here unless told otherwise. */
export const A1111_PORT = 7860

/** The aspect ratios offered for Grok Imagine, portrait first (character art is portrait). */
export const GROK_ASPECTS: readonly ImageAspectRatio[] = ['2:3', '3:4', '1:1', '9:16']

/** The fallback sampler list, until Test image generation reads the server's own. */
export const DEFAULT_SAMPLERS: readonly string[] = ['DPM++ 2M', 'DPM++ 2M SDE', 'DPM++ SDE', 'Euler a', 'Euler', 'DDIM', 'UniPC', 'LCM']

/** The provider in use (settings saved before Phase 5 have none: Automatic1111). */
export function imageProvider(img: Pick<ImageSettings, 'provider'>): ImageProvider {
  return img.provider === 'grok' ? 'grok' : 'a1111'
}

export function grokModel(img: Pick<ImageSettings, 'grokModel'>): string {
  return img.grokModel?.trim() || DEFAULT_GROK_IMAGE_MODEL
}

export function aspectRatio(img: Pick<ImageSettings, 'aspectRatio'>): ImageAspectRatio {
  return img.aspectRatio ?? '2:3'
}

/** The one-line explanation under each provider. */
export const PROVIDER_HELP: Readonly<Record<ImageProvider, string>> = {
  grok: "xAI's image model. No GPU needed: it uses the Grok key from Connection, and each picture is billed to that key.",
  a1111:
    'Your own PC paints them with Automatic1111 or Forge, launched with --api --cors-allow-origins=* and reachable from this device.',
}

/** The Grok key from Connection is there. */
export function hasGrokKey(settings: Pick<Settings, 'connection'>): boolean {
  return !!settings.connection.providers.grok?.apiKey?.trim()
}

/** Where an A1111 address points: this device, or a PC on the network (its host). */
export function a1111Host(baseUrl: string): { mode: HostMode; host: string } {
  return hostModeOf(baseUrl)
}

/** The A1111 address for this device (127.0.0.1) or a PC on the Wi-Fi, with the default port. */
export function a1111Url(mode: HostMode, host: string): string {
  const h =
    mode === 'device'
      ? '127.0.0.1'
      : host
          .trim()
          .replace(/^https?:\/\//i, '')
          .replace(/[:/].*$/, '')
  return `http://${h || '127.0.0.1'}:${A1111_PORT}`
}

/**
 * Samplers to pick from: the server's list once it's known, else the fallback list, with the
 * saved sampler kept at the top when neither has it.
 */
export function samplerChoices(current: string, fromServer: readonly string[] | null): string[] {
  const list = fromServer && fromServer.length ? [...new Set(fromServer)] : [...DEFAULT_SAMPLERS]
  return current && !list.includes(current) ? [current, ...list] : list
}

/**
 * The settings the test image is painted with: small and quick (512 by 640 at up to 20 steps on
 * A1111). Grok Imagine keeps its model and aspect ratio.
 */
export function testImageSettings(img: ImageSettings): ImageSettings {
  return { ...img, width: 512, height: 640, steps: Math.min(Math.max(1, img.steps || 20), 20) }
}
