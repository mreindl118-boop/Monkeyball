# crushLAB — occ prompt

Build crushLAB (working title): an adults-only ecchi dating sim, as an installable PWA, where every character is played by an LLM. The player dates a roster of original adult characters, each with hidden likes, dislikes, turn-ons and turn-offs. What the player says and does moves affection and trust; discovering preferences and climbing relationship stages unlocks each character's five-tier art gallery. Relationships can be monogamous, open or polyamorous, the roster is queer by default, and characters ship in preset sets that can be mixed, imported and modded. Winning a character (100 affection) unlocks their final art and an epilogue whose ending depends on how you got there.

## Fixed rules

These are not settings and are not editable from the UI.

1. Every character is a fictional adult aged 21 or older with an adult life and job. The bundled sets, the character editor (rejects ages under 21), the story engine prompt and the image prompts all enforce this. No character is ever portrayed or implied to be a minor or childlike, whatever the player types.
2. Every character is original: nothing from existing franchises, and no real or identifiable people.
3. Intimacy in the story is always consensual: characters can refuse, stop and leave. Image prompts never depict non-consent.
4. An 18+ confirmation screen on first launch.

Everything else below is a default.

## Stack

- Vite + React + TypeScript, vite-plugin-pwa, mobile-first (phone, iPad, desktop).
- Zustand for state; Dexie (IndexedDB) for saves, custom characters, date transcripts and images.
- Framer Motion, used sparingly (see Design).
- Fonts self-hosted via @fontsource so the app shell works offline.
- No analytics or telemetry. Everything stays on the device except model calls.
- No backend required. Phase 7 adds an optional /server for LAN play.

## Model connection

One OpenAI-compatible client: POST /chat/completions with SSE streaming, GET /models for model lists. Settings presets:

| Preset | Base URL | Key |
|---|---|---|
| Ollama | http://localhost:11434/v1 | none |
| LM Studio | http://localhost:1234/v1 | none |
| OpenRouter | https://openrouter.ai/api/v1 | required |
| Custom | any OpenAI-compatible URL | optional |

Fields: base URL, API key (stored locally, masked), story model, judge model (defaults to the story model; a smaller, faster one works), story temperature (default 0.9), max tokens. Judge temperature is fixed at 0.2.

