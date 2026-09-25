// Endings (docs/SPEC.md, "Endings"; ARCHITECTURE, Engine, endings.ts). Pure.
//
// At 100 affection the character's epilogue unlocks; which ending plays depends on trust,
// agreements and what happened on the way. selectEnding checks, in this order:
//   1. polycule: this character and at least one other at Lover (80) or above, all on poly
//      agreements with the player, every pair approving of each other (metamour 60+)
//   2. reconciliation: a betrayal happened and trust has recovered to 60+
//   3. bitter: a betrayal happened and trust is under 60
//   4. sacrifice: they rekindled with someone else, or they are monogamous and the player never
//      made an agreement with them (none or casual)
//   5. hollow: trust under 40, or connection under 8 (won on heat more than connection)
//   6. open: an open or poly agreement
//   7. good: otherwise (trust 40 to 59 plays it too; the reason then says where trust sits
//      instead of calling it high)
// Each ending has a title, a one-line description and a story direction for the epilogue's turnNote.

import type { AgreementType, Character, EndingType, GameState, Relationship, SetRelationship } from '../types'
import { firstName, RECONCILED_TRUST } from './agreements'
import { allApprove, approval, POLYCULE_APPROVAL } from './metamour'
import { joinAnd } from './stages'

export const POLYCULE_AFFECTION = 80
export const HOLLOW_TRUST = 40
export const HOLLOW_CONNECTION = 8
/** Trust the Good and Open endings' reasons call high; below it (40 to 59) they say where it sits. */
export const HIGH_TRUST = 60

/** Names for an ending's story direction. */
export interface EndingNames {
  /** The character whose epilogue it is. */
  name: string
  /** The player's name (default "the player"). */
  player?: string
  /** The others in a polycule ending. */
  group?: string[]
  /** Who they chose instead (a rekindle behind a Sacrifice ending). */
  rival?: string
  /** The agreement with the player (the Open ending says open or poly). */
  agreement?: AgreementType
  /** A Sacrifice ending because they're monogamous and the player never asked for a promise. */
  unpromised?: boolean
}

export interface EndingInfo {
  title: string
  description: string
  /** The story direction for the epilogue's turnNote. */
  direction: (names: EndingNames) => string
}

const player = (n: EndingNames) => n.player?.trim() || 'the player'

export const ENDINGS: Readonly<Record<EndingType, EndingInfo>> = {
  good: {
    title: 'The good ending',
    description: 'High trust and affection, honest about your feelings and choices. You and them, the future is open.',
    direction: (n) =>
      `${n.name} and ${player(n)} are together, and it's real: honest, easy, the future wide open. Play the date as a quiet celebration of what they built, with callbacks to earlier dates.`,
  },
  open: {
    title: 'The open ending',
    description:
      "You and them with an open or poly agreement you both actually like. Their other partners and yours are part of the picture, not a problem.",
    direction: (n) =>
      `${n.name} and ${player(n)} are together on ${n.agreement === 'poly' ? 'a poly' : 'an open'} agreement they both actually like; other partners are part of the picture, not a problem. Let that ease show: warm, unjealous, a little proud of how well it works.`,
  },
  polycule: {
    title: 'The polycule ending',
    description:
      'Two or more of them at Lover or above with poly agreements, each approving of the others. One epilogue with all of them.',
    direction: (n) => {
      const others = (n.group ?? []).filter(Boolean)
      const everyone = others.length ? `${n.name}, ${joinAnd(others)} and ${player(n)}` : `${n.name} and ${player(n)}`
      return `${everyone} are one polycule now, and everyone approves of everyone. Bring the others into the date or have ${n.name} talk about them with real warmth; it feels like a family that chose itself.`
    },
  },
  bitter: {
    title: 'The bitter ending',
    description:
      "High affection, but trust broke somewhere. They want you but don't trust you. You get to be with them, but it's messy: jealousy, rules, or an expiration date.",
    direction: (n) =>
      `${n.name} still wants ${player(n)}, but the trust broke and never fully came back. They are together, and it's messy: jealousy, rules, maybe an expiration date. Let the tenderness and the doubt sit side by side.`,
  },
  hollow: {
    title: 'The hollow ending',
    description:
      "You won on affection and heat without building real connection. They're with you, and they know it isn't real. They might leave.",
    direction: (n) =>
      `${n.name} is with ${player(n)}, but it runs on chemistry more than connection, and ${n.name} knows it. Keep it charged but a little empty; ${n.name} may say out loud that it isn't real, and may leave.`,
  },
  sacrifice: {
    title: 'The sacrifice ending',
    description:
      'They choose someone else, or their work, over you. You were great, but someone else, or something from their own life, mattered more.',
    direction: (n) => {
      const who = player(n) === 'the player' ? 'The player' : player(n)
      const rival = n.rival?.trim()
      const choice = rival
        ? `${n.name} chooses ${rival} over ${player(n)}.`
        : n.unpromised
          ? `${n.name} wanted a promise ${player(n)} never asked for, and has chosen a life that doesn't wait on one.`
          : `${n.name} chooses work, or a life that was already waiting, over ${player(n)}.`
      return `${choice} ${who} was great; something mattered more. Play it as a kind, sad goodbye with no villain.`
    },
  },
  reconciliation: {
    title: 'The reconciliation ending',
    description: 'You broke them, disappeared, came back, and earned them back.',
    direction: (n) =>
      `${player(n) === 'the player' ? 'The player' : player(n)} broke ${n.name}'s trust once, then earned it back. The date carries both: the scar of what happened and the relief of choosing each other again, eyes open.`,
  },
}

