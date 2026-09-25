import { parseStory } from './dateModel'
import styles from './DateScreen.module.css'

/** A character's reply: *actions* in italics, dialogue and narration as written, a caret while streaming. */
export function StoryText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const paragraphs = parseStory(text)
  if (paragraphs.length === 0) {
    return streaming ? (
      <p className={styles.para}>
        <span className={styles.caret} aria-hidden="true" />
      </p>
    ) : null
  }
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className={styles.para}>
          {p.map((seg, j) =>
            seg.kind === 'action' ? (
              <em key={j} className={styles.action}>
                {seg.text}
              </em>
            ) : (
              <span key={j}>{seg.text}</span>
            ),
          )}
          {streaming && i === paragraphs.length - 1 && <span className={styles.caret} aria-hidden="true" />}
        </p>
      ))}
    </>
  )
}
