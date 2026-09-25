import { describe, expect, it } from 'vitest'
import type { NewsItem } from '../../types'
import { newsLabel, newsView, timeAgo, unreadText } from './newsModel'

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0)
const H = 3_600_000

function item(id: string, at: number, patch: Partial<NewsItem> = {}): NewsItem {
  return { id, at, kind: 'gossip', text: `Item ${id}`, characterIds: ['nova'], read: false, ...patch }
}

describe('news strip', () => {
  it('shows the newest first and counts what is unread', () => {
    const view = newsView([item('a', NOW - 5 * H, { read: true }), item('b', NOW - H), item('c', NOW - 2 * H)], {
      now: NOW,
      linkable: () => true,
      names: { nova: 'Nova Castellanos' },
    })
    expect(view.rows.map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect(view.unread).toBe(2)
    expect(view.rows[0]).toMatchObject({ unread: true, target: 'nova', targetName: 'Nova Castellanos', when: '1h ago' })
  })

  it('links to the first character in play, and none when nobody is', () => {
    const view = newsView([item('a', NOW, { characterIds: ['gone', 'kai'] }), item('b', NOW - 1, { characterIds: ['gone'] })], {
      now: NOW,
      linkable: (id) => id === 'kai',
      names: {},
    })
    expect(view.rows[0].target).toBe('kai')
    expect(view.rows[1].target).toBeUndefined()
  })

  it('keeps to the limit and says how many more there are', () => {
    const news = Array.from({ length: 8 }, (_, i) => item(`n${i}`, NOW - i * H))
    const view = newsView(news, { now: NOW, limit: 5, linkable: () => true, names: {} })
    expect(view.rows).toHaveLength(5)
    expect(view.more).toBe(3)
    expect(view.unread).toBe(8)
  })

  it('skips empty items', () => {
    expect(newsView([item('a', NOW, { text: '  ' })], { now: NOW, linkable: () => true, names: {} }).rows).toEqual([])
    expect(newsView(undefined, { now: NOW, linkable: () => true, names: {} }).rows).toEqual([])
  })
})

describe('time in words', () => {
  it('reads at a glance', () => {
    expect(timeAgo(NOW - 10_000, NOW)).toBe('Just now')
    expect(timeAgo(NOW - 5 * 60_000, NOW)).toBe('5m ago')
    expect(timeAgo(NOW - 3 * H, NOW)).toBe('3h ago')
    expect(timeAgo(NOW - 30 * H, NOW)).toBe('Yesterday')
    expect(timeAgo(NOW - 3 * 24 * H, NOW)).toBe('3 days ago')
    expect(timeAgo(NOW - 30 * 24 * H, NOW)).toBe('Aug 26')
  })

  it('labels items for screen readers', () => {
    const [row] = newsView([item('a', NOW)], { now: NOW, linkable: () => true, names: { nova: 'Nova' } }).rows
    expect(newsLabel(row)).toBe("Item a New. Just now. Opens Nova's profile.")
    expect(unreadText(2)).toBe('2 new')
    expect(unreadText(0)).toBe('')
  })
})
