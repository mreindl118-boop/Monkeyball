// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettings } from '../../store/settings'

const env = vi.hoisted(() => ({
  native: false,
  check: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(async () => true),
}))

vi.mock('../../platform/platform', () => ({
  isNative: () => env.native,
  platformName: () => (env.native ? 'android' : 'web'),
  isAndroidApp: () => env.native,
  hasPlugin: () => env.native,
}))

vi.mock('../../platform/updates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/updates')>()),
  checkForUpdate: env.check,
  openExternal: env.open,
  refreshWebApp: env.refresh,
}))

import { AppSection } from './AppSection'

const realUpdate = useSettings.getState().update

beforeEach(() => {
  // CI sets BUILD_NUMBER for the whole job; pin it so the labels don't depend on where tests run.
  vi.stubEnv('VITE_BUILD_NUMBER', '0')
  env.native = false
  env.check.mockReset()
  env.open.mockReset()
  useSettings.setState({
    loaded: true,
    update: realUpdate,
    settings: { ...useSettings.getState().settings, autoUpdateCheck: true },
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('Settings, App section', () => {
  it('on the web: version, build, and that the web app updates itself', async () => {
    render(<AppSection />)
    expect(screen.getByText('Version')).toBeTruthy()
    expect(screen.getByText('Development build')).toBeTruthy()
    expect(screen.getByText('Web app')).toBeTruthy()
    expect(screen.getByText(/The web app updates itself/)).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Check for updates on launch' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText(/a notice with Reload shows up/)).toBeTruthy()
    expect(env.check).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Get the Android app' }))
    expect(env.open).toHaveBeenCalledWith('https://github.com/mreindl118-boop/Monkeyball/releases/latest')
  })

  it('in the app: checks GitHub and offers the new APK', async () => {
    env.native = true
    env.check.mockResolvedValue({
      current: 10,
      latest: 12,
      available: true,
      apkUrl: 'https://github.com/mreindl118-boop/Monkeyball/releases/download/build-12/crushlab.apk',
    })
    render(<AppSection />)
    expect(screen.getByText('Android app')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText(/Build 12 is ready\. You have build 10\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(env.open).toHaveBeenCalledWith(
      'https://github.com/mreindl118-boop/Monkeyball/releases/download/build-12/crushlab.apk',
    )
  })

  it('in the app: says so when this is the newest build, and when GitHub is unreachable', async () => {
    env.native = true
    env.check.mockResolvedValueOnce({ current: 12, latest: 12, available: false })
    render(<AppSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('You have the newest build (12).')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()

    env.check.mockResolvedValueOnce(null)
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText(/Couldn't reach GitHub/)).toBeTruthy()
  })

  it('in the app: the launch check can be switched off', () => {
    env.native = true
    const update = vi.fn(async () => {})
    useSettings.setState({ update })
    render(<AppSection />)
    const toggle = screen.getByRole('switch', { name: 'Check for updates on launch' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(update).toHaveBeenCalledWith({ autoUpdateCheck: false })
  })
})
