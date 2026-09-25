// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { appRandom, DEBUG_ROLLS_KEY, parseDebugRolls, readDebugRolls, rollsSource, seededRandom, writeDebugRolls } from './rolls'

afterEach(() => {
  try {
    localStorage.removeItem(DEBUG_ROLLS_KEY)
  } catch {
    // No storage in this environment.
  }
})

describe('debug rolls', () => {
  it('reads the stored setting', () => {
    expect(parseDebugRolls(null)).toEqual({ kind: 'random' })
    expect(parseDebugRolls('  ')).toEqual({ kind: 'random' })
    expect(parseDebugRolls('whatever')).toEqual({ kind: 'random' })
    expect(parseDebugRolls('Succeed')).toEqual({ kind: 'succeed' })
    expect(parseDebugRolls('always')).toEqual({ kind: 'succeed' })
    expect(parseDebugRolls('fail')).toEqual({ kind: 'fail' })
    expect(parseDebugRolls('42')).toEqual({ kind: 'seed', seed: 42 })
  })

  it('makes every roll succeed or fail, or repeats a seeded sequence', () => {
    const always = rollsSource({ kind: 'succeed' })
    const never = rollsSource({ kind: 'fail' })
    for (const chance of [0.1, 0.25, 0.5]) {
      expect(always() < chance).toBe(true)
      expect(never() < chance).toBe(false)
    }
    const a = seededRandom(7)
    const b = seededRandom(7)
    const seqA = [a(), a(), a(), a()]
    expect([b(), b(), b(), b()]).toEqual(seqA)
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true)
    expect(seededRandom(8)()).not.toBe(seqA[0])
    const random = () => 0.3
    expect(rollsSource({ kind: 'random' }, random)).toBe(random)
  })

  it('follows the stored setting in dev and test builds, picking up changes', () => {
    writeDebugRolls('succeed')
    expect(readDebugRolls()).toEqual({ kind: 'succeed' })
    expect(appRandom()).toBe(0)
    writeDebugRolls('fail')
    expect(appRandom()).toBeGreaterThan(0.99)
    writeDebugRolls('5')
    const first = appRandom()
    writeDebugRolls('')
    expect(readDebugRolls()).toEqual({ kind: 'random' })
    appRandom()
    // A seed set again starts its sequence over.
    writeDebugRolls('5')
    expect(appRandom()).toBe(first)
  })
})
