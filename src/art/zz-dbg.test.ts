import { it } from 'vitest'
import { scrubPromptText } from './imagePrompt'
it('dbg', () => {
  for (const t of ['on the night bus, Bash asleep with his head in your lap, streetlights', 'in a sleeping bag on the roof', 'Bash asleep with his head in your lap', 'streetlights'])
    for (const heat of [2, 3, 5] as const) console.log(heat, JSON.stringify(scrubPromptText(t, { heat })))
})
