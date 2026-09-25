// Pure helpers behind the polycule map (#/map): who sits where on the constellation, which threads
// connect them, and the plain sentences the person sheet reads out. No React, no stores, and no
// engine calls: the screen works out jealousy, "seeing", opinions and metamour approval with the
// engine (src/engine/agreements.ts, metamour.ts) and hands the results in as facts.

import type { AgreementType, BetrayalEvent, Jealousy, Relationship, SetRelationKind } from '../../types'

/** The player's id on the map (never a character id: character ids are lowercase and hyphenated). */
export const YOU = '@you'

/** Trust at which a betrayal stops showing as tension (the Reconciliation ending's line). */
export const RECOVERED_TRUST = 60

/** Metamour approval the Polycule ending needs (docs/ARCHITECTURE.md, metamour.ts). */
export const APPROVAL_THRESHOLD = 60

/** What the map knows about one character. */
export interface PersonFacts {
  id: string
  /** Full display name. */
  name: string
  accent: string
  setId: string
  jealousy: Jealousy
  agreement: { type: AgreementType; terms: string }
  /** The player is seeing them (engine `seeing`). */
  seeing: boolean
  /** They know about someone the player sees and mind it (engine `isJealous`). */
  jealous: boolean
  /** Ids of people they know the player is seeing. */
  knownOthers: string[]
  betrayals: BetrayalEvent[]
  trust: number
  rekindledWith?: string
  dates: number
  /** Their current opinion as the judge hears it (engine `opinionText`), if any. */
  opinion?: string
}

/** A relationship between two characters, as a manifest (or a card's partners) declares it. */
export interface MapRelation {
  a: string
  b: string
  kind: SetRelationKind
  note?: string
}

export type ThreadKind = 'partner' | 'ex' | 'situationship' | 'rekindled' | 'agreement' | 'seeing' | 'tension'

export interface Thread {
  key: string
  kind: ThreadKind
  from: string
  to: string
  /** Agreement threads: exclusive, open, poly or casual. */
  label?: string
}

const ROMANTIC: readonly SetRelationKind[] = ['partner', 'ex', 'situationship']

/** Which romantic thread wins when a pair has more than one: partner, then situationship, then ex. */
const ROMANTIC_RANK: Record<string, number> = { rekindled: 4, partner: 3, situationship: 2, ex: 1 }

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** "Nova Castellanos" -> "Nova"; a quoted nickname wins (Roxanne "Rox" Delacroix -> Rox). */
export function shortName(name: string, fallback = ''): string {
  const full = (name ?? '').trim()
  if (!full) return fallback
  const nick = /["“”]([^"“”]{1,24})["“”]/.exec(full)
  if (nick?.[1].trim()) return nick[1].trim()
  return full.split(/\s+/)[0]
}

