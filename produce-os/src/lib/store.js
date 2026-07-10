// Workflow layer on top of the db adapter. This is where the reliability
// guarantees live:
//
//  1. intakeOrder() persists the raw text (status needs_review) BEFORE any
//     parsing. If the parser crashes, the browser dies, or the AI hallucinates,
//     the order already exists and is visible in the Needs Review queue.
//  2. Parsing can only ever UPGRADE an order (needs_review -> parsed). No code
//     path deletes or downgrades an order except the explicit user delete.
//  3. deleteOrder() is the only delete: hard, cascading, user-initiated.

import { db } from './db'
import { parseOrder, CONFIDENCE_THRESHOLD } from './parser'
import { buildPriceLookup } from './pricing'

export { CONFIDENCE_THRESHOLD }

export async function intakeOrder(customerId, rawText) {
  // Step 1 — save the raw order first. Default status is needs_review so
  // that if anything after this line fails, the order is safe and flagged.
  const order = await db.createOrder({
    customer_id: customerId,
    raw_text: rawText,
    status: 'needs_review',
  })

  // Step 2 — parse. parseOrder never throws; belt-and-braces try/catch anyway.
  let result
  try {
    const products = await db.listProducts()
    result = await parseOrder(rawText, products)
  } catch (err) {
    result = { ok: false, items: [], confidence: 0, error: err.message }
  }

  // Step 3 — attach whatever we got, priced with the customer's price list.
  if (result.items?.length) {
    try {
      const priced = await priceItems(customerId, result.items)
      await db.replaceOrderItems(order.id, priced)
    } catch {
      // Items failed to save — order stays in needs_review with its raw text.
    }
  }

  const parsedOk = result.ok && result.items.length > 0 && result.confidence >= CONFIDENCE_THRESHOLD
  const note = !result.ok
    ? `Parse failed: ${result.error || 'unknown error'}`
    : result.error
      ? result.error
      : !result.items.length
        ? 'Parser found no line items in the text'
        : result.confidence < CONFIDENCE_THRESHOLD
          ? `Low parse confidence (${Math.round(result.confidence * 100)}%) — please check the lines against the raw text`
          : null

  const updated = await db.updateOrder(order.id, {
    status: parsedOk ? 'parsed' : 'needs_review',
    parse_note: note,
  })

  return updated
}

// Manual (POS) entry: no parsing involved, but the same save-first discipline —
// the order row is written before its items, so a failure part-way leaves a
// visible needs_review order rather than nothing.
export async function intakeManualOrder(customerId, cart) {
  const products = await db.listProducts()
  const byId = new Map(products.map((p) => [p.id, p]))
  const summary = cart
    .map((c) => {
      const p = byId.get(c.product_id)
      return `${c.qty} ${p ? `${p.unit} ${p.name}` : c.product_id}`
    })
    .join('\n')

  const order = await db.createOrder({
    customer_id: customerId,
    raw_text: `Manual entry (POS):\n${summary}`,
    status: 'needs_review',
  })

  const priced = await priceItems(
    customerId,
    cart.map((c) => {
      const p = byId.get(c.product_id)
      return {
        product_id: c.product_id,
        description: p ? p.name : '',
        qty: c.qty,
        unit: p ? p.unit : 'each',
        unit_price: c.price ?? null, // on-the-fly override from the POS cart
        confidence: 1,
      }
    }),
  )
  await db.replaceOrderItems(order.id, priced)

  return db.updateOrder(order.id, { status: 'parsed', parse_note: null })
}

async function priceItems(customerId, items) {
  const [products, customerPrices] = await Promise.all([
    db.listProducts(),
    db.getCustomerPrices(customerId),
  ])
  const priceFor = buildPriceLookup(products, customerPrices)
  return items.map((i) => ({
    product_id: i.product_id ?? null,
    description: i.description,
    qty: i.qty,
    unit: i.unit,
    // A manually set price wins; otherwise resolve from the customer's list.
    unit_price: i.unit_price ?? priceFor(i.product_id),
    confidence: i.confidence ?? null,
  }))
}

// Save manually edited line items (review fixes / pre-confirm edits) and
// re-resolve prices for any newly matched products.
export async function saveOrderItems(orderId, customerId, items) {
  const priced = await priceItems(customerId, items)
  await db.replaceOrderItems(orderId, priced)
  return priced
}

export async function markReviewed(orderId) {
  return db.updateOrder(orderId, { status: 'parsed', parse_note: null })
}

// Returns { order, shortfalls } — shortfalls lists lines where stock could
// not cover the requested quantity, so the user can give the customer a
// straight yes/no.
export async function confirmOrder(orderId) {
  const [items, products] = await Promise.all([db.getOrderItems(orderId), db.listProducts()])
  const byId = new Map(products.map((p) => [p.id, p]))

  const shortfalls = []
  for (const item of items) {
    const p = item.product_id ? byId.get(item.product_id) : null
    if (!p) continue
    if (item.qty > p.stock_on_hand) {
      shortfalls.push({
        product: p.name,
        wanted: item.qty,
        available: p.stock_on_hand,
      })
    }
    await db.updateProduct(p.id, { stock_on_hand: Math.max(0, p.stock_on_hand - item.qty) })
  }

  const order = await db.updateOrder(orderId, { status: 'confirmed' })
  return { order, shortfalls }
}

// Preview shortfalls without touching stock (shown before the user confirms).
export async function checkAvailability(items) {
  const products = await db.listProducts()
  const byId = new Map(products.map((p) => [p.id, p]))
  return items
    .filter((i) => i.product_id && byId.get(i.product_id))
    .filter((i) => i.qty > byId.get(i.product_id).stock_on_hand)
    .map((i) => ({
      product: byId.get(i.product_id).name,
      wanted: i.qty,
      available: byId.get(i.product_id).stock_on_hand,
    }))
}

// The ONLY way an order leaves the system. User-initiated, permanent,
// cascading. Stock consumed by a confirmed order is returned to the shelf
// before the records are removed.
export async function deleteOrder(orderId) {
  const order = await db.getOrder(orderId)
  if (!order) return
  if (order.status === 'confirmed') {
    const [items, products] = await Promise.all([db.getOrderItems(orderId), db.listProducts()])
    const byId = new Map(products.map((p) => [p.id, p]))
    for (const item of items) {
      const p = item.product_id ? byId.get(item.product_id) : null
      if (p) await db.updateProduct(p.id, { stock_on_hand: p.stock_on_hand + item.qty })
    }
  }
  await db.deleteOrderCascade(orderId)
}

// Draft invoice: created from the priced order lines, then independently
// editable until approved.
export async function ensureDraftInvoice(order) {
  const existing = await db.getInvoiceForOrder(order.id)
  if (existing) return existing
  const invoice = await db.createInvoice({ order_id: order.id, customer_id: order.customer_id })
  const items = await db.getOrderItems(order.id)
  await db.replaceInvoiceItems(
    invoice.id,
    items.map((i) => ({
      description: i.description,
      product_id: i.product_id,
      qty: i.qty,
      unit: i.unit,
      unit_price: i.unit_price,
    })),
  )
  return invoice
}
