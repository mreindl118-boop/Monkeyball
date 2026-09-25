// The fourteen date venues (docs/SPEC.md, "Venues (14)"). Ids are fixed: character cards,
// saves and the date engine refer to them. Each venue has a CSS backdrop made only of layered
// gradients plus a few simple shapes that the Backdrop component draws on top (no photos).
//
// Shape geometry is in percent of the backdrop box: x/y are the top-left corner, w/h the size.
// Blurs stay small and shapes stay few so mid-range Android phones keep scrolling smoothly.

import { stageFor, stageLabel } from '../engine/stages'
import type { Venue } from '../types'

/** Venue ids in SPEC order. */
export const VENUE_IDS = [
  'record-store',
  'rooftop-bar',
  'karaoke-box',
  'arcade',
  'boardwalk',
  'art-museum',
  'night-market',
  'climbing-gym',
  'fancy-restaurant',
  'bookstore-cafe',
  'amusement-park',
  'hot-spring',
  'queer-bar',
  'home',
] as const

export type VenueId = (typeof VENUE_IDS)[number]

/** Affection needed for home (Lover). */
export const HOME_AFFECTION = 80

export const VENUES: readonly Venue[] = [
  {
    id: 'record-store',
    name: 'Record store',
    description: 'Crates of secondhand vinyl, a listening booth and a clerk with strong opinions.',
    backdrop: [
      'radial-gradient(ellipse 70% 45% at 22% 8%, rgb(255 184 107 / 0.42), transparent 70%)',
      'radial-gradient(ellipse 45% 30% at 85% 18%, rgb(224 36 94 / 0.22), transparent 70%)',
      'repeating-linear-gradient(90deg, rgb(0 0 0 / 0.24) 0 3px, transparent 3px 44px)',
      'linear-gradient(180deg, #3d1e16 0%, #28120f 55%, #140807 100%)',
    ].join(', '),
    shapes: [
      { kind: 'rect', x: 6, y: 68, w: 46, h: 26, color: '#5c2f1d', opacity: 0.9, rotate: -2 },
      { kind: 'rect', x: 50, y: 72, w: 44, h: 24, color: '#4a2417', opacity: 0.9, rotate: 3 },
      { kind: 'circle', x: 58, y: 34, w: 34, h: 34, color: '#0d0608', opacity: 0.9 },
      { kind: 'circle', x: 70, y: 46, w: 10, h: 10, color: '#e0245e', opacity: 0.85 },
      { kind: 'line', x: 4, y: 64, w: 92, h: 0.6, color: '#ffb86b', opacity: 0.35 },
    ],
  },
  {
    id: 'rooftop-bar',
    name: 'Rooftop bar',
    description: 'String lights, a skyline that never sleeps and cocktails priced like the view.',
    backdrop: [
      'radial-gradient(ellipse 90% 40% at 50% 105%, rgb(255 140 90 / 0.45), transparent 70%)',
      'radial-gradient(circle at 80% 14%, rgb(255 236 200 / 0.5) 0 2.5%, transparent 3.5%)',
      'linear-gradient(0deg, #12081c 0 22%, transparent 22%)',
      'linear-gradient(180deg, #170d33 0%, #3d1d4d 42%, #7e3452 72%, #d9735c 100%)',
    ].join(', '),
    shapes: [
      { kind: 'rect', x: 4, y: 58, w: 12, h: 22, color: '#1a0d24', opacity: 0.95 },
      { kind: 'rect', x: 18, y: 48, w: 10, h: 32, color: '#140a1e', opacity: 0.95 },
      { kind: 'rect', x: 66, y: 52, w: 14, h: 28, color: '#1a0d24', opacity: 0.95 },
      { kind: 'rect', x: 84, y: 62, w: 12, h: 18, color: '#140a1e', opacity: 0.95 },
      { kind: 'line', x: 0, y: 30, w: 100, h: 0.5, color: '#ffd68c', opacity: 0.6, rotate: -4 },
    ],
  },
  {
    id: 'karaoke-box',
    name: 'Karaoke box',
    description: 'A private room, a sticky microphone and a song list longer than your night.',
    backdrop: [
      'radial-gradient(circle at 30% 25%, rgb(255 64 170 / 0.45), transparent 45%)',
      'radial-gradient(circle at 75% 35%, rgb(64 220 255 / 0.35), transparent 45%)',
      'conic-gradient(from 200deg at 50% 0%, transparent 0deg, rgb(255 255 255 / 0.06) 20deg, transparent 40deg, rgb(255 255 255 / 0.06) 60deg, transparent 80deg)',
      'linear-gradient(180deg, #241036 0%, #1a0b28 60%, #0e0616 100%)',
    ].join(', '),
    shapes: [
      { kind: 'circle', x: 42, y: 6, w: 16, h: 16, color: '#f2c6cf', opacity: 0.55 },
      { kind: 'rect', x: 18, y: 58, w: 64, h: 30, color: '#0b0512', opacity: 0.8 },
      { kind: 'stripe', x: 18, y: 60, w: 64, h: 2, color: '#40dcff', opacity: 0.7 },
      { kind: 'line', x: 50, y: 22, w: 0.6, h: 30, color: '#ff40aa', opacity: 0.6 },
    ],
  },
  {
    id: 'arcade',
    name: 'Arcade',
    description: 'Old cabinets humming in the dark and a claw machine that never pays out.',
    backdrop: [
      'repeating-linear-gradient(0deg, rgb(255 64 200 / 0.28) 0 1px, transparent 1px 28px)',
      'repeating-linear-gradient(90deg, rgb(64 200 255 / 0.22) 0 1px, transparent 1px 36px)',
      'radial-gradient(ellipse 80% 45% at 50% 100%, rgb(255 64 200 / 0.3), transparent 70%)',
      'linear-gradient(180deg, #07061a 0%, #120a2e 55%, #26103d 100%)',
    ].join(', '),
    shapes: [
      { kind: 'rect', x: 6, y: 34, w: 24, h: 52, color: '#1b1242', opacity: 0.95 },
      { kind: 'rect', x: 9, y: 38, w: 18, h: 14, color: '#40c8ff', opacity: 0.55, blur: 2 },
      { kind: 'rect', x: 70, y: 30, w: 24, h: 56, color: '#1b1242', opacity: 0.95 },
      { kind: 'rect', x: 73, y: 34, w: 18, h: 14, color: '#ff40c8', opacity: 0.55, blur: 2 },
      { kind: 'circle', x: 44, y: 12, w: 12, h: 12, color: '#fff27a', opacity: 0.7 },
    ],
  },
  {
    id: 'boardwalk',
    name: 'Boardwalk',
    description: 'Salt air, planks under your feet and the pier lights doubled in the water.',
    backdrop: [
      'radial-gradient(circle at 72% 18%, rgb(255 244 214 / 0.8) 0 3%, rgb(255 244 214 / 0.12) 7%, transparent 16%)',
      'repeating-linear-gradient(180deg, rgb(120 200 230 / 0.12) 0 2px, transparent 2px 14px)',
      'linear-gradient(180deg, #0b1330 0%, #14284a 45%, #0d3a4f 62%, #06202e 100%)',
    ].join(', '),
    shapes: [
      { kind: 'stripe', x: 70, y: 40, w: 4, h: 34, color: '#fff4d6', opacity: 0.28, blur: 3 },
      { kind: 'rect', x: 0, y: 80, w: 100, h: 20, color: '#3a2418', opacity: 0.95 },
      { kind: 'stripe', x: 0, y: 84, w: 100, h: 1, color: '#1d110b', opacity: 0.8 },
      { kind: 'line', x: 0, y: 54, w: 100, h: 0.4, color: '#ffd68c', opacity: 0.5 },
    ],
  },
  {
    id: 'art-museum',
    name: 'Art museum',
    description: 'Quiet white rooms, a late opening and one painting you keep coming back to.',
    backdrop: [
      'conic-gradient(from 160deg at 30% 0%, transparent 0deg, rgb(255 246 230 / 0.16) 20deg, transparent 40deg)',
      'conic-gradient(from 160deg at 72% 0%, transparent 0deg, rgb(255 246 230 / 0.16) 20deg, transparent 40deg)',
      'linear-gradient(0deg, #6b5f5a 0 18%, transparent 18%)',
      'linear-gradient(180deg, #3b3236 0%, #4d4447 60%, #5c5250 100%)',
    ].join(', '),
    shapes: [
      { kind: 'rect', x: 16, y: 28, w: 28, h: 30, color: '#c9a45c', opacity: 0.9 },
      { kind: 'rect', x: 19, y: 31, w: 22, h: 24, color: '#4a1530', opacity: 0.95 },
      { kind: 'rect', x: 58, y: 24, w: 26, h: 36, color: '#c9a45c', opacity: 0.9 },
      { kind: 'rect', x: 61, y: 27, w: 20, h: 30, color: '#1f3b4d', opacity: 0.95 },
      { kind: 'line', x: 0, y: 82, w: 100, h: 0.5, color: '#f2e6d8', opacity: 0.35 },
    ],
  },
  {
    id: 'night-market',
    name: 'Night market',
    description: 'Paper lanterns, noodle steam and a hundred stalls selling things you didn\'t know you wanted.',
    backdrop: [
      'radial-gradient(ellipse 60% 30% at 50% 100%, rgb(255 170 80 / 0.4), transparent 70%)',
      'radial-gradient(ellipse 40% 25% at 30% 70%, rgb(255 255 255 / 0.1), transparent 70%)',
      'linear-gradient(180deg, #1a0a14 0%, #2e1020 50%, #4a1a1c 100%)',
    ].join(', '),
    shapes: [
      { kind: 'line', x: 0, y: 16, w: 100, h: 0.4, color: '#2a1410', opacity: 0.9, rotate: 3 },
      { kind: 'circle', x: 10, y: 18, w: 11, h: 11, color: '#ff5a3c', opacity: 0.85, blur: 1 },
      { kind: 'circle', x: 38, y: 20, w: 11, h: 11, color: '#ffa640', opacity: 0.85, blur: 1 },
      { kind: 'circle', x: 66, y: 22, w: 11, h: 11, color: '#ff5a3c', opacity: 0.85, blur: 1 },
      { kind: 'circle', x: 30, y: 58, w: 26, h: 20, color: '#f2e6e0', opacity: 0.12, blur: 12 },
    ],
  },
  {
    id: 'climbing-gym',
    name: 'Climbing gym',
    description: 'Chalk dust, bright holds and someone spotting you from below.',
    backdrop: [
      'repeating-linear-gradient(115deg, rgb(255 255 255 / 0.05) 0 2px, transparent 2px 60px)',
      'radial-gradient(ellipse 70% 40% at 50% 0%, rgb(255 255 255 / 0.2), transparent 70%)',
      'linear-gradient(160deg, #3c4a5c 0%, #2c3646 55%, #1b212c 100%)',
    ].join(', '),
    shapes: [
      { kind: 'circle', x: 20, y: 22, w: 7, h: 7, color: '#e0245e', opacity: 0.95 },
      { kind: 'circle', x: 58, y: 34, w: 8, h: 8, color: '#f5c542', opacity: 0.95 },
      { kind: 'circle', x: 34, y: 52, w: 6, h: 6, color: '#3fb8af', opacity: 0.95 },
      { kind: 'circle', x: 72, y: 64, w: 7, h: 7, color: '#9b5de5', opacity: 0.95 },
      { kind: 'rect', x: 0, y: 88, w: 100, h: 12, color: '#1a1f29', opacity: 0.95 },
    ],
  },
  {
    id: 'fancy-restaurant',
    name: 'Fancy restaurant',
    description: 'White tablecloths, candlelight and a wine list with its own table of contents.',
    backdrop: [
      'radial-gradient(circle at 50% 62%, rgb(255 196 120 / 0.5) 0 2%, rgb(255 170 90 / 0.18) 8%, transparent 26%)',
      'radial-gradient(ellipse 80% 50% at 50% 0%, rgb(201 164 92 / 0.18), transparent 70%)',
      'linear-gradient(0deg, #e9ddd0 0 24%, transparent 24%)',
      'linear-gradient(180deg, #2b0c16 0%, #3d1020 60%, #2a0a14 100%)',
    ].join(', '),
    shapes: [
      { kind: 'rect', x: 47, y: 62, w: 6, h: 14, color: '#f6efe6', opacity: 0.95 },
      { kind: 'circle', x: 48, y: 55, w: 4, h: 6, color: '#ffc478', opacity: 0.95, blur: 1 },
      { kind: 'line', x: 10, y: 76, w: 80, h: 0.4, color: '#c9a45c', opacity: 0.7 },
      { kind: 'rect', x: 8, y: 12, w: 20, h: 36, color: '#c9a45c', opacity: 0.18 },
    ],
  },
  {
    id: 'bookstore-cafe',
    name: 'Bookstore cafe',
    description: 'Open all night: strong coffee, worn armchairs and shelves up to the ceiling.',
    backdrop: [
      'radial-gradient(ellipse 50% 35% at 70% 30%, rgb(255 200 130 / 0.35), transparent 70%)',
      'repeating-linear-gradient(180deg, rgb(20 8 6 / 0.55) 0 4px, transparent 4px 70px)',
      'repeating-linear-gradient(90deg, rgb(140 60 50 / 0.35) 0 9px, rgb(60 90 80 / 0.3) 9px 16px, rgb(170 130 70 / 0.3) 16px 24px, transparent 24px 30px)',
      'linear-gradient(180deg, #2c1712 0%, #22110d 100%)',
    ].join(', '),
    shapes: [
      { kind: 'circle', x: 64, y: 18, w: 14, h: 14, color: '#ffc882', opacity: 0.55, blur: 6 },
      { kind: 'rect', x: 10, y: 66, w: 40, h: 26, color: '#5a2a24', opacity: 0.95, rotate: -1 },
      { kind: 'circle', x: 62, y: 74, w: 9, h: 9, color: '#f2e6d8', opacity: 0.9 },
    ],
  },
  {
    id: 'amusement-park',
    name: 'Amusement park',
    description: 'A lit-up Ferris wheel, cotton candy and screaming on purpose.',
    backdrop: [
      'radial-gradient(circle at 62% 38%, transparent 0 21%, rgb(255 214 120 / 0.55) 21.5% 22.5%, transparent 23%)',
      'repeating-conic-gradient(from 0deg at 62% 38%, rgb(255 214 120 / 0.22) 0deg 2deg, transparent 2deg 30deg)',
      'radial-gradient(ellipse 90% 40% at 50% 100%, rgb(255 90 140 / 0.35), transparent 70%)',
      'linear-gradient(180deg, #120c2c 0%, #2a1446 55%, #4d1d4a 100%)',
    ].join(', '),
    shapes: [
      { kind: 'circle', x: 60, y: 36, w: 5, h: 5, color: '#ffd678', opacity: 0.9 },
      { kind: 'rect', x: 8, y: 70, w: 26, h: 18, color: '#1e1030', opacity: 0.95 },
      { kind: 'stripe', x: 8, y: 66, w: 26, h: 5, color: '#e0245e', opacity: 0.9 },
      { kind: 'circle', x: 16, y: 20, w: 6, h: 6, color: '#ff9ecf', opacity: 0.7, blur: 2 },
    ],
  },
  {
    id: 'hot-spring',
    name: 'Hot spring',
    description: 'Steam on dark water, warm stone steps and nowhere else to be.',
    backdrop: [
      'radial-gradient(ellipse 70% 30% at 50% 45%, rgb(240 240 255 / 0.18), transparent 70%)',
      'radial-gradient(ellipse 100% 35% at 50% 100%, rgb(60 140 150 / 0.55), transparent 75%)',
      'linear-gradient(180deg, #0f1420 0%, #1a2230 45%, #203a42 70%, #0e2a30 100%)',
    ].join(', '),
    shapes: [
      { kind: 'circle', x: 14, y: 40, w: 34, h: 18, color: '#e8ecf5', opacity: 0.16, blur: 14 },
      { kind: 'circle', x: 50, y: 34, w: 36, h: 20, color: '#e8ecf5', opacity: 0.14, blur: 16 },
      { kind: 'rect', x: 0, y: 60, w: 30, h: 12, color: '#3b3a40', opacity: 0.9, rotate: -4 },
      { kind: 'rect', x: 72, y: 58, w: 28, h: 14, color: '#34333a', opacity: 0.9, rotate: 5 },
    ],
  },
  {
    id: 'queer-bar',
    name: 'Queer bar',
    description: 'Glitter on the floor, a tiny stage and the best crowd in the city. Thursday is drag night.',
    backdrop: [
      'conic-gradient(from 180deg at 30% 0%, transparent 0deg, rgb(224 36 94 / 0.3) 15deg, transparent 32deg)',
      'conic-gradient(from 170deg at 72% 0%, transparent 0deg, rgb(155 93 229 / 0.3) 15deg, transparent 32deg)',
      'radial-gradient(ellipse 80% 30% at 50% 78%, rgb(255 120 190 / 0.35), transparent 70%)',
      'linear-gradient(180deg, #1e0a26 0%, #2e0f2e 55%, #170818 100%)',
    ].join(', '),
    shapes: [
      { kind: 'rect', x: 10, y: 76, w: 80, h: 10, color: '#4a1530', opacity: 0.95 },
      { kind: 'stripe', x: 10, y: 74, w: 80, h: 2, color: '#c9a45c', opacity: 0.85 },
      { kind: 'circle', x: 44, y: 10, w: 12, h: 12, color: '#f2c6cf', opacity: 0.75 },
      { kind: 'circle', x: 20, y: 40, w: 4, h: 4, color: '#ffd6f0', opacity: 0.6, blur: 1 },
      { kind: 'circle', x: 76, y: 30, w: 3, h: 3, color: '#d6c2ff', opacity: 0.6, blur: 1 },
    ],
  },
  {
    id: 'home',
    name: 'Home',
    description: 'Your place: lamp low, music on and no closing time.',
    backdrop: [
      'radial-gradient(ellipse 45% 40% at 22% 55%, rgb(255 190 120 / 0.4), transparent 70%)',
      'radial-gradient(circle at 78% 30%, rgb(255 220 150 / 0.4) 0 1%, transparent 1.5%)',
      'radial-gradient(circle at 70% 22%, rgb(255 220 150 / 0.35) 0 0.8%, transparent 1.3%)',
      'linear-gradient(180deg, #2a1420 0%, #33182a 60%, #241020 100%)',
    ].join(', '),
    shapes: [
      { kind: 'rect', x: 60, y: 12, w: 32, h: 36, color: '#101432', opacity: 0.9 },
      { kind: 'line', x: 76, y: 12, w: 0.6, h: 36, color: '#3a2030', opacity: 0.9 },
      { kind: 'circle', x: 16, y: 44, w: 14, h: 12, color: '#ffc882', opacity: 0.5, blur: 8 },
      { kind: 'rect', x: 0, y: 74, w: 64, h: 18, color: '#5a1d3b', opacity: 0.9 },
    ],
    requiresAffection: HOME_AFFECTION,
  },
]

const BY_ID: ReadonlyMap<string, Venue> = new Map(VENUES.map((v) => [v.id, v]))

export function venueById(id: string): Venue | undefined {
  return BY_ID.get(id)
}

/** True when the relationship's affection reaches the venue's requirement (home needs Lover). */
export function isVenueUnlocked(venue: Venue, affection: number): boolean {
  return venue.requiresAffection == null || affection >= venue.requiresAffection
}

/** The requirement to show on a locked venue, e.g. "Needs Lover", or null when it's open. */
export function venueLock(venue: Venue, affection: number): string | null {
  if (isVenueUnlocked(venue, affection)) return null
  return `Needs ${stageLabel(stageFor(venue.requiresAffection ?? 0))}`
}

export const DRAG_NIGHT_NOTE = "It's Thursday: drag night."

/**
 * The queer bar's Thursday note ("It's Thursday: drag night.") on Thursdays, else null. Pass a
 * venue id to ask about another venue (only the queer bar has one).
 */
export function dragNightNote(date: Date = new Date(), venueId: string = 'queer-bar'): string | null {
  return venueId === 'queer-bar' && date.getDay() === 4 ? DRAG_NIGHT_NOTE : null
}
