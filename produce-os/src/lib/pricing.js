// Price resolution: the customer's agreed price for a product when one
// exists, otherwise today's base price.

export function buildPriceLookup(products, customerPrices) {
  const base = new Map(products.map((p) => [p.id, p.price_today]))
  const agreed = new Map(customerPrices.map((r) => [r.product_id, r.price]))
  return (productId) => {
    if (productId == null) return null
    if (agreed.has(productId)) return agreed.get(productId)
    return base.get(productId) ?? null
  }
}

export function money(n) {
  if (n == null || Number.isNaN(n)) return '—'
  return `$${Number(n).toFixed(2)}`
}

export function lineTotal(item) {
  if (item.unit_price == null) return null
  return item.qty * item.unit_price
}

export function orderTotal(items) {
  let total = 0
  let complete = true
  for (const i of items) {
    const t = lineTotal(i)
    if (t == null) complete = false
    else total += t
  }
  return { total, complete }
}
