// Parser facade. Everything above this file calls parseOrder() and never
// touches an AI SDK directly, so the model/vendor can be swapped freely.
//
// Behaviour contract (reliability): parseOrder never throws. It returns
//   { ok, items, confidence, provider, error }
// and the caller has ALREADY saved the raw order before calling this.

import { anthropicParse } from './anthropicProvider'
import { heuristicParse } from './heuristicProvider'

// Below this overall confidence, an order goes to the Needs Review queue.
export const CONFIDENCE_THRESHOLD = 0.6

export function parserName() {
  return import.meta.env.VITE_ANTHROPIC_API_KEY ? 'AI (Anthropic)' : 'built-in matcher'
}

export async function parseOrder(rawText, products) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY

  if (apiKey) {
    try {
      const result = await anthropicParse(rawText, products, apiKey)
      return { ok: true, error: null, ...result }
    } catch (err) {
      // AI failed — fall back to the heuristic parser rather than losing the
      // parse entirely. The lower confidence will route it to review.
      try {
        const fallback = heuristicParse(rawText, products)
        return {
          ok: true,
          error: `AI parse failed (${err.message}); used built-in matcher instead`,
          ...fallback,
          confidence: Math.min(fallback.confidence, CONFIDENCE_THRESHOLD - 0.01),
        }
      } catch (err2) {
        return { ok: false, items: [], confidence: 0, provider: 'none', error: err2.message }
      }
    }
  }

  try {
    return { ok: true, error: null, ...heuristicParse(rawText, products) }
  } catch (err) {
    return { ok: false, items: [], confidence: 0, provider: 'none', error: err.message }
  }
}
