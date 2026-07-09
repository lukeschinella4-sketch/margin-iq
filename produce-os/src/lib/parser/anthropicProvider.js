// AI order parser using the official Anthropic SDK with structured outputs.
// The model ID is a single constant so it can be swapped in one place, and the
// whole provider sits behind parseOrder() in ./index.js, so the AI vendor
// itself is equally swappable.

import Anthropic from '@anthropic-ai/sdk'

const MODEL = import.meta.env.VITE_ANTHROPIC_MODEL || 'claude-opus-4-8'

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          product_id: {
            type: ['string', 'null'],
            description: 'ID from the catalog, or null if no confident match',
          },
          description: { type: 'string', description: 'The original text for this line item' },
          qty: { type: 'number' },
          unit: { type: 'string', description: 'box, case, bag, tray, kg, each, bunch or punnet' },
          confidence: { type: 'number', description: '0 to 1: how sure you are about this line' },
        },
        required: ['product_id', 'description', 'qty', 'unit', 'confidence'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'number', description: '0 to 1: overall confidence for the whole order' },
  },
  required: ['items', 'confidence'],
  additionalProperties: false,
}

export async function anthropicParse(rawText, products, apiKey) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  const catalog = products
    .map((p) => `${p.id} | ${p.name} | sold per ${p.unit}${p.aliases?.length ? ` | aka: ${p.aliases.join(', ')}` : ''}`)
    .join('\n')

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system:
      'You parse messy free-text produce orders (from emails/texts to a fruit & veg wholesaler) ' +
      'into structured line items. Match each line to a product in the catalog when you can; use ' +
      'null product_id when unsure rather than guessing. Preserve the original wording in ' +
      'description. If quantity is ambiguous, make a sensible assumption and lower the confidence. ' +
      'Lines that are greetings, sign-offs or chatter are not line items — skip them.',
    messages: [
      {
        role: 'user',
        content: `Product catalog:\n${catalog}\n\nRaw order text:\n${rawText}`,
      },
    ],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  })

  if (response.stop_reason === 'refusal') {
    throw new Error('AI parser declined the request')
  }

  const text = response.content.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('AI parser returned no output')

  const parsed = JSON.parse(text)
  return { ...parsed, provider: `anthropic:${MODEL}` }
}
