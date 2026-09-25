import { describe, expect, it } from 'vitest'
// SPEC is read as raw text through Vite (the app tsconfig has no Node types for node:fs).
import spec from '../../docs/SPEC.md?raw'
import novaJson from '../data/sets/afterhours/characters/nova.json'
import type { Character, JudgeResult, PlayerProfile, Relationship } from '../types'
import {
  agreementText,
  buildAgreementPrompt,
  buildJudgePrompt,
  buildMemoryPrompt,
  buildStoryPrompt,
  buildSuggestionsPrompt,
  DATE_BEGINS,
  fill,
  knownStyleText,
  makeJudgeMessages,
  makeMemoryMessages,
  makeStoryMessages,
  makeSuggestionsMessages,
  MOD_DIRECTION_HEADER,
  type StoryContext,
  suggestionKeys,
  TEMPLATES,
} from './build'

const nova = novaJson as unknown as Character

const rel = (p: Partial<Relationship> = {}): Relationship => ({
  characterId: 'nova',
  affection: 0,
  trust: 0,
  discovered: [],
  venues: {},
  gifts: {},
  revealed: { attractions: false, style: false },
  knowsPlayerStyle: false,
  secretsUnlocked: [],
  agreement: { type: 'none', terms: '', madeAt: 0 },
  knownOthers: [],
  memory: [],
  tiersUnlocked: [],
  betrayals: [],
  dates: 0,
  lastDateAt: 0,
  connection: 0,
  heatPushes: 0,
  jealous: false,
  ...p,
})

const profile = (p: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Robin Vale',
  gender: 'nonbinary',
  pronouns: 'they/them',
  bodyNotes: 'Soft middle, freckled shoulders, a scar through one eyebrow',
  relationshipStyle: 'polyamorous',
  ...p,
})

const judge = (p: Partial<JudgeResult> = {}): JudgeResult => ({
  delta: 6,
  trustDelta: 1,
  hits: [{ type: 'turnOn', id: 'slow-dance' }],
  mood: 'delighted',
  hint: 'A real laugh.',
  jealousy: false,
  breach: false,
  ...p,
})

const names = { nova: 'Nova Castellanos', kai: 'Kai Okoro', imani: 'Imani Clarke' }

const story = (p: Partial<StoryContext> = {}): StoryContext => ({
  character: nova,
  rel: rel(),
  profile: profile(),
  heat: 2,
  route: 'romantic',
  venue: { name: 'Record store', feeling: 'loves' },
  turn: 3,
  maxTurns: 10,
  firstDate: true,
  judge: judge(),
  names,
  ...p,
})

/** A leftover placeholder: "{" followed by a letter (JSON examples start with a quote). */
const LEFTOVER = /\{[A-Za-z][^{}\n]*\}/

function specBlocks(md: string): string[] {
  const out: string[] = []
  let cur: string[] | null = null
  let lang = ''
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) {
      if (cur) {
        if (lang === '') out.push(cur.join('\n'))
        cur = null
      } else {
        cur = []
        lang = line.slice(3).trim()
      }
    } else if (cur) cur.push(line)
  }
  return out
}