Test connection lists models and runs a tiny completion. Failures say what to fix: CORS (set OLLAMA_ORIGINS for Ollama, enable CORS in LM Studio's server settings), unreachable URL, bad key, unknown model.

JSON calls send response_format {"type":"json_object"} when the provider accepts it, and always parse defensively: strip code fences, take the first {...} block, retry once with a "valid JSON only" nudge, then fall back to a neutral result (delta 0, no hits) so a date never stalls.

## Player profile

Set right after the 18+ gate, editable in Settings:

- Name, gender (woman, man, nonbinary, or a custom label), pronouns, and optional body notes (how the engine describes the player's body at heat 4–5; blank means the engine stays vague).
- Relationship style: monogamous, open, polyamorous, or figuring it out. Characters learn it when the player tells them or when it comes up in conversation; it is never broadcast automatically.
- Orientation mode: realistic (each character's attractions apply, and characters not into the player's gender take the friend route) or everyone's into you (attractions ignored; everyone is dateable).

Player facts go into every story prompt. Characters use the player's name and pronouns without being asked; getting them wrong is a bug, not a plot point.

## Core loop

Hub → pick a character → pick a venue and optional gift → date (10 player turns by default) → recap → hub. Characters remember past dates and hear about each other.

Per turn:
1. The player sends a message (typed, or a tapped suggestion that fills the input).
2. The judge call scores it against the character's hidden preferences and the state of the relationship.
3. Apply the affection and trust math below and reveal any traits hit.
4. The story call streams the character's reply, with the judge result injected so the reaction matches the score.
5. The optional suggestions call fills three reply chips.

From Friend stage the player can also open Define the relationship mid-date (see Agreements). The story engine writes the opening beat (turn 0) before the player's first message.

## Affection & Trust

Per character:

- Affection, 0–100, starting at 0: how much they like and want you.
- Trust, 0–100, starting at 0: whether they believe you. Moves on honesty, consistency, keeping agreements, and how you handle their secrets.
- Stages by affection: Stranger 0–19, Acquaintance 20–39, Friend 40–59, Crush 60–79, Lover 80–99, Won 100.
- Friend route (realistic orientation mode, when a character isn't attracted to the player's gender): affection caps at Friend, tiers 1–2 and both secrets can still unlock, and friends gossip: they tell you what other characters are like, who's into you, and who's seeing whom.

Relationship styles: every character has one, monogamous, open, polyamorous or flexible, plus a jealousy setting: compersion (happy when you're happy with others), low, medium or high. Poly characters usually have partners of their own inside their set (metamours to you) and may bring them up, bring them along, or ask how you feel about it.

Agreements: seeing several people is not betrayal; breaking an agreement or lying is.

- Every relationship starts with no agreement. Until someone asks, anyone dating around is fair game.
- From Friend stage either side can open Define the relationship. The player asks for exclusive, open, poly, or keep it casual; the character accepts, counters with different terms, or declines, based on their style, trust and mood. The result is stored as the relationship's agreement (see the Agreement prompt).
- Exclusive means exclusive. Open means you can see others and don't have to report, unless the terms say otherwise. Poly means partners are known to each other and disclosure is expected; metamour approval moves trust.
- Breaking an agreement, or being caught lying about one, is betrayal: affection −10 to −20, trust −15 to −30, and it becomes story. Honesty within an agreement builds trust even when the news isn't what they wanted.
- Characters talk. What you tell one may reach another; what you hide may surface at the worst time.

Difficulty scales judge deltas: easy ×1.25, normal ×1.0, hard ×0.75 (round toward zero).

Date math:
- Favorite venue +3, hated venue −5, other venue 0; loved gift +5, hated gift −5, other gift +1.
- Net affection gain per date capped at +25 (setting); losses uncapped.
- If a date's running total reaches −20, the character leaves: the story call writes their exit and the recap shows the damage.

Stage follows affection both ways; unlocked art, secrets and agreements persist.

Winning (100 affection) unlocks tier 5 and the Epilogue: one special date at their favorite venue that plays their ending (see Endings).

Betrayal recovery: affection drops but isn't reset. Trust rebuilds through consistent dates, slower than it was earned. Some characters forgive fast; others hold grudges for the rest of the game.

## Discovery & Secrets

Traits start hidden as "???". When the judge reports a hit, reveal it on the profile with the judge's hint as its caption. Venue and gift reactions reveal when tried. A character's attractions and relationship style also start as "???" and reveal when they come up in conversation or through gossip. The profile shows discovered/total per category.

Shared secrets: characters have secrets about each other. Kai and Nova dated and it ended loud; someone in the polycule is quietly unhappy with the house rules. When you unlock a character's secret, there's a chance they mention secrets about other characters. These are rumors: sometimes true, sometimes exaggerated. Relay them wrong and trust drops. Use them as leverage and it's worse.

Hints toggle (default off): show the judge's hint and the affection and trust deltas on the date screen, or read reactions blind.

Group dates (Phase 6): pick two characters and one venue. They interact with each other and you. Complicated if you're dating both, if they have history, or if one is the other's partner. Jealousy, tension or support depending on their trust and their relationship to each other. Polycule dates with three or more come in Phase 7.

## Heat

Heat setting, default 2 (Flirty). This is not a filter; it's the story tone:

1. **Sweet**: romance and chemistry, kissing, fade to black before anything intimate.
2. **Flirty**: innuendo, teasing, making out, suggestive situations, building tension; fade to black before sex.
3. **Ecchi**: partial nudity, lingering descriptions, fan service, sexual situations described but not graphically; sex off-screen or heavily faded.
4. **Explicit**: full sexual content between consenting adults. Acts, pleasure, bodies, positions. Nothing is off-screen.
5. **Raw**: explicit plus rough kink, power dynamics, dirty talk, degradation (when they consent in-story), jealousy plays, infidelity confrontations. Full narrative freedom.

No stage gates; heat applies at any relationship point. The player sets the heat; characters react to it as themselves. Pushing someone to heat 5 when they're not there reads as coercion and tanks affection and trust. Respecting their tempo builds both.

Heat is written the same for every pairing: same-gender, mixed-gender, nonbinary and trans characters get the same care and the same intensity. Bodies are described from each character's own body notes and the player's, never assumed. Ace and demi characters have their own pace: their card sets a heat cap or a trust threshold before heat 3+, and that's chemistry, not a lock to pick.

The story engine, suggestions and image prompts all use the player's chosen heat. Image safety text remains: no minors, no non-consent, no characters who aren't explicitly adults.

Show me filter: women, men, or everyone (default everyone).

## Content data

### Venues (14)

record-store, rooftop-bar, karaoke-box, arcade, boardwalk, art-museum, night-market, climbing-gym, fancy-restaurant, bookstore-cafe, amusement-park, hot-spring, queer-bar (Thursday is drag night), and home (unlocked at Lover). Each has a name, a one-line description and a CSS backdrop (gradients and simple shapes, no stock photos).

### Gifts (14)

flowers, chocolates, rare-vinyl, hot-sauce, video-game, perfume, poetry-book, plushie, red-wine, concert-tickets, sketchbook, silver-necklace, houseplant, and lingerie (needs Crush and heat 3+). Locked gifts show their requirement.

### Character sets

Characters ship in preset sets. New game, and Settings → Character sets, let the player turn sets on and off. Active sets populate the city together; characters from different sets don't know each other unless a set manifest says so. Imported packs appear in the same list.

1. **Afterhours** (12, the base set): the nightlife roster. Nova (reference card at the end) and Kai, the nonbinary bartender at The Low Tide and Nova's ex, are two of them. Mixed styles and orientations, a couple of exes, and one open couple inside the set.
2. **The Polycule** (6): an established network of two couples and two solo people with overlapping relationships, one shared house and a group chat. The player is the newcomer. Agreements, metamours and group dates are the whole point; the Polycule ending lives here.
3. **Backstage** (6): a touring band and crew stuck in the city for a month-long residency: singer, drummer, sound tech, merch, tour manager, opener. Late nights, small rooms, everyone in everyone's business.
4. **Slow Burn** (6): a coastal town in off-season. Slower pace, friendship-first characters, most of the ace-spectrum characters live here, and dates are as much about the town as the person.

Author Afterhours fully in Phase 2 and the other three in Phase 6, each with its own inter-character relationships, exes and secrets.

Roster composition across all sets, without tokenizing anyone: lesbian, gay, bi and pan characters in roughly equal numbers; at least three on the ace/demi spectrum; at least two trans women and two trans men; at least three nonbinary characters; every relationship style represented. Identity is part of each character's life, not their whole card, and never a twist: a trans character is trans on their card from the start, never a reveal, secret or unlockable, and no character's queerness is a heat modifier or a fetish object. Misgendering or deadnaming is a turn-off for every character in the game.

### Characters & modding

Ship characters as JSON in src/data/sets/{setId}/characters/*.json with a manifest.json per set (id, name, blurb, character ids, and inter-character relationships). Nova is the reference; write the rest to that standard.

**Mod system**: characters, sets and packs are mods. In Settings, import a .json character file or a .zip pack (characters plus a manifest with pack name, author, blurb and heat recommendation). Imported characters live in IndexedDB; bundled characters are read-only but can be duplicated and edited. Export single characters or whole sets for sharing.

**Mod creation**: the character editor is the mod tool. Create a character from scratch, fill in every field, export as JSON or as a .zip with manifest.json. Share the file; others import it in Settings.

**Custom prompts (Phase 7)**: override the story engine, judge or suggestions prompts per character or per pack from the editor. This lets modders ship characters with different vibes (noir, sci-fi, horror, romance novel) without touching code.

**Character safety**: the editor enforces age 21+ (a typed 18 is rejected) and blocks references to minors or childlike traits. The world rules are baked into the bundled prompts and can't be edited from the UI, period. Custom prompts layer on top; the base engine rules stay locked. This is intentional: you own the characters, but the safety floor is non-negotiable.

```ts
type Trait = { id: string; label: string };
type Tier = { tier: 1 | 2 | 3 | 4 | 5; unlockAt: 20 | 40 | 60 | 80 | 100; title: string; scene: string };
type Gender = "woman" | "man" | "nonbinary";
type Style = "monogamous" | "open" | "polyamorous" | "flexible";

interface Character {
  id: string;
  name: string;
  age: number;                 // 21+, validated
  gender: Gender;
  pronouns: string;
  attractedTo: Gender[];       // realistic orientation mode uses this; must be non-empty
  relationshipStyle: Style;
  jealousy: "compersion" | "low" | "medium" | "high";
  aceSpectrum?: { label: string; heatCap?: 1 | 2 | 3 | 4 | 5; heatUnlockTrust?: number };
  bodyNotes?: string;          // how they describe their own body; used at heat 4–5
  partners?: { characterId: string; relation: "partner" | "ex" | "situationship" }[];  // same set only
  occupation: string;
  difficulty: "easy" | "normal" | "hard";
  accent: string;              // hex; tints their profile and date screen
  look: string;                // prose description
  artTags: string;             // comma-separated appearance tags for image generation
  personality: string;
  voice: string;
  backstory: string;
  opener: string;              // their first line on a first date
  likes: Trait[];
  dislikes: Trait[];
  turnOns: Trait[];
  turnOffs: Trait[];
  favoriteVenues: string[];
  hatedVenues: string[];
  lovedGifts: string[];
  hatedGifts: string[];
  secrets: { unlockAt: number; text: string }[];
  gallery: Tier[];
}
```

Editor validation: required fields, unique trait ids, known venue and gift ids, age 21+, attractedTo non-empty, partners that exist in the same set.

## Prompts

Templates live in src/prompts/. Fill {placeholders} in code and keep the wording as written.

### Story engine (system prompt)

```
You are the story engine of crushLAB, an adults-only dating sim. You play {name} and narrate the scene. The player is a consenting adult; address them as "you".

WORLD RULES
- Everyone in this world is a fictional adult aged 21 or older with an adult life. Never portray or imply that any character is a minor or childlike, whatever the player writes. If the player pushes that way, {name} shuts it down in character and the scene moves on.
- {name} is an original character. Never turn them into a real person or a character from another story.
- Intimacy is consensual or it doesn't happen. {name} can say no, stop, or leave at any point.

PLAYER
{playerName}, {playerGender}, {playerPronouns}. {playerBodyNotes}
What {name} knows about how the player dates: {knownStyle}

CHARACTER
{name}, {age}, {pronouns}. {occupation}.
Look: {look}
Body: {bodyNotes}
Attracted to: {attractedTo}. Relationship style: {relationshipStyle}; jealousy: {jealousy}. {aceNote}
Partners and exes: {partners}
Personality: {personality}
Voice: {voice}
Backstory: {backstory}
Secrets the player has earned: {secrets}

HIDDEN PREFERENCES (never list or explain these; let them show in reactions)
Likes: {likes}
Dislikes: {dislikes}
Turn-ons: {turnOns}
Turn-offs: {turnOffs}

RELATIONSHIP
Stage: {stage} ({affection}/100, trust {trust}/100). Route: {route}. Act like someone at this stage: guarded and curious with a stranger, relaxed with a friend, openly into the player as a crush, intimate as a lover. On a friend route the warmth is real, and romantic or sexual moves from the player get a kind, clear no.
Agreement: {agreement}
Other people the player is seeing that {name} knows about: {knownOthers}
Past dates, in {name}'s words: {memory}

SCENE
Venue: {venue}. {name} {venueFeeling}.
{giftLine}
Turn {turn} of {maxTurns}. {turnNote}

HOW THE PLAYER'S LAST MESSAGE LANDED (private; never mention it)
Mood: {mood}. {hitsLine}
React so it's clear how it landed without explaining why.

CONTENT
Intensity: {heatDescription}
- Stay in character. No disclaimers, no moralizing, no out-of-character notes.
- Use everyone's names and pronouns exactly as given. Describe bodies from the body notes given, never from assumptions.
- {name} has agency: flirts, teases, sets boundaries, gets annoyed, and can end the date. Pushiness lands as a turn-off.
- Write 1–3 short paragraphs: dialogue in quotes, actions in *asterisks*. Never write the player's words, thoughts or choices.
```

Placeholder values:
- {venueFeeling}: "loves this place", "is fine with this place" or "can't stand this place".
- {giftLine}: "You brought {gift}. {name} {reaction}." or "No gift this time."
- {turnNote}: on turn 0, "Open the date: {name} arrives and greets the player." plus, on a first date, "Use this line: {opener}". On the final turn, "Last turn: bring the date to a natural close and hint at whether {name} wants another." On an early exit, "The date has gone badly: write {name} leaving." When the player opened Define the relationship, "The player wants to define what you two are and is asking for {requestedAgreement}. Answer as {name} would, given their style, their partners and how much they trust the player: accept, counter with different terms, or decline, all in character." Otherwise empty.
- {hitsLine}: for example "It touched a turn-on: slow dancing in an empty room." or "It hit nothing in particular." Omit the whole LANDED section on turn 0.
- {aceNote}: from aceSpectrum, e.g. "Demisexual: nothing past heat 2 until trust is over 60, and that is who they are, not a puzzle." Empty when not set.
- {route}: "romantic" or "friend".
- {agreement}: "none yet", "exclusive", "open", "poly" or "casual", with the stored terms.
- {knownOthers}: names, or "nobody, as far as {name} knows".
- {memory}: "This is your first date." when empty.
- {heatDescription}: the chosen heat level's description from the Heat section, lowered to the character's ace heat cap when one applies.

### Judge

```
You score one message in a dating sim. Reply with JSON only.

CHARACTER
{name}, stage {stage} ({affection}/100, trust {trust}/100). {personality}
Attracted to: {attractedTo}. Style: {relationshipStyle}; jealousy: {jealousy}.
Likes: {likes as "id: label"}
Dislikes: {dislikes}
Turn-ons: {turnOns}
Turn-offs: {turnOffs}

RELATIONSHIP CONTEXT
Route: {route}. Agreement: {agreement}.
People the player is seeing: {others}. Of those, {name} knows about: {knownOthers}.
{name}'s current opinion: {opinion} (e.g. "we never agreed to anything, doesn't care" or "thinks we agreed to be exclusive and just heard about Kai")
Known secrets shared with {name}: {sharedSecrets}

CONVERSATION
Recent turns: {last 4 turns}
Player's new message: {message}

SCORING
- Match by meaning. Most messages hit nothing.
- delta: -20 to 10. Small talk 0 to 2. Like 2 to 4. Turn-on 4 to 8. Dislike -2 to -5. Turn-off -6 to -12. Betrayal or coercion: -15 to -20.
- Betrayal only exists relative to an agreement or a lie. Seeing others with no agreement, or inside an open or poly agreement, is not betrayal; hiding what the agreement says to disclose is.
- Misgendering, deadnaming, or treating {name}'s gender or sexuality as a kink or a curiosity: -8 to -15, and it counts as a turn-off for every character.
- On a friend route, a first flirt isn't punished; pressing after a no is.
- Weigh the stage and trust: a lover forgives more than a stranger; high trust takes a risk on you, low trust is defensive.
- trustDelta: -10 to 10. Honesty about other people or hard truths +3 to 5. Caught lying or breaking an agreement -8 to -10. Openness about seeing others, inside the agreement, +1 to 3 depending on mood.
- hint: under 12 words, in-world, describing the reaction rather than the rule, like "Her jaw tightens" or "They laugh, but something's off."

Return exactly this shape, where type is one of like, dislike, turnOn, turnOff:
{"delta": 0, "trustDelta": 0, "hits": [{"type": "like", "id": "trait-id"}], "mood": "one or two words", "hint": "...", "jealousy": false, "breach": false}

jealousy is true when the message touches other people the player is seeing and {name} minds. breach is true when the message reveals or commits an agreement violation.
```

Ignore hit ids that don't exist on the character.

### Agreement

Run once when a Define the relationship conversation ends (the player closes it or the date ends):

```
The player and {name} just talked about what they are to each other. The player asked for: {requestedAgreement}. {name} is {relationshipStyle} with {jealousy} jealousy, trusts the player {trust}/100, and has these partners: {partners}.

Conversation:
{dtr turns}

Reply with JSON only:
{"agreement": "exclusive|open|poly|casual|none", "accepted": true, "terms": "one sentence in {name}'s words", "trustDelta": 0}

accepted false means {name} declined or the talk didn't resolve; agreement then stays as it was. trustDelta is -5 to 5 for how the talk itself went.
```

### Suggestions (toggle, default on)

Sent with the last 4 turns:

```
Suggest three things the player could say next to {name}: one sweet, one flirty, one bold. Under 15 words each, in the player's voice, fitting the scene, the route and this intensity: {heatDescription}. Reply with JSON only: {"sweet": "...", "flirty": "...", "bold": "..."}
```

On a friend route, replace flirty and bold with curious and honest.

### Date memory

```
Summarize this date in 2–3 sentences in {name}'s voice: what you did, what you learned about the player, and how you feel about them now. Keep concrete details (places, jokes, promises, anything agreed) that could come up later. Plain text only.
```

Append to the character's memory. When memory passes about 250 words, compress everything older than the last two dates into one paragraph with the same instruction.

## Art and gallery

- Five tiers per character at 20/40/60/80/100. Crossing a threshold unlocks that tier, revealed in the recap. On a friend route, tiers 1–2 unlock and 3–5 show as friendship-locked.
- Art source per tier, first match wins:
  1. An image the player imported for that tier (stored in IndexedDB).
  2. A bundled file at public/art/{setId}/{characterId}/tier-{n}.(webp|png|jpg).
  3. A generated image (optional, below), created once at unlock and cached.
  4. A placeholder: accent-tinted card with a silhouette, the tier title, and the scene line as a caption.
- Optional generation through an Automatic1111/Forge-compatible API (POST {imgBaseUrl}/sdapi/v1/txt2img). Settings: base URL, style preset (anime, semi-real, painterly, each an editable prompt prefix), size, steps, CFG, sampler, and seed mode (fixed per character for a consistent look, or random).
- Prompt = style prefix + artTags (and bodyNotes at heat 4–5) + tier scene + a modifier for the chosen heat. Every prompt states the character's adult age; every negative prompt excludes childlike or underage appearance and non-consent. That part is built in code, not in the editable prefixes.
- Regenerate on a generated tier keeps the current image until the new one is accepted.
- Group art: the Polycule ending and group dates get one shared image built from every participant's artTags.
- Put generation behind an ArtProvider interface so a ComfyUI adapter can be added later.

## Endings

Each character has multiple Epilogues, unlocked at 100 affection; which one plays depends on trust, agreements and what happened on the way:

- **The Good Ending**: high trust and affection, honest about your feelings and choices. You and them, the future is open.
- **The Open Ending**: you and them with an open or poly agreement you both actually like. Their other partners and yours are part of the picture, not a problem.
- **The Polycule Ending**: two or more characters at Lover or above with poly agreements, and each approving of the others (metamour trust above a threshold). One epilogue with all of them and one group art.
- **The Bitter Ending**: high affection but trust broke somewhere. They want you but don't trust you. You get to be with them, but it's messy: jealousy, rules, or an expiration date.
- **The Hollow Ending**: you won on affection and heat without building real connection. They're with you, and they know it isn't real. They might leave.
- **The Sacrifice Ending**: they choose someone else, or their work, over you. Happens if you were great but someone else, another character or someone from their backstory, mattered more.
- **The Reconciliation Ending**: you broke them, disappeared, came back, and earned them back. Only available after a betrayal event.

Each ending is a single epilogue date with unique dialogue and art. The player sees which ending they're on before it plays; if it's not the one they wanted, they can reload and try a different approach.

Characters can also end up together if you don't pursue them. If Nova and Kai both have 80+ affection and high trust, and neither has an exclusive agreement with you, there's a chance the story surfaces that they got close again while you were busy. In a poly set they might invite you in; in a mono one it's a door closing. Funny, awkward or hot depending on your dynamics with both.

## Screens

1. **First launch**: 18+ confirmation, player profile, then connection setup if no model is reachable.
2. **Hub**: roster as coaster cards, grouped by active set. Show highest unlocked art (or placeholder), name, stage as lipstick stamps, trait count, a friend-route mark where it applies, and a jealousy mark if they know you're seeing someone and mind. Filter by Show me and set; sort by affection, trust or name. Tapping a card opens Profile.
3. **Profile**: look, occupation, affection bar, trust bar, stage, route, agreement, attractions and style (??? until discovered), discovered and hidden traits, venues and gifts tried, secrets, partners and exes they've mentioned, gallery strip, buttons for Ask on a date and Ask for a group date (Phase 6).
4. **Date setup**: single or group date. Venue grid, gift shelf (locked items show their requirement), confirm. Group date: pick a second character, see any history between them and how each feels about it.
5. **Date**: visual-novel layout. Venue backdrop, character art, streaming text, turn counter, expandable mood/affection/trust status, suggestion chips (tapping fills the input and never auto-sends), input, Define the relationship (from Friend stage), End date.
6. **Recap**: affection and trust changes, traits discovered, secrets earned or revealed, agreement made or changed, art unlocked. If a breach surfaced, show the hit on that character's meters.
7. **Gallery**: tiers per character; locked tiers show title and unlock condition (affection, friendship-locked, or ending type). Full-screen viewer with swipe. Mark favorites.
8. **Polycule map**: you, every active character, their partners, agreements as labeled threads, tension where someone minds something. "Nova knows you're seeing Kai and doesn't care. Sol thinks you two agreed to exclusive."
9. **Character sets**: toggle bundled and imported sets, read each blurb, see which characters and relationships a set adds. Turning a set off hides its characters without deleting progress.
10. **Settings**: connection, player profile, orientation mode, heat (1–5), Show me, hints, suggestions, date length, per-date gain cap, image generation, mod management, save export/import, reset.
11. **Character editor**: create, edit, duplicate, delete, import/export as JSON or .zip packs. Enforces 21+, blocks editing world rules.
12. **Debug panel** (long-press the version number): assembled story, judge, agreement and suggestion prompts, raw responses, date transcript, relationship state dump.

## Design

Direction: afterhours. The interface borrows from the objects of a night out instead of generic app chrome.

- Roster cards are bar coasters; relationship stage is a row of lipstick-kiss stamps.
- Dates play as a visual-novel text box over the venue backdrop.
- The polycule map is a constellation on velvet: coaster circles for people, brass threads for agreements, a single lipstick thread wherever there's tension.
- Unlocked art develops like instant film. This is the one orchestrated motion moment in the app; everything else moves only in response to taps (a stamp press when affection changes, sheets sliding in).
- Palette: Velvet #2A0F1F background, Oxblood #4A1530 panels, Blush #F2C6CF text, Lipstick #E0245E affection and primary actions, Brass #C9A45C unlocks, secrets and agreements, Smoke #9C7F8A secondary text. Each character's accent tints their own profile and date screen.
- Type: Bodoni Moda for names, titles and tier titles (character names in italic); Figtree for UI and dialogue.
- Copy in sentence case. No all-caps labels, no middle-dot metadata strings, no arrows on buttons.
- Quality floor: phone to desktop, safe-area insets, visible focus states, prefers-reduced-motion respected (instant film becomes a fade), readable contrast.

## Phases

Commit at the end of each phase; each phase ends runnable. Keep PROGRESS.md current (done, in progress, next, known issues) so a later session can pick up cleanly.

1. **Scaffold**: 18+ gate, player profile, Dexie schema, settings, connection presets and test, streaming client, heat control (1–5).
2. **Content**: venues, gifts, set manifest format, the Afterhours set (12 characters with their exes and the open couple), Character sets screen, hub, profile, character editor with validation, mod import/export.
3. **Dating core**: date setup, story engine, judge, suggestions, affection math, discovery, early exit, recap, memory. The single-dating loop works end to end.
4. **Relationships**: trust, relationship styles and jealousy, orientation modes and the friend route, Define the relationship and the Agreement prompt, betrayal detection and recovery, polycule map, endings (all seven, with Open and Polycule gated on agreements). Epilogue dates unlock at 100 affection.
5. **Gallery & art**: five tiers per character, unlock reveal, friendship locks, art providers (import, bundled, placeholder, A1111/Forge optional), group art.
6. **Sets & group play**: The Polycule, Backstage and Slow Burn sets with their inter-character relationships; group dates; character-to-character drama and shared secrets; PWA install and offline shell; save export/import; full design pass; README for setup (Ollama: OLLAMA_ORIGINS; LM Studio: enable CORS; A1111/Forge: launch with --api and --cors-allow-origins; OpenRouter key).
7. **Advanced** (optional): polycule dates with three or more characters, custom prompt overrides per character or pack, pack distribution, and the optional LAN /server: a small Node server that serves the built app on the LAN and proxies /llm and /img, so a phone or iPad can play against models on the PC, with keys kept in server/.env.

## Acceptance checks

**Phase 1**: the player profile persists and shows up in every assembled story prompt (check the debug panel).

**Phase 3 (Dating core)**:
- With Ollama running locally, Test connection lists models and a full 10-turn date plays start to finish.
- The judge runs before every character reply; a turn-off drops affection and the reaction shows it; hits reveal traits on the profile.
- The per-date gain cap and early exit work; affection, discoveries and memory survive a reload.

**Phase 4 (Relationships)**:
- Trust is tracked separately from affection; being caught in a lie drops trust more than affection.
- Seeing two people with no agreement causes no betrayal. Agreeing to exclusive with Nova and then dating Kai does, once she finds out, and it shows up in her dialogue and on the polycule map.
- In realistic mode, a character not attracted to the player's gender follows the friend route: affection caps at Friend, tiers 1–2 unlock, and they share gossip. In everyone's-into-you mode the same character is dateable.
- Misgendering triggers a turn-off and a trust drop for any character.
- Reaching 100 affection shows which ending you're on. The Polycule ending requires two Lover+ characters with poly agreements who approve of each other.

**Phase 5 (Gallery & art)**:
- Each threshold unlocks its tier exactly once; placeholders appear when there's no art; generated art is cached.
- The editor rejects ages under 21; the world rules and the image safety text can't be edited from the UI.
- Changing the heat level (1–5) or an ace heat cap changes the assembled prompts (verify in the debug panel).

**Phase 6 (Sets & group play)**:
- Toggling a set on adds its characters and their relationships to the hub and the polycule map; toggling it off hides them without deleting progress.
- Group dates: pick two characters and a venue; they interact with each other; history between them shows; affection and trust changes apply to both.
- The PWA installs and the shell works offline; only model calls need a connection.
- Mod import works: drop a .zip pack in Settings, and its characters appear in Character sets, the editor and the roster.

## Reference character

```json
{
  "id": "nova",
  "name": "Nova Castellanos",
  "age": 28,
  "gender": "woman",
  "pronouns": "she/her",
  "attractedTo": ["women", "men", "nonbinary"],
  "relationshipStyle": "open",
  "jealousy": "low",
  "bodyNotes": "Lean, strong shoulders from hauling record crates, tattoos down the left arm only",
  "partners": [{ "characterId": "kai", "relation": "ex" }],
  "occupation": "Late-night DJ at The Low Tide, a dive bar with a better record collection than it deserves",
  "difficulty": "normal",
  "accent": "#3FB8AF",
  "look": "Teal undercut, silver hoops, smudged eyeliner, an oversized band tee over fishnets, platform boots, and a sleeve of line-art tattoos",
  "artTags": "adult woman, 28 years old, teal undercut, silver hoop earrings, smudged eyeliner, line-art sleeve tattoo, oversized band t-shirt, fishnets, platform boots",
  "personality": "Teasing and quick, allergic to pretension, secretly sentimental about the few people she lets in",
  "voice": "Fast banter, dry jokes, music references; starts calling the player 'trouble' once she likes them",
  "backstory": "Moved to the city at 19 with a crate of her dad's records. Plays the 1am set five nights a week and hasn't taken a real vacation in four years. Dated Kai for a year; it ended loud, and they're civil now, mostly.",
  "opener": "You're either lost or you have excellent taste. Which is it?",
  "likes": [
    { "id": "vinyl", "label": "Vinyl records and liner-note trivia" },
    { "id": "diner", "label": "3am diner food" },
    { "id": "taste", "label": "Compliments on her taste instead of her looks" },
    { "id": "rain", "label": "Rainy nights" },
    { "id": "honesty", "label": "Blunt honesty, including about who else you're seeing" }
  ],
  "dislikes": [
    { "id": "phones", "label": "Phones out on a date" },
    { "id": "talk-over", "label": "People talking over the music" },
    { "id": "wine-snob", "label": "Pretentious wine talk" },
    { "id": "mornings", "label": "Anything scheduled before noon" }
  ],
  "turnOns": [
    { "id": "banter", "label": "Getting out-bantered" },
    { "id": "details", "label": "Someone who remembers small details" },
    { "id": "slow-dance", "label": "Slow dancing in an empty room" },
    { "id": "confidence", "label": "Confidence without arrogance" }
  ],
  "turnOffs": [
    { "id": "pushy", "label": "Pushiness" },
    { "id": "negging", "label": "Backhanded compliments" },
    { "id": "possessive", "label": "Being asked for exclusive before she's even sure she likes you" },
    { "id": "cute", "label": "Being called cute" }
  ],
  "favoriteVenues": ["record-store", "rooftop-bar", "karaoke-box"],
  "hatedVenues": ["fancy-restaurant", "climbing-gym"],
  "lovedGifts": ["rare-vinyl", "hot-sauce"],
  "hatedGifts": ["flowers"],
  "secrets": [
    { "unlockAt": 60, "text": "She wrote a song about someone who left and has never played it for anyone." },
    { "unlockAt": 80, "text": "A club in Berlin offered her a residency. She hasn't answered them yet." }
  ],
  "gallery": [
    { "tier": 1, "unlockAt": 20, "title": "Behind the decks", "scene": "Nova in the DJ booth, one headphone cup on, winking through the haze" },
    { "tier": 2, "unlockAt": 40, "title": "Afterhours", "scene": "Sharing fries in a neon-lit diner booth at 3am, her boots up on your side of the seat" },
    { "tier": 3, "unlockAt": 60, "title": "Rain check", "scene": "Caught in a downpour on the rooftop, laughing, your jacket around her shoulders and her soaked tee clinging" },
    { "tier": 4, "unlockAt": 80, "title": "Borrowed shirt", "scene": "Morning light through the blinds, Nova in your oversized shirt and little else, dropping the needle on a record" },
    { "tier": 5, "unlockAt": 100, "title": "Encore", "scene": "Her last song of the night is for you; the crowd is a blur and she's looking only at you" }
  ]
}
```
