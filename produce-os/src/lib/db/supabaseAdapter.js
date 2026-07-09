// Supabase adapter — same interface as the local adapter. Used when
// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set. The schema (with
// ON DELETE CASCADE foreign keys) and seed data live in supabase/schema.sql.

import { createClient } from '@supabase/supabase-js'

function unwrap({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

export function createSupabaseAdapter(url, anonKey) {
  const sb = createClient(url, anonKey)

  return {
    kind: 'supabase',

    async listCustomers() {
      return unwrap(await sb.from('customers').select('*').order('name'))
    },

    async listProducts() {
      return unwrap(await sb.from('products').select('*').order('name'))
    },

    async updateProduct(id, patch) {
      return unwrap(await sb.from('products').update(patch).eq('id', id).select().single())
    },

    async getCustomerPrices(customerId) {
      return unwrap(await sb.from('customer_prices').select('*').eq('customer_id', customerId))
    },

    async setCustomerPrice(customerId, productId, price) {
      unwrap(
        await sb
          .from('customer_prices')
          .upsert({ customer_id: customerId, product_id: productId, price }),
      )
    },

    // The critical call: persists raw text before any parsing happens.
    async createOrder({ customer_id, raw_text, status }) {
      return unwrap(
        await sb
          .from('orders')
          .insert({ customer_id, raw_text, status })
          .select()
          .single(),
      )
    },

    async updateOrder(id, patch) {
      return unwrap(await sb.from('orders').update(patch).eq('id', id).select().single())
    },

    async listOrders() {
      return unwrap(await sb.from('orders').select('*').order('created_at', { ascending: false }))
    },

    async getOrder(id) {
      return unwrap(await sb.from('orders').select('*').eq('id', id).maybeSingle())
    },

    async getOrderItems(orderId) {
      return unwrap(await sb.from('order_items').select('*').eq('order_id', orderId))
    },

    async replaceOrderItems(orderId, items) {
      unwrap(await sb.from('order_items').delete().eq('order_id', orderId))
      if (items.length) {
        unwrap(
          await sb.from('order_items').insert(items.map((i) => ({ ...i, order_id: orderId }))),
        )
      }
    },

    // Hard delete: FK cascades in schema.sql remove line items, invoices and
    // invoice items with the order row.
    async deleteOrderCascade(orderId) {
      unwrap(await sb.from('orders').delete().eq('id', orderId))
    },

    async getInvoiceForOrder(orderId) {
      return unwrap(await sb.from('invoices').select('*').eq('order_id', orderId).maybeSingle())
    },

    async createInvoice({ order_id, customer_id }) {
      return unwrap(
        await sb
          .from('invoices')
          .insert({ order_id, customer_id, status: 'draft' })
          .select()
          .single(),
      )
    },

    async updateInvoice(id, patch) {
      return unwrap(await sb.from('invoices').update(patch).eq('id', id).select().single())
    },

    async deleteInvoice(id) {
      unwrap(await sb.from('invoices').delete().eq('id', id))
    },

    async getInvoiceItems(invoiceId) {
      return unwrap(await sb.from('invoice_items').select('*').eq('invoice_id', invoiceId))
    },

    async replaceInvoiceItems(invoiceId, items) {
      unwrap(await sb.from('invoice_items').delete().eq('invoice_id', invoiceId))
      if (items.length) {
        unwrap(
          await sb
            .from('invoice_items')
            .insert(items.map((i) => ({ ...i, invoice_id: invoiceId }))),
        )
      }
    },
  }
}
