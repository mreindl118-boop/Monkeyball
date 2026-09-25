import { it } from 'vitest'
import { BUNDLED_CHARACTERS } from '../data/bundled'
import { scrubPromptText } from './imagePrompt'
it('bundled survey', () => {
  const out: string[] = []
  for (const { character: c } of BUNDLED_CHARACTERS) {
    const tags = c.artTags.split(',').map((t) => t.trim()).filter(Boolean)
    const got = scrubPromptText(c.artTags, { heat: 5, dropAges: false })
    if (got !== [...new Set(tags)].join(', ')) out.push(`TAGS ${c.id}: ${got}`)
    const texts: [string, string][] = [['body', c.bodyNotes ?? '']]
    for (const t of c.gallery) texts.push([`t${t.tier}`, t.scene])
    for (const [k, e] of Object.entries(c.endings ?? {})) texts.push([`end ${k}`, e?.scene ?? ''])
    for (const [k, t] of texts) {
      if (!t) continue
      const parts = t.split(/[,;:]/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean)
      for (const heat of [1, 5] as const) {
        const got2 = scrubPromptText(t, { heat })
        if (got2 !== parts.join(', ')) out.push(`${c.id} ${k} h${heat}: DROPPED ${parts.filter((p) => !got2.split(', ').includes(p)).join(' | ')}`)
      }
    }
  }
  console.log(out.join('\n'))
})
