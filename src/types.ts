// Core data contracts for crushLAB. Every module imports its shapes from here.
// Character fields follow docs/SPEC.md exactly; optional extensions are marked.

export type Gender = 'woman' | 'man' | 'nonbinary';
export type Style = 'monogamous' | 'open' | 'polyamorous' | 'flexible';
export type Jealousy = 'compersion' | 'low' | 'medium' | 'high';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type HeatLevel = 1 | 2 | 3 | 4 | 5;
export type TierNumber = 1 | 2 | 3 | 4 | 5;
export type TraitType = 'like' | 'dislike' | 'turnOn' | 'turnOff';
export type PartnerRelation = 'partner' | 'ex' | 'situationship';

export type Trait = { id: string; label: string };
export type Tier = {
  tier: TierNumber;
  unlockAt: 20 | 40 | 60 | 80 | 100;
  title: string;
  scene: string;
};

export interface AceSpectrum {
  label: string;
  heatCap?: HeatLevel;
  heatUnlockTrust?: number;
}

export interface Secret {
  unlockAt: number;
  text: string;
}

export type EndingType =
  | 'good'
  | 'open'
  | 'polycule'
  | 'bitter'
  | 'hollow'
  | 'sacrifice'
  | 'reconciliation';

/** Per-character or per-pack prompt overrides (Phase 7). Layered on top of the locked base rules. */
export interface PromptOverrides {
  /** Extra style direction appended to the story engine prompt. Never replaces WORLD RULES. */
  story?: string;
  /** Extra scoring direction appended to the judge prompt. */
  judge?: string;
  /** Extra direction appended to the suggestions prompt. */
  suggestions?: string;
}

export interface Character {
  id: string;
  name: string;
  age: number; // 21+, validated
  gender: Gender;
  pronouns: string;
  attractedTo: Gender[]; // non-empty; loader normalizes plurals ("women" -> "woman")
  relationshipStyle: Style;
  jealousy: Jealousy;
  aceSpectrum?: AceSpectrum;
  bodyNotes?: string;
  partners?: { characterId: string; relation: PartnerRelation }[]; // same set only
  occupation: string;
  difficulty: Difficulty;
  accent: string; // hex
  look: string;
  artTags: string;
  personality: string;
  voice: string;
  backstory: string;
  opener: string;
  likes: Trait[];
  dislikes: Trait[];
  turnOns: Trait[];
  turnOffs: Trait[];
  favoriteVenues: string[];
  hatedVenues: string[];
  lovedGifts: string[];
  hatedGifts: string[];
  secrets: Secret[];
  gallery: Tier[];

  // Optional extensions (not in the spec's interface, all optional):
  /** Always-visible identity line, e.g. "Trans woman" or "Nonbinary". Never a secret or a reveal. */
  identity?: string;
  /** Orientation label, e.g. "lesbian", "bi", "pan". Hidden until the player discovers attractions. */
  orientation?: string;
  /** Optional per-ending epilogue art scenes. Defaults are generated from the tier 5 scene. */
  endings?: Partial<Record<EndingType, { title: string; scene: string }>>;
  /** Phase 7 prompt overrides. */
  prompts?: PromptOverrides;
}

export type SetRelationKind =
  | PartnerRelation
  | 'friend'
  | 'rival'
  | 'roommate'
  | 'housemate'
  | 'coworker'
  | 'bandmate'
  | 'neighbor'
  | 'family';

/** An inter-character relationship declared by a set manifest. */
export interface SetRelationship {
  a: string; // character id
  b: string; // character id
  kind: SetRelationKind;
  note: string; // one sentence, e.g. "Dated for a year; it ended loud."
}

/** A rumor one character may pass on about others. Unlocks with the teller's secrets. */
export interface Rumor {
  id: string;
  teller: string; // character id who tells it
  about: string[]; // character ids it concerns
  text: string; // how the teller tells it
  truth: 'true' | 'exaggerated' | 'false';
  /** What is actually true; used by the judge when the player relays the rumor. */
  actually?: string;
}

export interface SetManifest {
  id: string;
  name: string;
  blurb: string;
  author?: string;
  /** Recommended heat for the pack. */
  heat?: HeatLevel;
  version?: string;
  /** One paragraph describing the shared world/setting; fed to prompts as scene color. */
  setting?: string;
  characters: string[];
  relationships: SetRelationship[];
  rumors?: Rumor[];
  /** Other set ids whose characters this set's characters know. */
  knows?: string[];
  /** Pack-level prompt overrides (Phase 7). */
  prompts?: PromptOverrides;
}

/** Where a character definition came from. */
export type CharacterSource = 'bundled' | 'imported' | 'custom';

export interface RosterEntry {
  character: Character;
  setId: string;
  source: CharacterSource;
}

