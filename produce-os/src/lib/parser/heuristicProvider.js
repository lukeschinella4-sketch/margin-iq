// Rule-based fallback parser. Used when no AI API key is configured, and as
// the safety net if the AI provider throws. Matches free-text lines against
// the product catalog (names + known aliases) and extracts quantity/unit.

const UNIT_WORDS = {
  box: 'box', boxes: 'box', bx: 'box',
  case: 'case', cases: 'case', ctn: 'case', carton: 'case', cartons: 'case',
  bag: 'bag', bags: 'bag', sack: 'bag', sacks: 'bag',
  tray: 'tray', trays: 'tray',
  kg: 'kg', kilo: 'kg', kilos: 'kg',
  each: 'each', ea: 'each', pc: 'each', pcs: 'each',
  bunch: 'bunch', bunches: 'bunch',
  punnet: 'punnet', punnets: 'punnet',
}

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dozen: 12,
  half: 0.5, couple: 2, 'couple of': 2, few: 3,
}

function normalise(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s.]/g, ' ').replace(/\s+/g, ' ').trim()
}

function matchProduct(text, products) {
  const t = ` ${normalise(text)} `
  let best = null
  for (const p of products) {
    const candidates = [p.name, ...(p.aliases || [])]
    for (const cand of candidates) {
      const c = normalise(cand)
      if (!c) continue
      if (t.includes(` ${c} `) || t.includes(` ${c}s `)) {
        const score = c.length // longer match = more specific
        if (!best || score > best.score) best = { product: p, score }
      }
    }
  }
  return best ? best.product : null
}

export function heuristicParse(rawText, products) {
  const lines = rawText
    .split(/[\n;]|,(?![^(]*\))/)
    .map((l) => l.trim())
    .filter(Boolean)

  const items = []
  for (const line of lines) {
    const norm = normalise(line)
    if (!norm) continue

    // quantity: leading number, number anywhere, or a number word
    let qty = null
    const numMatch = norm.match(/(\d+(?:\.\d+)?)/)
    if (numMatch) qty = parseFloat(numMatch[1])
    else {
      for (const [word, value] of Object.entries(NUMBER_WORDS)) {
        if (new RegExp(`(^|\\s)${word}(\\s|$)`).test(norm)) { qty = value; break }
      }
    }

    let unit = null
    for (const token of norm.split(' ')) {
      if (UNIT_WORDS[token]) { unit = UNIT_WORDS[token]; break }
    }

    const product = matchProduct(line, products)

    let confidence = 0
    if (product) confidence += 0.6
    if (qty != null) confidence += 0.3
    else if (unit) { qty = 1; confidence += 0.25 } // "case nanas" = one case
    if (unit) confidence += 0.1
    if (product && !unit) unit = product.unit
    if (product && qty == null) { qty = 1; confidence -= 0.15 }

    items.push({
      product_id: product ? product.id : null,
      description: line,
      qty: qty ?? 1,
      unit: unit || 'each',
      confidence: Math.max(0, Math.min(1, confidence)),
    })
  }

  const overall = items.length
    ? Math.min(...items.map((i) => i.confidence))
    : 0

  return { items, confidence: overall, provider: 'heuristic' }
}
