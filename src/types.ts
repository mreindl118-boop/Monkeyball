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
  /**
   * Optional: the gift as it reads mid-sentence ("a poetry book"), for "You brought {gift}." and
   * the date setup's summary. Plural and mass names ("Rare vinyl", "Flowers") read fine bare.
   */
  phrase?: string;
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

/**
 * Where a role's model runs. Claude, ChatGPT and Grok are the headline presets; the rest sit under
 * "Other providers". See docs/ARCHITECTURE.md, "Providers: Claude and ChatGPT first".
 */
export type ConnectionPreset =
  | 'claude'
  | 'chatgpt'
  | 'grok'
  | 'ollama'
  | 'lmstudio'
  | 'openrouter'
  | 'custom';

/** The wire format a preset speaks: Anthropic's Messages API (via the SDK) or OpenAI-compatible. */
export type ModelProvider = 'anthropic' | 'openai';

/** The two model roles. Story serves story + memory calls; judge serves judge, agreement, suggestions. */
export type ModelRole = 'story' | 'judge';

/** Claude's output_config.effort: trades speed and cost for depth. */
export type Effort = 'low' | 'medium' | 'high';

/** A preset's own address and key. Keys never leave the device (not in save exports). */
export interface ProviderSlot {
  baseUrl: string;
  apiKey: string;
}

export interface ConnectionSettings {
  /** Base URL and key for every preset, so one provider's key is never sent to another server. */
  providers: Record<ConnectionPreset, ProviderSlot>;
  /** The story role (story + memory calls). Empty model means the preset's default, if it has one. */
  story: { preset: ConnectionPreset; model: string };
  /**
   * The judge role (judge, agreement, suggestions). 'same' runs on the story preset. An empty model
   * means the story model when both roles share a preset, else the preset's default judge model.
   */
  judge: { preset: ConnectionPreset | 'same'; model: string };
  storyTemperature: number; // default 0.9; only sent to models that accept it
  maxTokens: number; // default 600; OpenAI-compatible story calls (Claude always gets 16000)
  /** Claude story effort, default 'low'. Other Claude calls always use 'low'. */
  effort: Effort;
}

export type StylePreset = 'anime' | 'semiReal' | 'painterly';

/** Where tier art is painted (Phase 5): an Automatic1111/Forge server, or xAI's Grok Imagine. */
export type ImageProvider = 'a1111' | 'grok';

/** Grok Imagine aspect ratios offered for character art (portrait first). */
export type ImageAspectRatio = '2:3' | '3:4' | '9:16' | '1:1' | '4:3' | '3:2' | '16:9';

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

  // Optional (Phase 5). Defaults and the settings migration always fill them in.
  /** Which art provider paints generated tiers. Default 'a1111' (stored Phase 1 settings too). */
  provider?: ImageProvider;
  /** Grok Imagine model id. Default 'grok-imagine-image'. Uses the Grok connection card's key. */
  grokModel?: string;
  /** Grok Imagine aspect ratio. Default '2:3' (portrait). A1111 uses width and height instead. */
  aspectRatio?: ImageAspectRatio;
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
  /**
   * Android app only: look for a newer APK (the latest GitHub release) at launch. Sends nothing
   * about the player. Default true; the web app and PWA update themselves and ignore it.
   */
  autoUpdateCheck: boolean;
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

/** How a character came to know something about the player (Phase 4). */
export type BetrayalHow = 'player' | 'gossip' | 'group' | 'lie';

export interface BetrayalEvent {
  at: number;
  kind: 'agreement' | 'lie';
  /** Character id of the other person involved, when there is one. */
  about?: string;
  note: string;
  affectionDelta: number;
  trustDelta: number;
  /** Optional (Phase 4): how they found out: the player said so, gossip, a group date, a caught lie. */
  how?: BetrayalHow;
  /** Optional (Phase 4): the agreement it broke, when there was one. */
  agreement?: AgreementType;
  /** Optional (Phase 4): the line added to their memory, in their own voice. */
  memory?: string;
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

  // Optional (Phase 4 fixes), all additive.
  /**
   * Character ids this character heard about through gossip (not from the player) while their
   * agreement expects disclosure (poly, or open with telling terms). The player can still bring
   * them up on the next date with this character; if that date ends without it, it's a betrayal.
   */
  heardSecondhand?: string[];
  /** When a compersion or low-jealousy character's grudge lifted (trust back to 60 after a betrayal). */
  forgivenAt?: number;
  /**
   * A rekindle with someone else (rekindle.ts): the door closing on the player (invite false,
   * rekindledWith is set too) or an invite to join them. `told` once the story has brought it up.
   */
  rekindle?: { with: string; invite: boolean; at: number; told?: boolean };
  /** What the player has actually said about how they date (the story's {knownStyle}). */
  toldStyle?: ToldStyle;
  /** GameState.dateCount when the player last went out with them ("seeing" lapses after a while). */
  lastDateIndex?: number;
  /** Gossip lines this friend has already shared (shared again only when there's nothing new). */
  gossipShared?: string[];
  /** Secrets unlocked after a date's last reply: their rumor rolls happen at the next date's start. */
  rumorRollsOwed?: number;
}