describe('templates', () => {
  it('match the SPEC code blocks byte for byte (judge minus its "(e.g. ...)" guidance)', () => {
    const blocks = specBlocks(spec.replace(/\r\n/g, '\n'))
    expect(blocks).toHaveLength(5)
    const [storyBlock, judgeBlock, agreementBlock, suggestionsBlock, memoryBlock] = blocks
    const file = (t: string) => t.replace(/\n$/, '')
    expect(file(TEMPLATES.story)).toBe(storyBlock)
    expect(file(TEMPLATES.agreement)).toBe(agreementBlock)
    expect(file(TEMPLATES.suggestions)).toBe(suggestionsBlock)
    expect(file(TEMPLATES.memory)).toBe(memoryBlock)
    const judgeExpected = judgeBlock.replace(/(\{name\}'s current opinion: \{opinion\}) \(e\.g\. "[^\n]*"\)$/m, '$1')
    expect(judgeExpected).not.toBe(judgeBlock)
    expect(file(TEMPLATES.judge)).toBe(judgeExpected)
  })
})

describe('fill', () => {
  it('replaces only keys present in values and leaves JSON braces alone', () => {
    expect(fill('{a} {b} {"x": 1} {a}', { a: 'A' })).toBe('A {b} {"x": 1} A')
    expect(fill('{likes as "id: label"}', { 'likes as "id: label"': 'v' })).toBe('v')
  })

  it('does not re-fill values that contain braces', () => {
    expect(fill('{a}', { a: '{b}', b: 'B' })).toBe('{b}')
  })
})

describe('story prompt', () => {
  it('fills every placeholder', () => {
    const p = buildStoryPrompt(story())
    expect(p).not.toMatch(LEFTOVER)
    const p0 = buildStoryPrompt(story({ turn: 0, judge: undefined }))
    expect(p0).not.toMatch(LEFTOVER)
  })

  it('includes the player name, gender and pronouns', () => {
    const p = buildStoryPrompt(story())
    expect(p).toContain('PLAYER\nRobin Vale, nonbinary, they/them.')
    const custom = buildStoryPrompt(
      story({ profile: profile({ gender: 'custom', customGender: 'genderfluid', matchAs: 'woman', pronouns: 'she/they' }) }),
    )
    expect(custom).toContain('Robin Vale, genderfluid, she/they.')
  })

  it('renders the character block from the card', () => {
    const p = buildStoryPrompt(story({ rel: rel({ affection: 45, trust: 30 }) }))
    expect(p).toContain(
      'Nova Castellanos, 28, she/her. Late-night DJ at The Low Tide, a dive bar with a better record collection than it deserves.',
    )
    expect(p).toContain('Attracted to: women, men and nonbinary people. Relationship style: open; jealousy: low.\n')
    expect(p).toContain('Partners and exes: Kai Okoro (ex).')
    expect(p).toContain('Likes: Vinyl records and liner-note trivia; 3am diner food; ')
    expect(p).toContain('Stage: Friend (45/100, trust 30/100). Route: romantic.')
    expect(p).toContain('Agreement: none yet')
    expect(p).toContain('that Nova Castellanos knows about: nobody, as far as Nova Castellanos knows')
    expect(p).toContain('Past dates, in Nova Castellanos\'s words: This is your first date.')
    expect(p).toContain('Secrets the player has earned: none yet')
    expect(p).toContain("What Nova Castellanos knows about how the player dates: Nothing yet; they haven't talked about it.")
    expect(p).not.toMatch(/[ \t]$/m)
  })

  it('omits the LANDED section on turn 0 and uses the opener on a first date', () => {
    const p = buildStoryPrompt(story({ turn: 0, judge: undefined }))
    expect(p).not.toContain("HOW THE PLAYER'S LAST MESSAGE LANDED")
    expect(p).not.toContain('React so it')
    expect(p).toContain(
      "Turn 0 of 10. Open the date: Nova Castellanos arrives and greets the player. Use this line: You're either lost or you have excellent taste. Which is it?",
    )
    expect(p).toMatch(/\n\nCONTENT\n/)
    const second = buildStoryPrompt(story({ turn: 0, judge: undefined, firstDate: false }))
    expect(second).not.toContain('Use this line')
  })

  it('writes the LANDED section from the judge result', () => {
    const p = buildStoryPrompt(story())
    expect(p).toContain(
      "HOW THE PLAYER'S LAST MESSAGE LANDED (private; never mention it)\nMood: delighted. It touched a turn-on: Slow dancing in an empty room.\nReact so",
    )
    const none = buildStoryPrompt(story({ judge: judge({ hits: [{ type: 'like', id: 'not-a-trait' }], mood: 'calm' }) }))
    expect(none).toContain('Mood: calm. It hit nothing in particular.')
    const bad = buildStoryPrompt(story({ judge: judge({ hits: [{ type: 'turnOff', id: 'cute' }], breach: true }) }))
    // No agreement: a breach is a lie they caught.
    expect(bad).toContain(`It hit a turn-off: Being called cute. It was a lie, and ${nova.name} caught it.`)
    const agreed = rel({ agreement: { type: 'exclusive', terms: 'Just us.', madeAt: 1 } })
    const broke = buildStoryPrompt(story({ rel: agreed, judge: judge({ hits: [], breach: true }) }))
    expect(broke).toContain('It hit nothing in particular. It broke something the two of you agreed on.')
    // Private sentences from the engine ride after it.
    const told = buildStoryPrompt(story({ rel: agreed, judge: judge({ hits: [], breach: true }), landed: ['It told Nova about Kai Okoro, which breaks the exclusive agreement'] }))
    expect(told).toContain('It broke something the two of you agreed on. It told Nova about Kai Okoro, which breaks the exclusive agreement.\nReact so')
  })

  it('says who brought up defining the relationship, closes an epilogue for good, and carries one-shot notes', () => {
    const dtr = buildStoryPrompt(story({ turn: 3, special: { kind: 'dtr', requested: 'open', by: 'character' } }))
    expect(dtr).toContain(`${nova.name} brought up what you two are and wants open (free to see other people). The player agreed to talk`)
    expect(dtr).not.toContain('The player wants to define what you two are')
    const last = buildStoryPrompt(story({ turn: 6, maxTurns: 6, special: { kind: 'epilogue', direction: 'They are together.' } }))
    expect(last).toContain(`Last turn: close the epilogue; this is how the story with ${nova.name} ends. Epilogue: They are together.`)
    expect(last).not.toContain('wants another')
    const notes = buildStoryPrompt(story({ turn: 0, judge: undefined, notes: ['Somewhere in this reply, Nova shares a bit of gossip: Kai is into you'] }))
    expect(notes).toContain('Somewhere in this reply, Nova shares a bit of gossip: Kai is into you.')
  })

  it('says what the player actually told them about how they date, never the profile unasked', () => {
    const poly = profile({ relationshipStyle: 'polyamorous' })
    expect(knownStyleText(poly, rel({ knowsPlayerStyle: true, toldStyle: { asked: 'exclusive' } }))).toBe('Asked for exclusive (only each other).')
    expect(knownStyleText(poly, rel({ knowsPlayerStyle: true, toldStyle: { style: 'monogamous' } }))).toBe('Monogamous: one partner at a time.')
    expect(knownStyleText(poly, rel({ knowsPlayerStyle: true, toldStyle: {} }))).toBe("They've talked about it, but nothing clear came out of it.")
    // An older save with only the flag keeps the profile's words.
    expect(knownStyleText(poly, rel({ knowsPlayerStyle: true }))).toBe('Polyamorous: has or wants more than one relationship, openly.')
  })

  it('marks a rekindled partner in {partners}', () => {
    const p = buildStoryPrompt(story({ relations: [{ characterId: 'kai', kind: 'ex', note: 'Dated for a year.' }], rekindle: { with: 'kai', invite: false } }))
    expect(p).toContain(`Kai Okoro (ex, back together lately: they got close again while the player was busy, and ${nova.name} is gently closing the door on the player): Dated for a year.`)
  })

  it('changes with the heat level', () => {
    const p1 = buildStoryPrompt(story({ heat: 1 }))
    const p3 = buildStoryPrompt(story({ heat: 3 }))
    expect(p1).toContain('Intensity: Sweet: romance and chemistry, kissing, fade to black before anything intimate.')
    expect(p3).toContain('Intensity: Ecchi: partial nudity')
    expect(p1).not.toBe(p3)
  })

  it('lowers heat to the ace cap and states the ace note', () => {
    const minh = { ...nova, aceSpectrum: { label: 'asexual, panromantic', heatCap: 2 as const } }
    const p = buildStoryPrompt(story({ character: minh, heat: 5 }))
    expect(p).toContain('Intensity: Flirty:')
    expect(p).toContain(`Asexual, panromantic: heat never goes past 2, and that is who ${nova.name} is, not a puzzle.`)
    const priya = { ...nova, aceSpectrum: { label: 'demisexual', heatUnlockTrust: 60 } }
    expect(buildStoryPrompt(story({ character: priya, heat: 4, rel: rel({ trust: 40 }) }))).toContain('Intensity: Flirty:')
    expect(buildStoryPrompt(story({ character: priya, heat: 4, rel: rel({ trust: 61 }) }))).toContain('Intensity: Explicit:')
  })

  it('includes body notes only at heat 4-5', () => {
    for (const heat of [1, 2, 3] as const) {
      const p = buildStoryPrompt(story({ heat }))
      expect(p).not.toContain('freckled shoulders')
      expect(p).not.toContain('Lean, strong shoulders')
      expect(p).toContain('Body: Not relevant at this heat.')
    }
    for (const heat of [4, 5] as const) {
      const p = buildStoryPrompt(story({ heat }))
      expect(p).toContain('Robin Vale, nonbinary, they/them. Body: Soft middle, freckled shoulders, a scar through one eyebrow.')
      expect(p).toContain('Body: Lean, strong shoulders from hauling record crates, tattoos down the left arm only.')
    }
    const blank = buildStoryPrompt(story({ heat: 5, profile: profile({ bodyNotes: '  ' }) }))
    expect(blank).toContain('Robin Vale, nonbinary, they/them.\n')
  })

  it('renders venue, gift, agreement, memory, knownStyle, knownOthers, gossip and rumors', () => {
    const p = buildStoryPrompt(
      story({
        venue: { name: 'Fancy restaurant', feeling: 'hates', note: 'White tablecloths.' },
        gift: { name: 'Flowers', reaction: 'hated' },
        rel: rel({
          agreement: { type: 'exclusive', terms: 'Just us, and we say so if that changes.', madeAt: 1 },
          memory: ['We argued about B-sides.', 'You remembered my set time.'],
          knowsPlayerStyle: true,
          knownOthers: ['kai', 'imani'],
          secretsUnlocked: [0],
        }),
        gossip: ['Imani is into you'],
        rumors: ['Kai still has my records.'],
      }),
    )
    expect(p).toContain('Venue: Fancy restaurant (White tablecloths). Nova Castellanos can\'t stand this place.')
    expect(p).toContain('You brought flowers. Nova Castellanos tries to hide a wince.')
    expect(p).toContain('Agreement: exclusive: Just us, and we say so if that changes')
    expect(p).toContain('Past dates, in Nova Castellanos\'s words: We argued about B-sides. You remembered my set time.')
    expect(p).toContain('how the player dates: Polyamorous:')
    expect(p).toContain('knows about: Kai Okoro and Imani Clarke')
    expect(p).toContain('Partners and exes: Kai Okoro (ex). Gossip Nova Castellanos is happy to share: Imani is into you.')
    expect(p).toContain(
      'Secrets the player has earned: She wrote a song about someone who left and has never played it for anyone. Rumors Nova Castellanos has passed on: Kai still has my records.',
    )
    expect(buildStoryPrompt(story({ gift: { name: 'Rare vinyl', reaction: 'loved' } }))).toContain(
      "You brought rare vinyl. Nova Castellanos lights up; it's exactly right.",
    )
    expect(buildStoryPrompt(story({ gift: { name: 'Houseplant', reaction: 'neutral' } }))).toContain(
      'Nova Castellanos says thanks and means it.',
    )
    expect(buildStoryPrompt(story())).toContain('No gift this time.')
    expect(buildStoryPrompt(story({ venue: { name: 'Arcade', feeling: 'fine' } }))).toContain('is fine with this place')
  })

  it('writes the special turn notes', () => {
    expect(buildStoryPrompt(story({ special: { kind: 'exit' } }))).toContain(
      'Turn 3 of 10. The date has gone badly: write Nova Castellanos leaving.',
    )
    expect(buildStoryPrompt(story({ turn: 10 }))).toContain(
      'Turn 10 of 10. Last turn: bring the date to a natural close and hint at whether Nova Castellanos wants another.',
    )
    expect(buildStoryPrompt(story({ special: { kind: 'dtr', requested: 'exclusive' } }))).toContain(
      'The player wants to define what you two are and is asking for exclusive (only each other). Answer as Nova Castellanos would',
    )
    expect(
      buildStoryPrompt(story({ turn: 0, judge: undefined, firstDate: false, special: { kind: 'epilogue', direction: 'She plays the song' } })),
    ).toContain('arrives and greets the player. Epilogue: She plays the song.')
    expect(buildStoryPrompt(story())).toMatch(/Turn 3 of 10\.\n/)
  })

  it('appends overrides under MOD DIRECTION without touching the base prompt', () => {
    const base = buildStoryPrompt(story())
    const modded = buildStoryPrompt(story(), ['Noir: rain, neon, voiceover.', '', 'Keep it short.'])
    expect(modded.startsWith(base)).toBe(true)
    expect(modded.slice(base.length)).toBe(`\n\n${MOD_DIRECTION_HEADER}\nNoir: rain, neon, voiceover.\n\nKeep it short.`)
    expect(buildStoryPrompt(story(), '  ')).toBe(base)
  })
})

describe('judge prompt', () => {
  const ctx = {
    character: nova,
    rel: rel({ affection: 22, trust: 10, knownOthers: ['kai'] }),
    route: 'romantic' as const,
    names,
    others: ['kai', 'imani'],
    recent: [
      { role: 'character' as const, text: "You're either lost or you have excellent taste." },
      { role: 'player' as const, text: 'Excellent taste,\nobviously.' },
    ],
    message: 'Is that a first pressing?',
  }

  it('fills every placeholder and keeps the JSON shape', () => {
    const p = buildJudgePrompt(ctx)
    expect(p).not.toMatch(LEFTOVER)
    expect(p).toContain('{"delta": 0, "trustDelta": 0, "hits": [{"type": "like", "id": "trait-id"}]')
    expect(p).toContain('Nova Castellanos, stage Acquaintance (22/100, trust 10/100). Woman, she/her. Teasing and quick')
    expect(p).toContain('Likes: vinyl: Vinyl records and liner-note trivia; diner: 3am diner food;')
    expect(p).toContain('Turn-offs: pushy: Pushiness; negging: Backhanded compliments;')
    expect(p).toContain('People the player is seeing: Kai Okoro and Imani Clarke. Of those, Nova Castellanos knows about: Kai Okoro.')
    expect(p).toContain("Nova Castellanos's current opinion: we never agreed to anything; knows about Kai Okoro and doesn't mind\n")
    expect(p).toContain(
      "Recent turns:\nNova Castellanos: You're either lost or you have excellent taste.\nPlayer: Excellent taste, obviously.\n",
    )
    expect(p).toContain("Player's new message: Is that a first pressing?\n")
    expect(p).toContain('Route: romantic. Agreement: none yet.')
    expect(p).not.toContain('(e.g.')
  })

  it('uses a given opinion and renders an agreement with terms', () => {
    const p = buildJudgePrompt({
      ...ctx,
      rel: rel({ agreement: { type: 'exclusive', terms: 'Only us.', madeAt: 1 } }),
      opinion: 'thinks we agreed to be exclusive and just heard about Kai',
      recent: [],
    })
    expect(p).toContain('Agreement: exclusive: Only us.\n')
    expect(p).toContain('current opinion: thinks we agreed to be exclusive and just heard about Kai\n')
    expect(p).toContain('Recent turns: none yet')
  })

  it("tells the judge an ace or demi character's pace, after their personality", () => {
    const demi = { ...nova, aceSpectrum: { label: 'demisexual', heatUnlockTrust: 60 } }
    const p = buildJudgePrompt({ ...ctx, character: demi })
    expect(p).toMatch(
      /Woman, she\/her\. Teasing and quick[^\n]* Demisexual: nothing past heat 2 until trust is over 60, and that is who Nova Castellanos is, not a puzzle\.\n/,
    )
    expect(buildJudgePrompt(ctx)).not.toContain('not a puzzle')
  })
})

describe('agreement prompt', () => {
  it('fills requested agreement, partners and the DTR turns', () => {
    const p = buildAgreementPrompt({
      character: nova,
      rel: rel({ trust: 55 }),
      requested: 'poly',
      names,
      turns: [
        { role: 'player', text: 'Earlier small talk' },
        { role: 'player', text: 'Can we be poly?', dtr: true },
        { role: 'character', text: 'Maybe. Tell me more.', dtr: true },
      ],
    })
    expect(p).not.toMatch(LEFTOVER)
    expect(p).toContain('The player asked for: poly (other partners known to everyone, disclosure expected).')
    expect(p).toContain('Nova Castellanos is open with low jealousy, trusts the player 55/100, and has these partners: none.')
    expect(p).toContain('Conversation:\nPlayer: Can we be poly?\nNova Castellanos: Maybe. Tell me more.\n')
    expect(p).not.toContain('Earlier small talk')
    expect(p).toContain('"terms": "one sentence in Nova Castellanos\'s words"')
  })

  it('renders agreements for the story/judge prompts', () => {
    expect(agreementText({ type: 'none', terms: '', madeAt: 0 })).toBe('none yet')
    expect(agreementText({ type: 'open', terms: '', madeAt: 1 })).toBe('open')
    expect(agreementText({ type: 'exclusive', terms: 'Only us.', madeAt: 1 })).toBe('exclusive: Only us')
  })
})

describe('suggestions prompt', () => {
  it('uses sweet/flirty/bold on a romantic route', () => {
    const p = buildSuggestionsPrompt({ character: nova, rel: rel(), route: 'romantic', heat: 2 })
    expect(p).not.toMatch(LEFTOVER)
    expect(p).toContain('next to Nova Castellanos: one sweet, one flirty, one bold.')
    expect(p).toContain(
      'this intensity: Flirty: innuendo, teasing, making out, suggestive situations, building tension; fade to black before sex. Reply',
    )
    expect(p).toContain('{"sweet": "...", "flirty": "...", "bold": "..."}')
    expect(suggestionKeys('romantic')).toEqual(['sweet', 'flirty', 'bold'])
  })

  it('uses sweet/curious/honest on a friend route', () => {
    const p = buildSuggestionsPrompt({ character: nova, rel: rel(), route: 'friend', heat: 2 })
    expect(p).toContain('one sweet, one curious, one honest.')
    expect(p).toContain('{"sweet": "...", "curious": "...", "honest": "..."}')
    expect(p).not.toMatch(/flirty|bold/)
    expect(suggestionKeys('friend')).toEqual(['sweet', 'curious', 'honest'])
  })

  it('applies the ace heat cap', () => {
    const minh = { ...nova, aceSpectrum: { label: 'asexual', heatCap: 1 as const } }
    expect(buildSuggestionsPrompt({ character: minh, rel: rel(), route: 'romantic', heat: 5 })).toContain(
      'this intensity: Sweet:',
    )
  })
})

describe('memory prompt', () => {
  it('fills the name', () => {
    const p = buildMemoryPrompt({ character: nova })
    expect(p).toBe(
      "Summarize this date in 2–3 sentences in Nova Castellanos's voice: what you did, what you learned about the player, and how you feel about them now. Keep concrete details (places, jokes, promises, anything agreed) that could come up later. Plain text only.",
    )
  })
})

describe('message helpers', () => {
  it('story turn 0 sends the system prompt and "(The date begins.)"', () => {
    expect(makeStoryMessages('SYS', [])).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: DATE_BEGINS },
    ])
  })

  it('story turns alternate assistant/user after the opening, merging repeats', () => {
    const msgs = makeStoryMessages('SYS', [
      { role: 'character', text: 'Opening line.' },
      { role: 'player', text: 'Hi.' },
      { role: 'system', text: 'note' },
      { role: 'character', text: 'Reply one.' },
      { role: 'player', text: 'First.' },
      { role: 'player', text: 'Second.' },
    ])
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user'])
    expect(msgs[5].content).toBe('First.\n\nSecond.')
  })

  it('judge, suggestions and memory messages', () => {
    expect(makeJudgeMessages('J')).toEqual([
      { role: 'system', content: 'J' },
      { role: 'user', content: 'Score the new message.' },
    ])
    const s = makeSuggestionsMessages(
      'S',
      [1, 2, 3, 4, 5].map((n) => ({ role: n % 2 ? ('player' as const) : ('character' as const), text: `t${n}` })),
      { characterName: 'Nova' },
    )
    expect(s[1].content).toBe('Last turns:\nNova: t2\nPlayer: t3\nNova: t4\nPlayer: t5\n\nSuggest the three lines.')
    const m = makeMemoryMessages('M', [{ role: 'player', text: 'Hi' }], { characterName: 'Nova', venue: 'Arcade' })
    expect(m[1].content).toBe('Venue: Arcade.\nThe date:\nPlayer: Hi\n\nWrite the summary.')
    const named = makeMemoryMessages('M', [{ role: 'player', text: 'Hi' }], {
      characterName: 'Nova',
      playerLabel: 'Robin',
      venue: 'Arcade',
      gift: 'a poetry book',
    })
    expect(named[1].content).toBe('Venue: Arcade. Gift: a poetry book.\nThe date:\nRobin: Hi\n\nWrite the summary.')
  })
})

