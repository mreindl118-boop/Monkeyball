// Pure helpers behind the hub's "Word around town" strip: game news newest first, what's unread,
// when it happened in words, and which character each item links to. No React, no stores.

import type { NewsItem } from '../../types'

export interface NewsRow {
  id: string
  text: string
  /** "Just now", "3h ago", "Yesterday", "Sep 12". */
  when: string
  unread: boolean
  kind: NewsItem['kind']
  /** The character the item opens (the first one on this device), if any. */
  target?: string
  /** The target's name, for the item's accessible label. */
  targetName?: string
}

export interface NewsView {
  rows: NewsRow[]
  unread: number
  /** Items left out past the limit. */
  more: number
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const dayFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })

/** When a news item happened, in a few words (no clock times: the hub reads at a glance). */
export function timeAgo(at: number, now: number): string {
  const d = now - at
  if (!Number.isFinite(d) || d < MINUTE) return 'Just now'
  if (d < HOUR) return `${Math.floor(d / MINUTE)}m ago`
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`
  if (d < 2 * DAY) return 'Yesterday'
  if (d < 7 * DAY) return `${Math.floor(d / DAY)} days ago`
  return dayFmt.format(at)
}

/**
 * The strip: newest first, up to `limit` items, each linked to the first of its characters that is
 * on this device and in play (`linkable`). Items about nobody in play still show, without a link.
 */
export function newsView(
  news: readonly NewsItem[] | undefined,
  opts: { now: number; limit?: number; linkable: (id: string) => boolean; names: Readonly<Record<string, string>> },
): NewsView {
  const all = [...(news ?? [])].filter((n) => n && typeof n.text === 'string' && n.text.trim())
  all.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  const limit = opts.limit ?? all.length
  const rows = all.slice(0, limit).map((n): NewsRow => {
    const target = (n.characterIds ?? []).find((id) => opts.linkable(id))
    const row: NewsRow = { id: n.id, text: n.text.trim(), when: timeAgo(n.at, opts.now), unread: !n.read, kind: n.kind }
    if (target) {
      row.target = target
      row.targetName = opts.names[target] ?? target
    }
    return row
  })
  return { rows, unread: all.filter((n) => !n.read).length, more: Math.max(0, all.length - rows.length) }
}

/** "2 new" or "" for the strip's heading. */
export function unreadText(n: number): string {
  return n > 0 ? `${n} new` : ''
}

/** The item's accessible name: its text, whether it's new, and where it goes. */
export function newsLabel(row: NewsRow): string {
  const parts = [row.text]
  if (row.unread) parts.push('New.')
  parts.push(row.when + '.')
  if (row.targetName) parts.push(`Opens ${row.targetName}'s profile.`)
  return parts.join(' ')
}