/** Up to two initials: "Nova Castellanos" -> "NC", "Kai" -> "K". */
export function initials(name: string): string {
  const words = (name ?? '')
    .replace(/["“”]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0][0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

/**
 * A betrayal still shows as tension while trust is under 60 since it (the engine's jealousNow and
 * the Reconciliation line).
 */
export function betrayalTension(p: Pick<PersonFacts, 'betrayals' | 'trust'>): boolean {
  return p.betrayals.length > 0 && p.trust < RECOVERED_TRUST
}

/** True when anything about this person is tense: jealousy or a betrayal they haven't got over. */
export function hasTension(p: PersonFacts): boolean {
  return p.jealous || betrayalTension(p)
}

/**
 * Every thread on the map. Between characters: partner, ex and situationship threads (a rekindle
 * replaces the pair's old thread). Between the player and a character: a brass agreement thread
 * labelled with the agreement, or a faint one while they're seeing each other with no agreement.
 * Tension is one lipstick thread per pair: a jealous character to each person they know about and
 * mind, and a betrayal to the person it was about (or to the player, for a lie).
 */
export function buildThreads(people: readonly PersonFacts[], relations: readonly MapRelation[]): Thread[] {
  const here = new Set(people.map((p) => p.id))
  const romantic = new Map<string, Thread>()
  const put = (t: Thread) => {
    const key = pairKey(t.from, t.to)
    const prev = romantic.get(key)
    if (!prev || (ROMANTIC_RANK[t.kind] ?? 0) > (ROMANTIC_RANK[prev.kind] ?? 0)) romantic.set(key, { ...t, key: `r:${key}` })
  }
  for (const r of relations) {
    if (!ROMANTIC.includes(r.kind) || r.a === r.b || !here.has(r.a) || !here.has(r.b)) continue
    put({ key: '', kind: r.kind as ThreadKind, from: r.a, to: r.b })
  }
  for (const p of people) {
    if (p.rekindledWith && p.rekindledWith !== p.id && here.has(p.rekindledWith)) {
      put({ key: '', kind: 'rekindled', from: p.id, to: p.rekindledWith })
    }
  }

  const out: Thread[] = [...romantic.values()]
  for (const p of people) {
    const type = p.agreement.type
    if (type && type !== 'none') out.push({ key: `a:${p.id}`, kind: 'agreement', from: YOU, to: p.id, label: type })
    else if (p.seeing) out.push({ key: `s:${p.id}`, kind: 'seeing', from: YOU, to: p.id })
  }

  const tense = new Map<string, Thread>()
  const tension = (a: string, b: string) => {
    if (a === b) return
    const key = pairKey(a, b)
    if (!tense.has(key)) tense.set(key, { key: `t:${key}`, kind: 'tension', from: a, to: b })
  }
  for (const p of people) {
    if (p.jealous) {
      const known = p.knownOthers.filter((id) => here.has(id) && id !== p.id)
      if (known.length) known.forEach((id) => tension(p.id, id))
      else tension(p.id, YOU)
    }
    if (betrayalTension(p)) {
      for (const b of p.betrayals) tension(p.id, b.about && here.has(b.about) ? b.about : YOU)
    }
  }
  return [...out, ...tense.values()]
}

// ---------------------------------------------------------------------------
// Layout: the player in the middle, everyone else on rings around them

export const NODE_R = 22
export const YOU_R = 34
/** Hit radius around a node (a 48px target at the smallest scale the map is drawn at). */
export const HIT_R = 30
/** Space along a ring per person (the circle plus room for the name under it). */
export const SLOT = 66
const MIN_RING = 118
const MAX_SINGLE_RING = 170
const FIRST_RING = 160
const RING_STEP = 76
const LABEL_ROOM = 34
const MARGIN = 10

export interface Placed {
  id: string
  x: number
  y: number
  r: number
}

export interface MapLayout {
  width: number
  height: number
  you: Placed
  people: Placed[]
}

/** How many people fit on a ring of this radius. */
export function ringCapacity(radius: number): number {
  return Math.max(1, Math.floor((2 * Math.PI * radius) / SLOT))
}

/**
 * The order people sit in around the rings: by set and card order, with partners, exes and
 * situationships next to each other so their threads stay short, and the people the player is
 * involved with spread evenly round (the first of them at the top).
 */
export function mapOrder(people: readonly PersonFacts[], relations: readonly MapRelation[]): string[] {
  const ids = people.map((p) => p.id)
  const here = new Set(ids)
  const links = new Map<string, string[]>()
  const link = (a: string, b: string) => {
    if (!here.has(a) || !here.has(b) || a === b) return
    links.set(a, [...(links.get(a) ?? []), b])
    links.set(b, [...(links.get(b) ?? []), a])
  }
  for (const r of relations) if (ROMANTIC.includes(r.kind)) link(r.a, r.b)
  for (const p of people) if (p.rekindledWith) link(p.id, p.rekindledWith)

  // Clusters of linked people, in the order their first member appears.
  const seen = new Set<string>()
  const clusters: string[][] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    const cluster: string[] = []
    const visit = (x: string) => {
      if (seen.has(x)) return
      seen.add(x)
      cluster.push(x)
      for (const y of links.get(x) ?? []) visit(y)
    }
    visit(id)
    clusters.push(cluster)
  }
  const byId = new Map(people.map((p) => [p.id, p]))
  const involved = (c: string[]) =>
    c.some((id) => {
      const p = byId.get(id)
      return !!p && (p.seeing || (p.agreement.type && p.agreement.type !== 'none'))
    })
  // People the player is involved with are spread round the ring, so their brass threads fan out
  // from the middle instead of bunching on one side.
  const first = clusters.filter(involved)
  const rest = clusters.filter((c) => !involved(c))
  if (first.length === 0) return rest.flat()
  const out: string[][] = []
  const gap = rest.length / first.length
  let taken = 0
  first.forEach((cluster, i) => {
    out.push(cluster)
    const upto = Math.round(gap * (i + 1))
    while (taken < upto && taken < rest.length) out.push(rest[taken++])
  })
  while (taken < rest.length) out.push(rest[taken++])
  return out.flat()
}

/** Ring radii and how many sit on each, for n people. */
export function rings(n: number): { radius: number; count: number }[] {
  if (n <= 0) return []
  // One ring while it stays a reasonable size (up to 16 people); beyond that, rings of growing
  // radius, each spreading its people evenly.
  const single = Math.max(MIN_RING, Math.ceil((n * SLOT) / (2 * Math.PI)))
  if (single <= MAX_SINGLE_RING) return [{ radius: single, count: n }]
  const out: { radius: number; count: number }[] = []
  let left = n
  let radius = FIRST_RING
  while (left > 0) {
    const count = Math.min(left, ringCapacity(radius))
    out.push({ radius, count })
    left -= count
    radius += RING_STEP
  }
  return out
}

/** Place the player in the middle and everyone in `order` on the rings, starting at the top. */
export function layoutMap(order: readonly string[]): MapLayout {
  const plan = rings(order.length)
  const outer = plan.length ? plan[plan.length - 1].radius : 0
  const half = Math.max(outer + NODE_R + LABEL_ROOM + MARGIN, YOU_R + LABEL_ROOM + MARGIN, 150)
  const size = Math.round(half * 2)
  const c = size / 2
  const people: Placed[] = []
  let i = 0
  plan.forEach((ring, ringIndex) => {
    // Alternate rings start half a step round, so threads to the inner ring pass between people.
    const offset = ringIndex % 2 === 1 ? Math.PI / ring.count : 0
    for (let k = 0; k < ring.count; k++) {
      const angle = -Math.PI / 2 + offset + (2 * Math.PI * k) / ring.count
      people.push({
        id: order[i++],
        x: round1(c + ring.radius * Math.cos(angle)),
        y: round1(c + ring.radius * Math.sin(angle)),
        r: NODE_R,
      })
    }
  })
  return { width: size, height: size, you: { id: YOU, x: c, y: c, r: YOU_R }, people }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** A thread's end points, trimmed to the edges of the two circles. */
export function threadLine(a: Placed, b: Placed): { x1: number; y1: number; x2: number; y2: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy) || 1
  const ux = dx / d
  const uy = dy / d
  return {
    x1: round1(a.x + ux * a.r),
    y1: round1(a.y + uy * a.r),
    x2: round1(b.x - ux * b.r),
    y2: round1(b.y - uy * b.r),
  }
}

/**
 * A tension thread: a gentle curve between the two circles, so it never hides a straight thread
 * between the same pair. Returns an SVG path.
 */
export function tensionPath(a: Placed, b: Placed): string {
  const { x1, y1, x2, y2 } = threadLine(a, b)
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const d = Math.hypot(dx, dy) || 1
  const bend = Math.min(28, d * 0.22)
  const cx = round1(mx - (dy / d) * bend)
  const cy = round1(my + (dx / d) * bend)
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
}

/** A box on the canvas, centre and size. */
interface Box {
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: Box, b: Box, pad = 3): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w + pad * 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h + pad * 2
}

/** Where a person's name goes: above the circle in the top half (clear of threads to the middle), else below. */
export interface NameSpot {
  id: string
  x: number
  /** Text baseline. */
  y: number
}

export interface TagSpot {
  key: string
  label: string
  x: number
  y: number
  w: number
}

export const NAME_FONT = 12
export const TAG_H = 17

/** Rough text widths (the canvas can't measure before it draws). */
function nameWidth(text: string): number {
  return text.length * 7 + 4
}

export function tagWidth(label: string): number {
  return label.length * 6.4 + 14
}

/**
 * Names and agreement tags laid out so they don't sit on each other: each name above or below its
 * circle, each tag slid along its thread to the first spot that's clear of names, circles and the
 * tags already placed (the middle of the thread when everything is clear).
 */
export function labelLayout(
  layout: MapLayout,
  threads: readonly Thread[],
  nameOf: (id: string) => string,
): { names: NameSpot[]; tags: TagSpot[] } {
  const c = layout.you
  const names: NameSpot[] = []
  const blocked: Box[] = [{ x: c.x, y: c.y, w: c.r * 2, h: c.r * 2 }]
  for (const p of layout.people) {
    blocked.push({ x: p.x, y: p.y, w: p.r * 2, h: p.r * 2 })
    const above = p.y < c.y - 8
    const y = above ? p.y - p.r - 7 : p.y + p.r + NAME_FONT + 2
    names.push({ id: p.id, x: p.x, y: round1(y) })
    blocked.push({ x: p.x, y: y - NAME_FONT / 2 + 1, w: nameWidth(nameOf(p.id)), h: NAME_FONT + 2 })
  }
  const byId = new Map(layout.people.map((p) => [p.id, p]))
  const tags: TagSpot[] = []
  const steps = [0.5, 0.36, 0.64, 0.24, 0.76, 0.14, 0.86]
  for (const t of threads) {
    if (t.kind !== 'agreement' || !t.label) continue
    const to = byId.get(t.to)
    if (!to) continue
    const { x1, y1, x2, y2 } = threadLine(c, to)
    const w = tagWidth(t.label)
    const len = Math.hypot(x2 - x1, y2 - y1) || 1
    // Along the thread first; then nudged to either side of it when neighbours crowd the middle.
    const nx = -(y2 - y1) / len
    const ny = (x2 - x1) / len
    let spot: Box | null = null
    search: for (const side of [0, 1, -1]) {
      for (const k of steps) {
        const box = { x: x1 + (x2 - x1) * k + nx * side * 12, y: y1 + (y2 - y1) * k + ny * side * 12, w, h: TAG_H }
        if (!blocked.some((b) => overlaps(box, b))) {
          spot = box
          break search
        }
      }
    }
    spot ??= { x: x1 + (x2 - x1) * 0.5, y: y1 + (y2 - y1) * 0.5, w, h: TAG_H }
    blocked.push(spot)
    tags.push({ key: t.key, label: t.label, x: round1(spot.x), y: round1(spot.y), w: round1(w) })
  }
  return { names, tags }
}

// ---------------------------------------------------------------------------
// Sentences

function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function nameOf(id: string, names: Readonly<Record<string, string>>): string {
  return shortName(names[id] ?? '', id)
}

const AGREED: Record<Exclude<AgreementType, 'none'>, string> = {
  exclusive: 'agreed to exclusive',
  open: 'agreed to keep it open',
  poly: 'agreed on poly',
  casual: 'agreed to keep it casual',
}

/** The agreement word for a thread label or a list line: "exclusive", "open", "poly", "casual". */
export function agreementWord(type: AgreementType): string {
  return type === 'none' ? 'no agreement' : type
}

const ROMANTIC_SENTENCE: Record<string, (a: string, b: string) => string> = {
  partner: (a, b) => `${a} and ${b} are partners.`,
  ex: (a, b) => `${a} and ${b} used to date.`,
  situationship: (a, b) => `${a} and ${b} have a situationship.`,
  rekindled: (a, b) => `${a} and ${b} found their way back to each other.`,
}

export interface SentenceContext {
  names: Readonly<Record<string, string>>
  relations: readonly MapRelation[]
  /** Other people the player is seeing (ids), for "doesn't know about anyone else". */
  othersYouSee: readonly string[]
  /** Everyone on the map, for metamour lines. */
  people: readonly PersonFacts[]
  /** Metamour approval between two characters, 0 to 100 (engine `approval`). */
  approval?: (a: string, b: string) => number
}

/**
 * The person sheet, in plain sentences: "Nova knows you're seeing Kai and doesn't care." "Sol
 * thinks you two agreed to exclusive." Then betrayals, their own partners and exes, and how they
 * get on with metamours under a poly agreement.
 */
export function personSentences(p: PersonFacts, ctx: SentenceContext): string[] {
  const first = shortName(p.name, p.id)
  const out: string[] = []
  const here = new Set(ctx.people.map((x) => x.id))

  // Agreement.
  const type = p.agreement.type ?? 'none'
  if (type !== 'none') {
    out.push(`${first} thinks you two ${AGREED[type]}.`)
  } else if (p.seeing) {
    out.push(`You two haven't agreed on anything, so seeing other people breaks no promises.`)
  } else if (p.dates === 0) {
    out.push(`You haven't been out with ${first} yet.`)
  }

  // Who they know about.
  const known = p.knownOthers.filter((id) => id !== p.id && here.has(id))
  if (known.length) {
    const who = joinAnd(known.map((id) => nameOf(id, ctx.names)))
    const feeling = p.jealous ? 'and minds' : p.jealousy === 'compersion' ? 'and is happy for you' : "and doesn't care"
    out.push(`${first} knows you're seeing ${who} ${feeling}.`)
  } else if (p.jealous) {
    out.push(`${first} knows you're seeing someone else, and minds.`)
  } else if (p.seeing && ctx.othersYouSee.some((id) => id !== p.id)) {
    out.push(`${first} doesn't know about anyone else you're seeing.`)
  }

  // Betrayals: the last one, in the engine's note ("Heard about Kai from you after you agreed to
  // be exclusive.") with their name in front, and whether they've got over it.
  if (p.betrayals.length) {
    out.push(betrayalSentence(p.betrayals[p.betrayals.length - 1], first, ctx.names))
    out.push(betrayalTension(p) ? `${first} hasn't let it go.` : `${first} trusts you again, mostly.`)
  }

  // Their own partners and exes.
  const lines = new Map<string, string>()
  for (const r of ctx.relations) {
    if (!ROMANTIC.includes(r.kind)) continue
    const other = r.a === p.id ? r.b : r.b === p.id ? r.a : null
    if (!other || !here.has(other)) continue
    const prev = lines.get(other)
    if (!prev || (ROMANTIC_RANK[r.kind] ?? 0) > (ROMANTIC_RANK[prev] ?? 0)) lines.set(other, r.kind)
  }
  if (p.rekindledWith && here.has(p.rekindledWith)) lines.set(p.rekindledWith, 'rekindled')
  for (const [other, kind] of lines) out.push(ROMANTIC_SENTENCE[kind](first, nameOf(other, ctx.names)))

  // Metamours under poly.
  if (type === 'poly' && ctx.approval) {
    for (const q of ctx.people) {
      if (q.id === p.id || q.agreement.type !== 'poly') continue
      const other = nameOf(q.id, ctx.names)
      out.push(
        ctx.approval(p.id, q.id) >= APPROVAL_THRESHOLD
          ? `${first} gets along with ${other}.`
          : `${first} isn't sold on ${other} yet.`,
      )
    }
  }
  return out
}

/**
 * A betrayal as a sentence about them: the event's note with their name in front ("Sol heard about
 * Kai through the grapevine after you agreed to be exclusive."), or a plain line when it has none.
 */
export function betrayalSentence(b: BetrayalEvent, first: string, names: Readonly<Record<string, string>>): string {
  const note = (b.note ?? '').trim().replace(/^["“]|["”]$/g, '').replace(/[.!]+$/, '').trim()
  if (note && !/^(i|we|you)\b/i.test(note)) {
    const lead = /^[A-Z][a-z]/.test(note) ? note.charAt(0).toLowerCase() + note.slice(1) : note
    return `${first} ${lead}.`
  }
  const about = b.about ? nameOf(b.about, names) : ''
  if (b.kind === 'lie' || !about) return `${first} caught you in a lie.`
  return `${first} found out about ${about}, and it broke what you two agreed.`
}

/** The agreement's terms in their words, when there are any. */
export function termsLine(p: Pick<PersonFacts, 'name' | 'id' | 'agreement'>): string {
  const terms = (p.agreement.terms ?? '').trim()
  if (!terms || p.agreement.type === 'none') return ''
  return terms
}

/** One line for the list fallback under the map: the thread's state in a few words. */
export function listLine(p: PersonFacts): string {
  const parts: string[] = []
  const type = p.agreement.type ?? 'none'
  if (type !== 'none') parts.push(`Agreed on ${agreementWord(type)}`)
  else if (p.seeing) parts.push('Seeing each other, no agreement')
  else if (p.dates > 0) parts.push(p.dates === 1 ? 'One date' : `${p.dates} dates`)
  else parts.push('Not met yet')
  if (p.jealous) parts.push('minds who else you see')
  else if (betrayalTension(p)) parts.push("hasn't forgiven you")
  return capitalizeFirst(parts.join(', ')) + '.'
}

function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** A short summary of the whole map for screen readers. */
export function mapSummary(people: readonly PersonFacts[]): string {
  const agreements = people.filter((p) => p.agreement.type !== 'none').length
  const tense = people.filter(hasTension).length
  const n = people.length
  const who = `${n} ${n === 1 ? 'person' : 'people'} around you`
  const a = agreements === 0 ? 'no agreements' : agreements === 1 ? 'one agreement' : `${agreements} agreements`
  const t = tense === 0 ? 'no tension' : tense === 1 ? 'tension with one person' : `tension with ${tense} people`
  return `${who}, ${a}, ${t}.`
}

/** Facts for a character from their relationship; the engine-derived parts come in `derived`. */
export function personFacts(
  c: { id: string; name: string; accent: string; jealousy: Jealousy },
  setId: string,
  rel: Relationship,
  derived: { seeing: boolean; jealous: boolean; opinion?: string; known?: string[] },
): PersonFacts {
  const out: PersonFacts = {
    id: c.id,
    name: c.name.trim() || c.id,
    accent: c.accent,
    setId,
    jealousy: c.jealousy,
    agreement: { type: rel.agreement?.type ?? 'none', terms: rel.agreement?.terms ?? '' },
    seeing: derived.seeing,
    jealous: derived.jealous,
    knownOthers: [...(derived.known ?? rel.knownOthers ?? [])],
    betrayals: [...(rel.betrayals ?? [])],
    trust: rel.trust ?? 0,
    dates: rel.dates ?? 0,
  }
  // A rekindle draws its thread either way: a door closing or an invite to join them.
  const rekindled = rel.rekindledWith || rel.rekindle?.with
  if (rekindled) out.rekindledWith = rekindled
  const opinion = derived.opinion?.trim()
  if (opinion) out.opinion = opinion
  return out
}
