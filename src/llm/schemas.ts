// JSON schemas for Claude's structured outputs (output_config.format). They mirror the JSON shapes
// in docs/SPEC.md; the coercers in ./coerce.ts still clamp ranges and fill defaults.

export type JsonSchema = Record<string, unknown>

const TRAIT_TYPES = ['like', 'dislike', 'turnOn', 'turnOff']
const AGREEMENTS = ['exclusive', 'open', 'poly', 'casual', 'none']

/** {"delta", "trustDelta", "hits": [{"type", "id"}], "mood", "hint", "jealousy", "breach"} */
export const JUDGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    delta: { type: 'integer' },
    trustDelta: { type: 'integer' },
    hits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: TRAIT_TYPES },
          id: { type: 'string' },
        },
        required: ['type', 'id'],
        additionalProperties: false,
      },
    },
    mood: { type: 'string' },
    hint: { type: 'string' },
    jealousy: { type: 'boolean' },
    breach: { type: 'boolean' },
  },
  required: ['delta', 'trustDelta', 'hits', 'mood', 'hint', 'jealousy', 'breach'],
  additionalProperties: false,
}

/** {"agreement", "accepted", "terms", "trustDelta"} */
export const AGREEMENT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    agreement: { type: 'string', enum: AGREEMENTS },
    accepted: { type: 'boolean' },
    terms: { type: 'string' },
    trustDelta: { type: 'integer' },
  },
  required: ['agreement', 'accepted', 'terms', 'trustDelta'],
  additionalProperties: false,
}

/** Three suggestion strings keyed sweet/flirty/bold (romantic) or sweet/curious/honest (friend). */
export function suggestionsSchema(keys: readonly string[]): JsonSchema {
  return {
    type: 'object',
    properties: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])),
    required: [...keys],
    additionalProperties: false,
  }
}
