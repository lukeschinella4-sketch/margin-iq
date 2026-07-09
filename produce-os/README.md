# Produce OS 🥬

Order management for fruit & veg wholesalers. Customers send messy free-text
orders every morning ("2 boxes toms, 5 iceberg, case nanas"); Produce OS turns
them into priced, stock-checked, confirmable orders with picking slips and
draft invoices — without ever losing an order.

## Run it

```bash
cd produce-os
npm install
npm run dev
```

It works out of the box: with no configuration it uses a **seeded local demo
database** (5 customers with their own price lists, 20 products with today's
prices and stock) and a **built-in rule-based parser**. Add keys in `.env`
(see `.env.example`) to switch on the real backends:

| Env var | Effect |
|---|---|
| `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` | Store data in Supabase (run `supabase/schema.sql` first — it creates the tables and the same seed data) |
| `VITE_ANTHROPIC_API_KEY` | Parse orders with Claude instead of the rule-based matcher |
| `VITE_ANTHROPIC_MODEL` | Swap the model (defaults to `claude-opus-4-8`) |

## Reliability: an order is never lost

This is the core design rule, enforced in `src/lib/store.js`:

1. **Raw text is saved first.** `intakeOrder()` writes the order (status
   `needs_review`) to the database *before* the parser is invoked.
2. **Parsing only upgrades.** A successful, confident parse moves the order to
   `parsed`. A failed or low-confidence parse leaves it in the **Needs review**
   queue, clearly flagged on the dashboard, with the raw text intact for a
   human to fix manually. If the AI provider errors, the built-in matcher is
   tried as a fallback — and that result is deliberately capped below the
   confidence threshold so a human still reviews it.
3. **Nothing disappears on its own.** Every order is always visible with one
   of three statuses: `needs_review` → `parsed` → `confirmed`.
4. **Deletes are explicit and total.** The only delete is the user pressing
   "Delete order permanently" (with a confirm dialog). It hard-deletes the
   order, its line items and any invoice — no history, no soft-delete, no
   archive. Stock consumed by a confirmed order is returned to the shelf first.

## Morning flow

1. **Products & Stock** — set today's prices and boxes on hand.
2. **New Order** — pick the customer, paste the email/text, *Save & parse*.
3. Review the parsed lines (each priced from the customer's agreed price
   list), watch for stock shortfall flags ("only 12 left, this order wants
   15"), then **Confirm** — stock is decremented.
4. **Print the picking slip** for the warehouse.
5. **Generate the draft invoice** — editable and deletable until you click
   *Approve*.

## Architecture (clean seams for later)

```
src/lib/
  db/            one interface, two adapters
    localAdapter.js      localStorage + seed (default)
    supabaseAdapter.js   Supabase (schema in supabase/schema.sql)
  parser/        one interface, two providers
    anthropicProvider.js Claude with structured outputs (model = one constant)
    heuristicProvider.js rule-based fallback, also used when AI errors
  store.js       workflow rules: save-raw-first, confirm+stock, cascade delete
  pricing.js     customer price list resolution
```

Deliberately **not** built (the seams above are where they'd plug in):
inventory valuation/stocktake, accounting integration, SMS gateway, delivery
routing, payments.
