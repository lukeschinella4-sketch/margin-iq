import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { intakeManualOrder, confirmOrder } from '../lib/store'
import { buildPriceLookup, money } from '../lib/pricing'

// POS-style manual order entry: tap product buttons to build an order on the
// spot (walk-ins, phone orders). No parsing involved — the order is structured
// from the start, but it flows through the same pipeline (priced from the
// customer's list, stock-checked, confirmable, picking slip, invoice).

export default function Pos() {
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [customerPrices, setCustomerPrices] = useState([])
  const [cart, setCart] = useState([]) // [{ product_id, qty }]
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null) // last-added product id, for tap feedback
  const navigate = useNavigate()

  useEffect(() => {
    ;(async () => {
      const [cs, ps] = await Promise.all([db.listCustomers(), db.listProducts()])
      setCustomers(cs)
      setProducts(ps)
      if (cs.length) setCustomerId((prev) => prev || cs[0].id)
    })()
  }, [])

  useEffect(() => {
    if (customerId) db.getCustomerPrices(customerId).then(setCustomerPrices)
  }, [customerId])

  const priceFor = useMemo(
    () => buildPriceLookup(products, customerPrices),
    [products, customerPrices],
  )
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const inCart = (id) => cart.find((c) => c.product_id === id)

  function add(productId) {
    setCart((c) => {
      const existing = c.find((x) => x.product_id === productId)
      if (existing) {
        return c.map((x) => (x.product_id === productId ? { ...x, qty: x.qty + 1 } : x))
      }
      return [...c, { product_id: productId, qty: 1 }]
    })
    setFlash(productId)
    setTimeout(() => setFlash(null), 250)
  }

  function setQty(productId, qty) {
    setCart((c) =>
      qty <= 0
        ? c.filter((x) => x.product_id !== productId)
        : c.map((x) => (x.product_id === productId ? { ...x, qty } : x)),
    )
  }

  const total = cart.reduce((sum, c) => sum + (priceFor(c.product_id) ?? 0) * c.qty, 0)

  async function save(alsoConfirm) {
    if (!customerId || cart.length === 0) return
    setBusy(true)
    try {
      // Saved through the same reliability pipeline: the order row (with a
      // human-readable raw_text summary) is written before anything else.
      const order = await intakeManualOrder(customerId, cart)
      if (alsoConfirm) await confirmOrder(order.id)
      navigate(`/orders/${order.id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1>POS Entry</h1>
      <p className="page-sub">
        Tap products to build an order on the spot — walk-ins, phone orders, or anything that
        doesn&rsquo;t come in as text. Prices shown are the selected customer&rsquo;s agreed prices.
      </p>

      <label className="field" style={{ maxWidth: 340 }}>
        <span>Customer</span>
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ width: '100%' }}>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      <div className="pos-layout">
        <div className="pos-grid">
          {products.map((p) => {
            const line = inCart(p.id)
            const out = p.stock_on_hand <= 0
            return (
              <button
                key={p.id}
                type="button"
                className={`pos-btn ${line ? 'in-cart' : ''} ${flash === p.id ? 'flash' : ''} ${out ? 'out' : ''}`}
                onClick={() => add(p.id)}
              >
                {line && <span className="pos-count">{line.qty}</span>}
                <span className="pos-name">{p.name}</span>
                <span className="pos-price">{money(priceFor(p.id))} / {p.unit}</span>
                <span className={`pos-stock ${p.stock_on_hand <= 5 ? 'low' : ''}`}>
                  {out ? 'out of stock' : `${p.stock_on_hand} left`}
                </span>
              </button>
            )
          })}
        </div>

        <div className="pos-cart card">
          <h2 style={{ marginTop: 0 }}>Order</h2>
          {cart.length === 0 ? (
            <p className="muted small">Tap a product to add it.</p>
          ) : (
            <>
              {cart.map((c) => {
                const p = productById.get(c.product_id)
                const price = priceFor(c.product_id)
                const short = p && c.qty > p.stock_on_hand
                return (
                  <div className="pos-line" key={c.product_id}>
                    <div className="pos-line-main">
                      <div>{p?.name}</div>
                      <div className="muted small">
                        {money(price)} / {p?.unit}
                        {short && (
                          <span style={{ color: 'var(--red)' }}> · only {p.stock_on_hand} left</span>
                        )}
                      </div>
                    </div>
                    <div className="pos-stepper">
                      <button type="button" onClick={() => setQty(c.product_id, c.qty - 1)}>−</button>
                      <span>{c.qty}</span>
                      <button type="button" onClick={() => setQty(c.product_id, c.qty + 1)}>＋</button>
                    </div>
                    <div className="pos-line-total">{money((price ?? 0) * c.qty)}</div>
                  </div>
                )
              })}
              <div className="pos-total">
                <span>Total</span>
                <span>{money(total)}</span>
              </div>
              <div className="btn-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <button className="btn-primary" disabled={busy} onClick={() => save(true)}>
                  ✓ Save &amp; confirm (takes stock)
                </button>
                <button disabled={busy} onClick={() => save(false)}>
                  Save as pending
                </button>
                <button className="btn-ghost" disabled={busy} onClick={() => setCart([])}>
                  Clear
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
