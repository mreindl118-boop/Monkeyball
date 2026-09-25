import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button } from './Button'
import { copyText } from './clipboard'
import styles from './CodeBlock.module.css'

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const onClick = async () => {
    const ok = await copyText(text)
    setState(ok ? 'copied' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1600)
  }
  return (
    <Button variant="ghost" size="small" onClick={onClick} disabled={!text} aria-live="polite">
      {state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : label}
    </Button>
  )
}

export interface CodeBlockProps {
  title?: ReactNode
  text: string
  /** Shown when text is empty. */
  empty?: string
  maxHeight?: number
  /** Extra header content next to the copy button. */
  actions?: ReactNode
}

/** A monospace block with a copy button. Wraps long lines so it never scrolls sideways. */
export function CodeBlock({ title, text, empty = 'Nothing here yet.', maxHeight, actions }: CodeBlockProps) {
  const style = maxHeight ? ({ '--code-max': `${maxHeight}px` } as CSSProperties) : undefined
  return (
    <div className={styles.block}>
      <div className={styles.head}>
        <span className={styles.title}>{title}</span>
        <span>
          {actions}
          <CopyButton text={text} />
        </span>
      </div>
      <pre className={styles.pre} style={style} tabIndex={0}>
        {text ? <code>{text}</code> : <span className={styles.empty}>{empty}</span>}
      </pre>
    </div>
  )
}
