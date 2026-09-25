import type { SVGProps } from 'react'

export interface KissProps extends SVGProps<SVGSVGElement> {
  /** Filled lipstick print, or an outline when false. */
  filled?: boolean
}

/** A lipstick kiss print. Used for heat pips and relationship stage stamps. */
export function Kiss({ filled = true, ...rest }: KissProps) {
  return (
    <svg viewBox="0 0 32 22" aria-hidden="true" focusable="false" {...rest}>
      <g
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 0.6 : 1.5}
        strokeLinejoin="round"
      >
        {/* Upper lip with a cupid's bow */}
        <path d="M2.2 11.2C5 6.6 8.6 3.4 12 3.6c1.7.1 2.9 1.2 4 2.4 1.1-1.2 2.3-2.3 4-2.4 3.4-.2 7 3 9.8 7.6-3.6.2-6.8.2-9.8 0-1.4-.1-2.6-.1-4 .3-1.4-.4-2.6-.4-4-.3-3 .2-6.2.2-9.8 0Z" />
        {/* Lower lip */}
        <path d="M2.6 12.2c3.4.9 6.6 1.1 9.4 1 1.5-.1 2.7-.3 4-.1 1.3-.2 2.5 0 4 .1 2.8.1 6-.1 9.4-1-2.6 4.4-7.4 7.2-13.4 7.2S5.2 16.6 2.6 12.2Z" />
      </g>
      {filled && (
        <g stroke="rgb(0 0 0 / 0.28)" strokeWidth="0.7" strokeLinecap="round" fill="none">
          {/* Lip creases so it reads as a print, not a blob */}
          <path d="M9 14.8c.3 1.4.4 2.4.3 3.2M13 15.2c.1 1.4.1 2.6 0 3.6M19 15.2c-.1 1.4-.1 2.6 0 3.6M23 14.8c-.3 1.4-.4 2.4-.3 3.2" />
          <path d="M9.5 9.6c.2-1.2.6-2.4 1.2-3.4M22.5 9.6c-.2-1.2-.6-2.4-1.2-3.4" />
        </g>
      )}
    </svg>
  )
}
