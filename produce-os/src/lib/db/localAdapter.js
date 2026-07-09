// LocalStorage-backed adapter. Same interface as the Supabase adapter, so the
// app runs out of the box with seeded demo data when no Supabase project is
// configured. Every write is persisted synchronously before the promise
// resolves — an order saved here survives a reload immediately.

import { SEED_CUSTOMERS, SEED_PRODUCTS, buildSeedCustomerPrices } from '../seed'

const KEY = 'produce-os-db-v1'

function load() {
  const raw = localStorage.getItem(KEY)
  if (raw) return JSON.parse(raw)
  const db = {
    customers: SEED_CUSTOMERS.map(({ price_factor, ...c }) => c),
    products: SEED_PRODUCTS,
    customer_prices: buildSeedCustomerPrices(),
    orders: [],
    order_items: [],
    invoices: [],
    invoice_items: [],
  }
  localStorage.setItem(KEY, JSON.stringify(db))
  return db
}

function save(db) {
  localStorage.setItem(KEY, JSON.stringify(db))
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))

export function createLocalAdapter() {
  return {
    kind: 'local',

    async listCustomers() {
      return [...load().customers].sort((a, b) => a.name.localeCompare(b.name))
    },

    async listProducts() {
      return [...load().products].sort((a, b) => a.name.localeCompare(b.name))
    },

    async updateProduct(id, patch) {
      const db = load()
      const p = db.products.find((x) => x.id === id)
      if (!p) throw new Error('Product not found')
      Object.assign(p, patch)
      save(db)
      return p
    },

    async getCustomerPrices(customerId) {
      return load().customer_prices.filter((r) => r.customer_id === customerId)
    },

    async setCustomerPrice(customerId, productId, price) {
      const db = load()
      const row = db.customer_prices.find(
        (r) => r.customer_id === customerId && r.product_id === productId,
      )
      if (row) row.price = price
      else db.customer_prices.push({ customer_id: customerId, product_id: productId, price })
      save(db)
    },

    // The critical call: persists raw text before any parsing happens.
    async createOrder({ customer_id, raw_text, status }) {
      const db = load()
      const order = {
        id: uid(),
        customer_id,
        raw_text,
        status,
        parse_note: null,
        created_at: new Date().toISOString(),
      }
      db.orders.push(order)
      save(db)
      return order
    },

    async updateOrder(id, patch) {
      const db = load()
      const o = db.orders.find((x) => x.id === id)
      if (!o) throw new Error('Order not found')
      Object.assign(o, patch)
      save(db)
      return o
    },

    async listOrders() {
      return [...load().orders].sort((a, b) => b.created_at.localeCompare(a.created_at))
    },

    async getOrder(id) {
      const db = load()
      return db.orders.find((x) => x.id === id) || null
    },

    async getOrderItems(orderId) {
      return load().order_items.filter((i) => i.order_id === orderId)
    },

    async replaceOrderItems(orderId, items) {
      const db = load()
      db.order_items = db.order_items.filter((i) => i.order_id !== orderId)
      for (const item of items) {
        db.order_items.push({ id: uid(), order_id: orderId, ...item })
      }
      save(db)
    },

    // Hard delete with cascade: order, its line items, and any invoice
    // (draft or approved) plus invoice items. Nothing is kept.
    async deleteOrderCascade(orderId) {
      const db = load()
      const invoiceIds = db.invoices.filter((v) => v.order_id === orderId).map((v) => v.id)
      db.invoice_items = db.invoice_items.filter((i) => !invoiceIds.includes(i.invoice_id))
      db.invoices = db.invoices.filter((v) => v.order_id !== orderId)
      db.order_items = db.order_items.filter((i) => i.order_id !== orderId)
      db.orders = db.orders.filter((o) => o.id !== orderId)
      save(db)
    },

    async getInvoiceForOrder(orderId) {
      const db = load()
      return db.invoices.find((v) => v.order_id === orderId) || null
    },

    async createInvoice({ order_id, customer_id }) {
      const db = load()
      const invoice = {
        id: uid(),
        order_id,
        customer_id,
        status: 'draft',
        created_at: new Date().toISOString(),
      }
      db.invoices.push(invoice)
      save(db)
      return invoice
    },

    async updateInvoice(id, patch) {
      const db = load()
      const v = db.invoices.find((x) => x.id === id)
      if (!v) throw new Error('Invoice not found')
      Object.assign(v, patch)
      save(db)
      return v
    },

    async deleteInvoice(id) {
      const db = load()
      db.invoice_items = db.invoice_items.filter((i) => i.invoice_id !== id)
      db.invoices = db.invoices.filter((v) => v.id !== id)
      save(db)
    },

    async getInvoiceItems(invoiceId) {
      return load().invoice_items.filter((i) => i.invoice_id === invoiceId)
    },

    async replaceInvoiceItems(invoiceId, items) {
      const db = load()
      db.invoice_items = db.invoice_items.filter((i) => i.invoice_id !== invoiceId)
      for (const item of items) {
        db.invoice_items.push({ id: uid(), invoice_id: invoiceId, ...item })
      }
      save(db)
    },
  }
}