/** What the player conveyed to a character about how they date. */
export interface ToldStyle {
  /** The style the player's own words described, if any. */
  style?: PlayerStyle;
  /** The agreement the player asked this character for in Define the relationship. */
  asked?: AgreementType;
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
  /** Optional: dates finished so far (who still counts as "seeing" someone). */
  dateCount?: number;
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
  /** Optional (Phase 4), player turns: the betrayal this message set off, per character id. */
  betrayal?: Record<string, BetrayalEvent>;
  /** Optional (Phase 4), player turns: rumor ids this message passed on, per character id. */
  relayed?: Record<string, string[]>;
  /**
   * Optional, system turns only: what the note is about. 'refused' follows a story turn the model
   * declined (suggests a lower heat); 'error' says a reply didn't come through (the date offers a
   * retry, and a successful retry removes it).
   */
  notice?: 'refused' | 'error';
}

export type DateKind = 'single' | 'group' | 'epilogue';

/** Who opened a Define-the-relationship talk: the player, or the character asking at date start. */
export type DtrBy = 'player' | 'character';

/** A Define-the-relationship talk on a date (Phase 4). Open until closedAt is set. */
export interface DtrRecord {
  requested: AgreementType;
  by: DtrBy;
  openedAt: number;
  /** When the talk closed (the player closed it or the date ended). */
  closedAt?: number;
  /** The Agreement prompt's answer, when it ran. */
  result?: AgreementResult;
}

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
  /**
   * Optional: the venue and gift affection counted at the start of the date, per character (after
   * the gain cap). The venue and gift reactions themselves are on the relationship.
   */
  opening?: Record<string, { venue: number; gift: number }>;
  outcome?: 'completed' | 'left' | 'ended' | 'abandoned';
  endingType?: EndingType;
  recap?: DateRecap;
  /** Optional (Phase 4): the Define-the-relationship talk on this date, if one was opened. */
  dtr?: DtrRecord;
  /**
   * Optional (Phase 5): art slot keys (src/art/types.ts, slotKey) whose instant-film reveal has
   * played on this date's recap, so each unlock develops once.
   */
  artShown?: string[];
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
      /**
       * Optional: false when the player already knew the venue or gift reaction before this date
       * (the recap lists only new ones under what you learned). Missing on older records: new.
       */
      venueNew?: boolean;
      giftNew?: boolean;
      gossip: string[];
      left: boolean;
      /** Optional: the memory line this date added, in the character's voice (empty when none). */
      memory?: string;
      /** Optional: the route the date was played on (friend route: tiers 3-5 are friendship-locked). */
      route?: Route;
      /**
       * Optional: what came up this date for the first time: the character's attractions or style
       * (now shown on the profile), and whether they learned how the player dates.
       */
      revealed?: { attractions: boolean; style: boolean; playerStyle: boolean };
      /** Optional (Phase 4): the Define-the-relationship talk, when one was opened on this date. */
      dtr?: DtrRecord;
    }
  >;
  /**
   * Optional (Phase 4): what the date set off elsewhere once it ended: gossip, betrayals other
   * characters took from it, rekindles. The same news is added to GameState.news.
   */
  world?: {
    news: NewsItem[];
    betrayals: WorldBetrayal[];
  };
}

/** A betrayal another character took from a date, with their meters around it (Phase 4). */
export interface WorldBetrayal {
  characterId: string;
  event: BetrayalEvent;
  /** Optional: their affection and trust just before and just after it landed. */
  before?: { affection: number; trust: number };
  after?: { affection: number; trust: number };
}

// ---------------------------------------------------------------------------
// Art

export type ArtSource = 'imported' | 'bundled' | 'generated' | 'placeholder';

/**
 * Key format: `${characterId}:tier-${n}`, `${characterId}:ending-${type}`, or
 * `group:${ids.sort().join('+')}:${slot}` (src/art/types.ts, slotKey). The player's imported image
 * is stored under the slot key itself; a generated image under the slot key plus `#generated`
 * (src/art/types.ts, generatedKey), so importing over generated art and removing the import later
 * brings the generated image back. Group images use characterId 'group'.
 */
export interface StoredImage {
  key: string;
  characterId: string;
  source: 'imported' | 'generated';
  blob: Blob;
  /**
   * Optional (Phase 5): a small copy (longest side 640px, src/art/compress.ts) that coasters, the
   * profile strip and gallery tiles show, so a phone doesn't decode full pictures for them. Missing
   * when the picture is already that small; rows from older saves and packs get one when first shown.
   */
  thumb?: Blob;
  prompt?: string;
  /** Optional (Phase 5): Grok Imagine's rewrite of the prompt, what it actually painted from. */
  revisedPrompt?: string;
  seed?: number;
  createdAt: number;
  favorite?: boolean;
  /**
   * Optional (Phase 5): art that came with an imported pack, the pack's set id. Kept under its own
   * key (`${slotKey}#pack`) so the player's own image and the pack's never replace each other.
   */
  pack?: string;
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