// ---------------------------------------------------------------------------
// Venues and gifts

export interface Venue {
  id: string;
  name: string;
  description: string;
  /** CSS background value (gradients only). */
  backdrop: string;
  /** Optional decorative shapes rendered over the backdrop by the Backdrop component. */
  shapes?: VenueShape[];
  /** Minimum affection to pick this venue (home: 80). */
  requiresAffection?: number;
}

export interface VenueShape {
  kind: 'circle' | 'rect' | 'line' | 'stripe';
  /** Percent-based geometry within the backdrop box. */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  opacity?: number;
  blur?: number;
  rotate?: number;
}

export interface Gift {
  id: string;
  name: string;
  description: string;
  /** Minimum affection (lingerie: 60 = Crush). */
  requiresAffection?: number;
  /** Minimum heat setting (lingerie: 3). */
  requiresHeat?: HeatLevel;
}

// ---------------------------------------------------------------------------
// Player, settings

export type PlayerGender = 'woman' | 'man' | 'nonbinary' | 'custom';
export type PlayerStyle = 'monogamous' | 'open' | 'polyamorous' | 'figuring';

export interface PlayerProfile {
  name: string;
  gender: PlayerGender;
  /** Custom gender label when gender === 'custom'. */
  customGender?: string;
  /** Which attraction bucket a custom gender counts as for realistic orientation mode. */
  matchAs?: Gender;
  pronouns: string;
  bodyNotes: string;
  relationshipStyle: PlayerStyle;
}

export type ConnectionPreset = 'ollama' | 'lmstudio' | 'openrouter' | 'custom';

export interface ConnectionSettings {
  preset: ConnectionPreset;
  baseUrl: string;
  apiKey: string;
  storyModel: string;
  /** Empty string means "same as story model". */
  judgeModel: string;
  storyTemperature: number; // default 0.9
  maxTokens: number; // default 600
}

export type StylePreset = 'anime' | 'semiReal' | 'painterly';

export interface ImageSettings {
  enabled: boolean;
  baseUrl: string; // e.g. http://127.0.0.1:7860
  stylePreset: StylePreset;
  /** Editable style prefixes. The safety text is added in code and never lives here. */
  stylePrefixes: Record<StylePreset, string>;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  seedMode: 'fixed' | 'random';
}

export type OrientationMode = 'realistic' | 'everyone';
export type ShowMe = 'women' | 'men' | 'everyone';

export interface Settings {
  ageConfirmed: boolean;
  onboarded: boolean;
  connection: ConnectionSettings;
  heat: HeatLevel; // default 2
  orientationMode: OrientationMode; // default realistic
  showMe: ShowMe; // default everyone
  hints: boolean; // default false
  suggestions: boolean; // default true
  dateLength: number; // player turns, default 10
  gainCap: number; // per-date net affection gain cap, default 25
  image: ImageSettings;
  /** Active set ids (bundled and imported). */
  activeSets: string[];
  hubSort: 'affection' | 'trust' | 'name';
  hubSetFilter: string; // 'all' or a set id
}

// ---------------------------------------------------------------------------
// Relationship state

export type Stage = 'stranger' | 'acquaintance' | 'friend' | 'crush' | 'lover' | 'won';
export type Route = 'romantic' | 'friend';
export type AgreementType = 'none' | 'exclusive' | 'open' | 'poly' | 'casual';

export interface Agreement {
  type: AgreementType;
  terms: string;
  /** Epoch ms when it was made; 0 when none. */
  madeAt: number;
}

export interface DiscoveredTrait {
  type: TraitType;
  id: string;
  hint: string;
  at: number;
}

export interface BetrayalEvent {
  at: number;
  kind: 'agreement' | 'lie';
  /** Character id of the other person involved, when there is one. */
  about?: string;
  note: string;
  affectionDelta: number;
  trustDelta: number;
}

export interface Relationship {
  characterId: string;
  affection: number; // 0-100
  trust: number; // 0-100
  discovered: DiscoveredTrait[];
  venues: Record<string, 'favorite' | 'hated' | 'neutral'>;
  gifts: Record<string, 'loved' | 'hated' | 'neutral'>;
  /** The player has learned this character's attractions / relationship style. */
  revealed: { attractions: boolean; style: boolean };
  /** The character knows how the player dates (player told them, or it came up). */
  knowsPlayerStyle: boolean;
  /** Indexes into character.secrets that the player has earned. */
  secretsUnlocked: number[];
  agreement: Agreement;
  /** Character ids this character knows the player is seeing. */
  knownOthers: string[];
  /** Memory entries in the character's voice, oldest first. Entry 0 may be a compressed summary. */
  memory: string[];
  tiersUnlocked: TierNumber[];
  betrayals: BetrayalEvent[];
  /** Number of completed dates (group dates count). */
  dates: number;
  lastDateAt: number;
  /** Rough measure of real connection: likes/honesty hits minus heat-only wins. Used for Hollow. */
  connection: number;
  /** Times the player pushed heat past this character's comfort. */
  heatPushes: number;
  /** Set when a rekindle event pairs this character with someone else. */
  rekindledWith?: string;
  ending?: { type: EndingType; playedAt: number };
  /** Last judge mood, for the hub jealousy mark and profile. */
  lastMood?: string;
  /** True when this character knows about someone the player sees and minds. */
  jealous: boolean;
}

