// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastHost } from './Toast'
import { toast, useToasts } from './toastStore'

afterEach(() => {
  cleanup()
  useToasts.setState({ toasts: [] })
})

describe('toast actions', () => {
  it('shows the action, runs it and closes the toast', () => {
    const run = vi.fn()
    render(<ToastHost />)
    act(() => {
      toast('A new version is ready.', 'info', 0, { label: 'Reload', run })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(run).toHaveBeenCalledTimes(1)
    expect(useToasts.getState().toasts).toEqual([])
  })

  it('a plain toast has only Dismiss', () => {
    render(<ToastHost />)
    act(() => {
      toast('Saved.')
    })
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Dismiss'])
  })
})
