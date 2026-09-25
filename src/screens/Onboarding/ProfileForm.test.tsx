// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NAME_MAX } from './profile'
import { ProfileForm } from './ProfileForm'

afterEach(cleanup)

function pickGender(name: string) {
  const group = screen.getByRole('radiogroup', { name: 'Gender' })
  const radio = [...group.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => r.textContent?.trim().startsWith(name))
  if (!radio) throw new Error(`no ${name} option`)
  fireEvent.click(radio)
}

const pronouns = () => (screen.getByLabelText('Pronouns') as HTMLInputElement).value

describe('ProfileForm pronouns', () => {
  it('follow the gender picker through Custom until the player sets their own', () => {
    render(<ProfileForm initial={null} onSubmit={() => {}} submitLabel="Save" />)
    expect(pronouns()).toBe('they/them')
    pickGender('Custom')
    expect(pronouns()).toBe('they/them')
    pickGender('Woman')
    expect(pronouns()).toBe('she/her')
    pickGender('Man')
    expect(pronouns()).toBe('he/him')

    fireEvent.change(screen.getByLabelText('Pronouns'), { target: { value: 'he/they' } })
    pickGender('Woman')
    expect(pronouns()).toBe('he/they')
  })

  it('keeps pronouns picked from the suggestions', () => {
    render(<ProfileForm initial={null} onSubmit={() => {}} submitLabel="Save" />)
    fireEvent.click(screen.getByRole('button', { name: 'she/her' }))
    pickGender('Man')
    expect(pronouns()).toBe('she/her')
  })

  it('limits the name input to what validation accepts', () => {
    render(<ProfileForm initial={null} onSubmit={() => {}} submitLabel="Save" />)
    expect((screen.getByLabelText('Name') as HTMLInputElement).maxLength).toBe(NAME_MAX)
  })
})