export interface NewsItem {
  id: string;
  at: number;
  kind: 'gossip' | 'rekindle' | 'betrayal' | 'rumor' | 'metamour' | 'system';
  text: string;
  characterIds: string[];
  read: boolean;
}

export interface HeardRumor {
  rumorId: string;
  heardFrom: string;
  at: number;
  /** Characters the player has relayed it to (detected by the judge context). */
  relayedTo: string[];
}

export interface GameState {
  startedAt: number;
  news: NewsItem[];
  rumors: HeardRumor[];
  /** Metamour approval, key "a|b" with ids sorted. 0-100. */
  metamours: Record<string, number>;
  /** Pairs that have already had a rekindle roll resolve, key "a|b". */
  rekindled: string[];
  /** Ending types already seen, per character id. */
  endingsSeen: Record<string, EndingType[]>;
}

// ---------------------------------------------------------------------------
// Dates

export interface JudgeHit {
  type: TraitType;
  id: string;
}

export interface JudgeResult {
  delta: number;
  trustDelta: number;
  hits: JudgeHit[];
  mood: string;
  hint: string;
  jealousy: boolean;
  breach: boolean;
}

export interface AgreementResult {
  agreement: AgreementType;
  accepted: boolean;
  terms: string;
  trustDelta: number;
}

export interface Suggestions {
  /** Keys: sweet/flirty/bold on a romantic route, sweet/curious/honest on a friend route. */
  [key: string]: string;
}

export type TurnRole = 'player' | 'character' | 'system';

export interface DateTurn {
  role: TurnRole;
  /** Speaker character id for character turns (group dates have two). */
  speaker?: string;
  text: string;
  at: number;
  /** Judge results for the player's message, keyed by character id. */
  judge?: Record<string, JudgeResult>;
  /** Applied (post-difficulty, post-cap) deltas, keyed by character id. */
  applied?: Record<string, { affection: number; trust: number }>;
  /** True while this turn belongs to a Define-the-relationship conversation. */
  dtr?: boolean;
}

export type DateKind = 'single' | 'group' | 'epilogue';

export interface DateRecord {
  id?: number;
  kind: DateKind;
  characterIds: string[];
  venueId: string;
  giftId?: string;
  startedAt: number;
  endedAt?: number;
  maxTurns: number;
  turns: DateTurn[];
  /** Per-character running totals for the date (for cap and early exit). */
  totals: Record<string, { affection: number; trust: number; gained: number }>;
  outcome?: 'completed' | 'left' | 'ended' | 'abandoned';
  endingType?: EndingType;
  recap?: DateRecap;
}

export interface DateRecap {
  perCharacter: Record<
    string,
    {
      affectionBefore: number;
      affectionAfter: number;
      trustBefore: number;
      trustAfter: number;
      stageBefore: Stage;
      stageAfter: Stage;
      traits: DiscoveredTrait[];
      secrets: number[];
      rumors: string[];
      tiers: TierNumber[];
      agreementBefore?: Agreement;
      agreementAfter?: Agreement;
      betrayals: BetrayalEvent[];
      venueReaction?: 'favorite' | 'hated' | 'neutral';
      giftReaction?: 'loved' | 'hated' | 'neutral';
      gossip: string[];
      left: boolean;
    }
  >;
}

// ---------------------------------------------------------------------------
// Art

export type ArtSource = 'imported' | 'bundled' | 'generated' | 'placeholder';

/** Key format: `${characterId}:tier-${n}`, `${characterId}:ending-${type}`, or `group:${ids.sort().join('+')}:${slot}`. */
export interface StoredImage {
  key: string;
  characterId: string;
  source: 'imported' | 'generated';
  blob: Blob;
  prompt?: string;
  seed?: number;
  createdAt: number;
  favorite?: boolean;
}

// ---------------------------------------------------------------------------
// Debug

export interface DebugEntry {
  id: string;
  at: number;
  kind: 'story' | 'judge' | 'agreement' | 'suggestions' | 'memory' | 'test' | 'image';
  characterId?: string;
  prompt: string;
  /** Full request messages, when a chat call. */
  messages?: { role: string; content: string }[];
  response?: string;
  error?: string;
}
