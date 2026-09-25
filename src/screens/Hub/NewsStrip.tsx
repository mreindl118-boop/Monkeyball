// "Word around town": the game's news (gossip, rekindles, betrayals, rumors) as a strip of cards on
// the hub, newest first, with a lipstick dot on what's unread. Tapping an item marks it read and
// opens the character it's about. Hidden while there's no news.

import { useMemo, useState } from 'react'
import { useGame } from '../../store/game'
import { useNav } from '../../store/nav'
import { useRoster } from '../../store/roster'
import { useSettings } from '../../store/settings'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import styles from './NewsStrip.module.css'
import { newsLabel, newsView, unreadText } from './newsModel'

const SHOWN = 12

export function NewsStrip() {
  const news = useGame((s) => s.game.news)
  const markNewsRead = useGame((s) => s.markNewsRead)
  const entries = useRoster((s) => s.entries)
  const activeSets = useSettings((s) => s.settings.activeSets)
  const go = useNav((s) => s.go)
  // The clock for "3h ago" is read when the hub opens, not on every render.
  const [now] = useState(() => Date.now())

  const view = useMemo(() => {
    const names: Record<string, string> = {}
    for (const e of Object.values(entries)) names[e.character.id] = e.character.name.trim() || e.character.id
    const linkable = (id: string) => !!entries[id] && activeSets.includes(entries[id].setId)
    return newsView(news, { now, limit: SHOWN, linkable, names })
  }, [news, entries, activeSets, now])

  if (view.rows.length === 0) return null

  const open = (id: string, target?: string) => {
    void markNewsRead([id])
    if (target) go({ name: 'profile', id: target })
  }

  return (
    <section className={styles.strip} aria-labelledby="hub-news">
      <div className={styles.head}>
        <h2 className={styles.title} id="hub-news">
          Word around town
        </h2>
        {view.unread > 0 && <span className={styles.count}>{unreadText(view.unread)}</span>}
        {view.unread > 0 && (
          <Button variant="ghost" size="small" className={styles.markAll} onClick={() => void markNewsRead()}>
            Mark all read
          </Button>
        )}
      </div>
      <ul className={styles.list}>
        {view.rows.map((row) => (
          <li key={row.id} className={styles.cell}>
            <button
              type="button"
              className={cx(styles.item, row.unread && styles.unread, styles[row.kind])}
              aria-label={newsLabel(row)}
              onClick={() => open(row.id, row.target)}
            >
              {row.unread && <span className={styles.dot} aria-hidden="true" />}
              <span className={styles.text}>{row.text}</span>
              <span className={styles.when}>{row.when}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