describe('Phase 4 prompt hooks', () => {
  const misgendering = { id: 'misgendering', label: 'Being misgendered or deadnamed' }

  it('fills {knownOthers} from a given text, else the names as before', () => {
    const r = rel({ knownOthers: ['kai'] })
    expect(buildStoryPrompt(story({ rel: r }))).toContain('knows about: Kai Okoro\n')
    expect(buildStoryPrompt(story({ rel: r, knownOthersText: 'Kai Okoro, which breaks it' }))).toContain('knows about: Kai Okoro, which breaks it\n')
    expect(buildStoryPrompt(story({ rel: r, knownOthersText: '  ' }))).toContain('knows about: Kai Okoro\n')
  })

  it('names a hit on an extra trait in the LANDED line', () => {
    const j = judge({ hits: [{ type: 'turnOff', id: 'misgendering' }], mood: 'hurt' })
    expect(buildStoryPrompt(story({ judge: j }))).toContain('Mood: hurt. It hit nothing in particular.')
    expect(buildStoryPrompt(story({ judge: j, extraTraits: { turnOff: [misgendering] } }))).toContain(
      'Mood: hurt. It hit a turn-off: Being misgendered or deadnamed.',
    )
  })

  it('lists extra traits after the card in the judge, and takes a whole {sharedSecrets}', () => {
    const base = {
      character: nova,
      rel: rel(),
      route: 'romantic' as const,
      names,
      others: [],
      recent: [],
      message: 'Hi.',
    }
    const p = buildJudgePrompt({ ...base, extraTraits: { turnOff: [misgendering, { id: 'cute', label: 'Not this one' }] } })
    expect(p).toContain('cute: Being called cute; misgendering: Being misgendered or deadnamed\n')
    expect(p).not.toContain('Not this one')
    expect(buildJudgePrompt(base)).toContain('Known secrets shared with Nova Castellanos: none\n')
    expect(buildJudgePrompt({ ...base, sharedSecretsText: 'the player heard "x" (false)' })).toContain(
      'Known secrets shared with Nova Castellanos: the player heard "x" (false)\n',
    )
  })
})