/** The order selectEnding checks them in. */
export const ENDING_PRIORITY: readonly EndingType[] = ['polycule', 'reconciliation', 'bitter', 'sacrifice', 'hollow', 'open', 'good']

export interface EndingContext {
  characterId: string
  /** Active characters by id. */
  characters: Record<string, Character>
  rels: Record<string, Relationship>
  game: GameState
  /** Active sets' relationships, card partners included. */
  relations: SetRelationship[]
  /** Optional display names (for the reason); falls back to the cards. */
  names?: Record<string, string>
}

export interface EndingChoice {
  type: EndingType
  /** A hollow ending's cause: trust under HOLLOW_TRUST, or too little connection. */
  cause?: 'trust' | 'connection'
  /** The polycule: this character first, then the others. */
  group?: string[]
  /** Why, in a sentence the profile can show. */
  reason: string
}

function nameOf(id: string, ctx: EndingContext): string {
  return ctx.names?.[id]?.trim() || ctx.characters[id]?.name || id
}

/**
 * The polycule this character could end in: them plus everyone else at Lover or above on a poly
 * agreement (highest affection first) who approves of everyone already in it. Null when this
 * character isn't at Lover+ on a poly agreement or nobody qualifies.
 */
export function polyculeGroup(ctx: EndingContext): string[] | null {
  const id = ctx.characterId
  const rel = ctx.rels[id]
  const onPoly = (r: Relationship | undefined) => !!r && r.agreement?.type === 'poly' && (r.affection ?? 0) >= POLYCULE_AFFECTION
  if (!onPoly(rel)) return null
  const candidates = Object.keys(ctx.rels)
    .filter((o) => o !== id && !!ctx.characters[o] && onPoly(ctx.rels[o]))
    .sort((a, b) => (ctx.rels[b].affection ?? 0) - (ctx.rels[a].affection ?? 0) || a.localeCompare(b))
  const group = [id]
  for (const o of candidates) {
    if (group.every((m) => approval(ctx.game, m, o, ctx.relations) >= POLYCULE_APPROVAL)) group.push(o)
  }
  return group.length >= 2 && allApprove(ctx.game, group, ctx.relations) ? group : null
}

/** Which ending this character is on (see the order at the top of the file). */
export function selectEnding(ctx: EndingContext): EndingChoice {
  const id = ctx.characterId
  const c = ctx.characters[id]
  const rel = ctx.rels[id]
  const first = firstName(nameOf(id, ctx))
  if (!rel) return { type: 'good', reason: `High trust and affection with ${first}, and honest the whole way.` }
  const trust = Math.round(rel.trust ?? 0)
  const agreement = rel.agreement?.type ?? 'none'

  const group = polyculeGroup(ctx)
  if (group) {
    const who = joinAnd(group.map((g) => firstName(nameOf(g, ctx))))
    const all = group.length === 2 ? 'both' : 'all'
    return { type: 'polycule', group, reason: `${who} are ${all} Lover or above on poly agreements, and approve of each other.` }
  }
  if ((rel.betrayals ?? []).length > 0) {
    if (trust >= RECONCILED_TRUST) {
      return { type: 'reconciliation', reason: `You broke ${first}'s trust once and earned it back (trust ${trust}).` }
    }
    return { type: 'bitter', reason: `${first} still wants you, but trust broke and sits at ${trust}.` }
  }
  if (rel.rekindledWith) {
    return { type: 'sacrifice', reason: `${first} got back together with ${firstName(nameOf(rel.rekindledWith, ctx))} while you were busy.` }
  }
  if (unpromised(c, rel)) {
    return { type: 'sacrifice', reason: `${first} is monogamous, and you never agreed on what you are.` }
  }
  if (trust < HOLLOW_TRUST) {
    return { type: 'hollow', cause: 'trust', reason: `Trust is only ${trust}: the affection is real, the connection isn't.` }
  }
  if ((rel.connection ?? 0) < HOLLOW_CONNECTION) {
    return { type: 'hollow', cause: 'connection', reason: `You won ${first} on chemistry more than connection.` }
  }
  if (agreement === 'open' || agreement === 'poly') {
    const on = `${agreement === 'open' ? 'an open' : 'a poly'} agreement you both like`
    return {
      type: 'open',
      reason: trust >= HIGH_TRUST ? `You and ${first} are on ${on}.` : `You and ${first} are on ${on}, and trust is steady at ${trust}.`,
    }
  }
  return {
    type: 'good',
    reason:
      trust >= HIGH_TRUST
        ? `High trust and affection with ${first}, and honest the whole way.`
        : `Affection with ${first} is all the way up, and trust is steady at ${trust}, with no betrayal on the way.`,
  }
}

