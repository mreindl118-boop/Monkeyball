// The debug panel's Transcript tab: the live date (or the last one) turn by turn, with the judge
// result and the applied deltas on each player turn, and every prompt the date sent (from the
// debug log, matched by character and time).

import { useEffect, useMemo, useState } from 'react'
import { giftById } from '../../data/gifts'
import { venueById } from '../../data/venues'
import { listDates } from '../../db/repo'
import { useDate } from '../../store/date'
import { useDebug } from '../../store/debug'
import { useRoster } from '../../store/roster'
import type { DateRecord } from '../../types'
import { Chip } from '../../ui/Chip'
import { CodeBlock } from '../../ui/CodeBlock'
import { Note } from '../../ui/Panel'
import { deltaText } from '../DateScreen/dateModel'
import styles from './Debug.module.css'
import { dateEntries, judgeSummary, recordSummary, turnLabel } from './transcriptModel'
import own from './TranscriptTab.module.css'

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })

const KIND_LABELS: Record<string, string> = {
  story: 'Story',
  judge: 'Judge',
  agreement: 'Agreement',
  suggestions: 'Suggestions',
  memory: 'Memory',
}

function json(v: unknown): string {
  return JSON.stringify(v, null, 2)
}

export function TranscriptTab() {
  const session = useDate((s) => s.session)
  const lastRecord = useDate((s) => s.lastRecord)
  const entries = useDebug((s) => s.entries)
  const roster = useRoster((s) => s.entries)
  const [stored, setStored] = useState<DateRecord | null | undefined>(undefined)
  const live = !!session && session.status !== 'ended'

  useEffect(() => {
    if (session || lastRecord) return
    let alive = true
    listDates()
      .then((list) => {
        if (alive) setStored(list[list.length - 1] ?? null)
      })
      .catch(() => {
        if (alive) setStored(null)
      })
    return () => {
      alive = false
    }
  }, [session, lastRecord])

  const record = session?.record ?? lastRecord ?? stored ?? null
  const calls = useMemo(() => (record ? dateEntries(entries, record) : []), [entries, record])

  if (!record) {
    return (
      <div className={styles.empty}>
        <strong>{stored === undefined && !session ? 'Looking for a date' : 'No date played yet'}</strong>
        <p>The transcript of the current or last date shows here, with the judge's scores and the prompts it sent.</p>
      </div>
    )
  }

  const cid = record.characterIds[0] ?? ''
  const name = roster[cid]?.character.name ?? cid
  const venue = venueById(record.venueId)?.name ?? record.venueId
  const gift = record.giftId ? (giftById(record.giftId)?.name ?? record.giftId) : 'No gift'

  return (
    <div className={styles.stack}>
      <section className={own.head} aria-label="Date">
        <div className={styles.kindHead}>
          <h2 className={styles.kindTitle}>{name}</h2>
          <Chip tone={live ? 'lipstick' : 'brass'}>{live ? 'Live date' : 'Last date'}</Chip>
        </div>
        <dl className={own.facts}>
          <div>
            <dt>Venue</dt>
            <dd>{venue}</dd>
          </div>
          <div>
            <dt>Gift</dt>
            <dd>{gift}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{timeFmt.format(record.startedAt)}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{recordSummary(record, live ? session?.status : undefined)}</dd>
          </div>
        </dl>
        {record.totals?.[cid] && (
          <p className={styles.count}>
            Date totals: affection {record.totals[cid].affection}, trust {record.totals[cid].trust}, gained{' '}
            {record.totals[cid].gained}.
          </p>
        )}
      </section>

      <section aria-label="Turns">
        <ol className={own.turns}>
          {record.turns.map((t, i) => {
            const judge = t.judge?.[cid]
            const applied = t.applied?.[cid]
            return (
              <li key={i} className={own.turn} data-role={t.role}>
                <p className={own.turnHead}>
                  <span className={own.who}>{turnLabel(t, name)}</span>
                  <span className={styles.entryMeta}>{timeFmt.format(t.at)}</span>
                  {t.notice && <Chip tone={t.notice === 'error' ? 'lipstick' : 'brass'}>{t.notice === 'error' ? 'Error' : 'Declined'}</Chip>}
                </p>
                <p className={own.text}>{t.text}</p>
                {judge && <p className={own.judge}>{judgeSummary(judge)}</p>}
                {applied && <p className={own.applied}>Applied: {deltaText(applied)}</p>}
              </li>
            )
          })}
        </ol>
        {live && session?.streaming && (
          <Note title="Streaming now">
            <p className={own.text}>{session.streaming}</p>
          </Note>
        )}
      </section>

      <section className={styles.kind} aria-label="Prompts for this date">
        <div className={styles.kindHead}>
          <h2 className={styles.kindTitle}>Prompts for this date</h2>
          <span className={styles.count}>{calls.length === 1 ? '1 call' : `${calls.length} calls`}</span>
        </div>
        {calls.length === 0 ? (
          <p className={styles.count}>None in the log (it lives in memory and clears when the app closes).</p>
        ) : (
          <ul className={styles.entries}>
            {calls.map((e) => (
              <li key={e.id}>
                <details className={styles.entry}>
                  <summary className={styles.summary}>
                    <span className={styles.entryKind}>{KIND_LABELS[e.kind] ?? e.kind}</span>
                    <span className={styles.entryMeta}>{timeFmt.format(e.at)}</span>
                    {e.error ? <Chip tone="lipstick">Error</Chip> : e.response === undefined ? <Chip>Waiting</Chip> : null}
                  </summary>
                  <div className={styles.entryBody}>
                    {e.error && (
                      <Note tone="lipstick" title="Error">
                        {e.error}
                      </Note>
                    )}
                    <CodeBlock title="Prompt" text={e.prompt} maxHeight={320} />
                    {e.messages && e.messages.length > 1 && <CodeBlock title="Messages" text={json(e.messages)} maxHeight={320} />}
                    <CodeBlock title="Response" text={e.response ?? ''} empty="No response yet." maxHeight={320} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CodeBlock title="Date record" text={json(record)} maxHeight={360} />
    </div>
  )
}