/**
 * An ending's description for the player, with the character's first name instead of the spec's
 * "them" ("Nova is with you, and knows it isn't real."). A hollow ending says what it was won on.
 */
export function endingDescription(type: EndingType, first: string, cause?: EndingChoice['cause']): string {
  const f = first.trim() || 'them'
  switch (type) {
    case 'good':
      return `High trust and affection, honest about your feelings and choices. You and ${f}, the future is open.`
    case 'open':
      return `You and ${f} with an open or poly agreement you both actually like. ${possessiveOf(f)} other partners and yours are part of the picture, not a problem.`
    case 'polycule':
      return ENDINGS.polycule.description
    case 'bitter':
      return `High affection, but trust broke somewhere. ${f} wants you but doesn't trust you. You get to be with ${f}, but it's messy: jealousy, rules, or an expiration date.`
    case 'hollow':
      return cause === 'connection'
        ? `You won ${f} on affection and heat without building real connection. ${f} is with you, and knows it isn't real. ${f} might leave.`
        : `You won ${f} on affection more than trust. ${f} is with you, and knows it isn't real. ${f} might leave.`
    case 'sacrifice':
      return `${f} chooses someone else, or work, over you. You were great, but someone else, or something from ${possessiveOf(f)} own life, mattered more.`
    case 'reconciliation':
      return `You broke ${possessiveOf(f)} trust, disappeared, came back, and earned ${f} back.`
  }
  return (ENDINGS as Readonly<Record<string, EndingInfo>>)[type]?.description ?? ''
}

function possessiveOf(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

/** Affection where the profile and recap start saying where trust has the ending heading (Lover). */
export const HEADING_AFFECTION = 80

/**
 * From Lover on a romantic route, with no betrayal on record and trust under HOLLOW_TRUST: where
 * this is heading and what would change it ("Where this is heading: trust 31. Trust of 40 or more
 * is what makes it real."). Empty otherwise.
 */
export function headingLine(
  rel: Pick<Relationship, 'affection' | 'trust' | 'betrayals'>,
  route: 'romantic' | 'friend',
  withLabel = true,
): string {
  if (route !== 'romantic' || (rel.affection ?? 0) < HEADING_AFFECTION || (rel.betrayals ?? []).length > 0) return ''
  const trust = Math.round(rel.trust ?? 0)
  if (trust >= HOLLOW_TRUST) return ''
  const real = `Trust of ${HOLLOW_TRUST} or more is what makes it real.`
  return withLabel ? `Where this is heading: trust ${trust}. ${real}` : `Trust is ${trust}. ${real}`
}

/** The epilogue's story direction for a chosen ending. */
export function endingDirection(
  choice: Pick<EndingChoice, 'type' | 'group'>,
  ctx: {
    characterId: string
    name: string
    player?: string
    names?: Record<string, string>
    rival?: string
    agreement?: AgreementType
    unpromised?: boolean
  },
): string {
  const group = (choice.group ?? [])
    .filter((g) => g !== ctx.characterId)
    .map((g) => ctx.names?.[g]?.trim() || g)
  const names: EndingNames = { name: ctx.name, ...(ctx.player ? { player: ctx.player } : {}), group }
  if (ctx.rival) names.rival = ctx.rival
  if (ctx.agreement) names.agreement = ctx.agreement
  if (ctx.unpromised) names.unpromised = true
  return (ENDINGS[choice.type] ?? ENDINGS.good).direction(names)
}

/** A Sacrifice ending for a monogamous character the player never made a promise with. */
export function unpromised(c: Pick<Character, 'relationshipStyle'> | undefined, rel: Pick<Relationship, 'agreement'> | undefined): boolean {
  const type = rel?.agreement?.type ?? 'none'
  return c?.relationshipStyle === 'monogamous' && (type === 'none' || type === 'casual')
}
