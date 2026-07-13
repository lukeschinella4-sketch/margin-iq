import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../lib/db'
import {
  checkAvailability,
  confirmOrder,
  deleteOrder,
  ensureDraftInvoice,
  markReviewed,
  saveOrderItems,
} from '../lib/store'
import { money, orderTotal } from '../lib/pricing'

const STATUS_LABEL = {
  needs_review: 'Needs review',
  parsed: 'Parsed — awaiting confirmation',
  confirmed: 'Confirmed',
}

export default function OrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [order, setOrder] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [customer, setCustomer] = useState(null)
  const [products, setProducts] = useState([])
  const [items, setItems] = useState([])
  const [dirty, setDirty] = useState(false)
  const [shortfalls, setShortfalls] = useState([])
  const [confirmResult, setConfirmResult] = useState(null)
  const [invoice, setInvoice] = useState(null)
  const [invoiceItems, setInvoiceItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [printTarget, setPrintTarget] = useState(null) // 'slip' | 'invoice'

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const reload = useCallback(async () => {
    const o = await db.getOrder(id)
    if (!o) { setNotFound(true); return }
    const [cs, ps, its, inv] = await Promise.all([
      db.listCustomers(),
      db.listProducts(),
      db.getOrderItems(o.id),
      db.getInvoiceForOrder(o.id),
    ])
    setOrder(o)
    setCustomer(cs.find((c) => c.id === o.customer_id) || null)
    setProducts(ps)
    setItems(its)
    setDirty(false)
    setInvoice(inv)
    setInvoiceItems(inv ? await db.getInvoiceItems(inv.id) : [])
    if (o.status !== 'confirmed') setShortfalls(await checkAvailability(its))
  }, [id])

  useEffect(() => { reload() }, [reload])

  // Print flow: set target, let React render the print area, then print.
  const printRef = useRef(null)
  useEffect(() => {
    if (printTarget) {
      const t = setTimeout(() => { window.print(); setPrintTarget(null) }, 50)
      return () => clearTimeout(t)
    }
  }, [printTarget])

  if (notFound) return <p className="muted">Order not found — it may have been deleted.</p>
  if (!order) return <p className="muted">Loading…</p>

  const editable = order.status !== 'confirmed'
  const { total, complete } = orderTotal(items)

  function editItem(index, patch) {
    setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)))
    setDirty(true)
  }

  function addItem() {
    setItems((list) => [
      ...list,
      { product_id: null, description: '', qty: 1, unit: 'box', unit_price: null, confidence: null },
    ])
    setDirty(true)
  }

  function removeItem(index) {
    setItems((list) => list.filter((_, i) => i !== index))
    setDirty(true)
  }

  async function saveLines() {
    setBusy(true)
    try {
      const saved = await saveOrderItems(order.id, order.customer_id, items)
      setItems(saved)
      setDirty(false)
      setShortfalls(await checkAvailability(saved))
    } finally {
      setBusy(false)
    }
  }

  async function handleMarkReviewed() {
    if (dirty) await saveLines()
    setOrder(await markReviewed(order.id))
  }

  async function handleConfirm() {
    setBusy(true)
    try {
      if (dirty) await saveLines()
      const { shortfalls: sf } = await confirmOrder(order.id)
      setConfirmResult(sf)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    const sure = window.confirm(
      'Permanently delete this order?\n\nThis removes the order, all its line items and any invoice. There is no undo and no archive.',
    )
    if (!sure) return
    await deleteOrder(order.id)
    navigate('/')
  }

  async function handleCreateInvoice() {
    setBusy(true)
    try {
      const inv = await ensureDraftInvoice(order)
      setInvoice(inv)
      setInvoiceItems(await db.getInvoiceItems(inv.id))
    } finally {
      setBusy(false)
    }
  }

  function editInvoiceItem(index, patch) {
    setInvoiceItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }

  async function saveInvoiceItems(list = invoiceItems) {
    await db.replaceInvoiceItems(
      invoice.id,
      list.map(({ id: _id, invoice_id: _iid, ...rest }) => rest),
    )
    setInvoiceItems(await db.getInvoiceItems(invoice.id))
  }

  async function approveInvoice() {
    await saveInvoiceItems()
    setInvoice(await db.updateInvoice(invoice.id, { status: 'approved' }))
  }

  async function removeInvoice() {
    const sure = window.confirm('Delete this draft invoice? The order itself is kept.')
    if (!sure) return
    await db.deleteInvoice(invoice.id)
    setInvoice(null)
    setInvoiceItems([])
  }

  const invoiceTotals = orderTotal(invoiceItems)
  const itemName = (it) => (it.product_id && productById.get(it.product_id)?.name) || it.description || '—'

  return (
    <div>
      <div className="no-print">
        <h1>
          Order — {customer?.name || 'Unknown customer'}{' '}
          <span className={`badge ${order.status}`}>{STATUS_LABEL[order.status]}</span>
        </h1>
        <p className="page-sub">
          Received {new Date(order.created_at).toLocaleString()} · {items.length} line{items.length === 1 ? '' : 's'}
        </p>

        {order.status === 'needs_review' && (
          <div className="callout warn">
            <strong>This order needs a human.</strong>{' '}
            {order.parse_note ? `${order.parse_note.replace(/\.?\s*$/, '')}.` : 'It could not be parsed automatically.'} The raw text below is safely
            stored — fix the line items, then mark it reviewed.
          </div>
        )}

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Raw order text (saved before parsing)</h2>
          <div className="raw-text">{order.raw_text}</div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Line items</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: '30%' }}>Product</th>
                <th>Original text</th>
                <th className="num">Qty</th>
                <th>Unit</th>
                <th className="num">Price</th>
                <th className="num">Line total</th>
                {editable && <th></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const stock = it.product_id ? productById.get(it.product_id)?.stock_on_hand : null
                const short = editable && stock != null && it.qty > stock
                return (
                  <tr key={i}>
                    <td>
                      {editable ? (
                        <select
                          value={it.product_id || ''}
                          onChange={(e) => editItem(i, { product_id: e.target.value || null, unit_price: null })}
                          style={{ width: '100%', borderColor: it.product_id ? undefined : 'var(--amber)' }}
                        >
                          <option value="">— unmatched —</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      ) : (
                        itemName(it)
                      )}
                      {short && (
                        <div className="small" style={{ color: 'var(--red)' }}>
                          only {stock} left, this order wants {it.qty}
                        </div>
                      )}
                    </td>
                    <td className="muted small">{it.description}</td>
                    <td className="num">
                      {editable ? (
                        <input
                          className="narrow"
                          type="number"
                          min="0"
                          step="0.5"
                          value={it.qty}
                          onChange={(e) => editItem(i, { qty: parseFloat(e.target.value) || 0 })}
                        />
                      ) : (
                        it.qty
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <select value={it.unit} onChange={(e) => editItem(i, { unit: e.target.value })}>
                          {['box', 'case', 'bag', 'tray', 'kg', 'each', 'bunch', 'punnet'].map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      ) : (
                        it.unit
                      )}
                    </td>
                    <td className="num">
                      {editable ? (
                        <input
                          className="narrow"
                          type="number"
                          min="0"
                          step="0.05"
                          value={it.unit_price ?? ''}
                          placeholder="—"
                          title="Price for this order — edit to override the customer's agreed price"
                          onChange={(e) =>
                            editItem(i, {
                              unit_price: e.target.value === '' ? null : parseFloat(e.target.value) || 0,
                            })
                          }
                        />
                      ) : (
                        money(it.unit_price)
                      )}
                    </td>
                    <td className="num">{it.unit_price != null ? money(it.qty * it.unit_price) : '—'}</td>
                    {editable && (
                      <td>
                        <button className="btn-ghost" title="Remove line" onClick={() => removeItem(i)}>✕</button>
                      </td>
                    )}
                  </tr>
                )
              })}
              <tr className="total-row">
                <td colSpan={4}></td>
                <td className="num">Total</td>
                <td className="num">{money(total)}{!complete && '*'}</td>
                {editable && <td></td>}
              </tr>
            </tbody>
          </table>
          {!complete && (
            <p className="muted small">* some lines are unmatched and unpriced — match them to a product to complete the total.</p>
          )}

          {editable && (
            <div className="btn-row">
              <button onClick={addItem}>＋ Add line</button>
              <button onClick={saveLines} disabled={!dirty || busy}>
                {dirty ? 'Save changes (re-prices lines)' : 'Saved'}
              </button>
            </div>
          )}
        </div>

        {editable && shortfalls.length > 0 && (
          <div className="callout warn">
            <strong>Stock check:</strong>
            <ul style={{ margin: '6px 0 0 18px' }}>
              {shortfalls.map((s, i) => (
                <li key={i}>{s.product}: only {s.available} left, this order wants {s.wanted}</li>
              ))}
            </ul>
            You can still confirm — stock will be zeroed and the shortfall is on you to sort with the customer.
          </div>
        )}

        {confirmResult && (
          confirmResult.length === 0 ? (
            <div className="callout ok">Order confirmed — stock has been decremented. ✅</div>
          ) : (
            <div className="callout warn">
              Order confirmed with shortfalls: {confirmResult.map((s) => `${s.product} (wanted ${s.wanted}, had ${s.available})`).join('; ')}.
            </div>
          )
        )}

        <div className="btn-row">
          {order.status === 'needs_review' && (
            <button className="btn-primary" onClick={handleMarkReviewed} disabled={busy || items.length === 0}>
              ✓ Mark reviewed (ready to confirm)
            </button>
          )}
          {order.status === 'parsed' && (
            <button className="btn-primary" onClick={handleConfirm} disabled={busy || items.length === 0}>
              ✓ Confirm order &amp; take stock
            </button>
          )}
          {order.status === 'confirmed' && (
            <>
              <button className="btn-primary" onClick={() => setPrintTarget('slip')}>🖨 Print picking slip</button>
              {!invoice && (
                <button onClick={handleCreateInvoice} disabled={busy}>Generate draft invoice</button>
              )}
            </>
          )}
          <button className="btn-danger" onClick={handleDelete}>Delete order permanently</button>
        </div>

        {invoice && (
          <div className="card" style={{ marginTop: 22 }}>
            <h2 style={{ marginTop: 0 }}>
              Invoice <span className={`badge ${invoice.status}`}>{invoice.status}</span>
            </h2>
            {invoice.status === 'draft' ? (
              <p className="muted small" style={{ marginTop: -4 }}>
                Fully editable and deletable until you click Approve. Nothing is final yet.
              </p>
            ) : (
              <p className="muted small" style={{ marginTop: -4 }}>Approved and locked.</p>
            )}
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th>Unit</th>
                  <th className="num">Unit price</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoiceItems.map((it, i) => (
                  <tr key={it.id ?? i}>
                    <td>
                      {invoice.status === 'draft' ? (
                        <input
                          style={{ width: '100%' }}
                          value={it.description ?? ''}
                          placeholder={itemName(it)}
                          onChange={(e) => editInvoiceItem(i, { description: e.target.value })}
                        />
                      ) : (
                        itemName(it)
                      )}
                    </td>
                    <td className="num">
                      {invoice.status === 'draft' ? (
                        <input className="narrow" type="number" min="0" step="0.5" value={it.qty}
                          onChange={(e) => editInvoiceItem(i, { qty: parseFloat(e.target.value) || 0 })} />
                      ) : it.qty}
                    </td>
                    <td>{it.unit}</td>
                    <td className="num">
                      {invoice.status === 'draft' ? (
                        <input className="narrow" type="number" min="0" step="0.05" value={it.unit_price ?? ''}
                          onChange={(e) => editInvoiceItem(i, { unit_price: parseFloat(e.target.value) || 0 })} />
                      ) : money(it.unit_price)}
                    </td>
                    <td className="num">{it.unit_price != null ? money(it.qty * it.unit_price) : '—'}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td colSpan={3}></td>
                  <td className="num">Total</td>
                  <td className="num">{money(invoiceTotals.total)}</td>
                </tr>
              </tbody>
            </table>
            <div className="btn-row">
              {invoice.status === 'draft' && (
                <>
                  <button onClick={() => saveInvoiceItems()}>Save invoice edits</button>
                  <button className="btn-primary" onClick={approveInvoice}>Approve invoice (final)</button>
                  <button className="btn-danger" onClick={removeInvoice}>Delete draft invoice</button>
                </>
              )}
              <button onClick={() => setPrintTarget('invoice')}>🖨 Print invoice</button>
            </div>
          </div>
        )}
      </div>

      {/* ---------- print areas ---------- */}
      {printTarget === 'slip' && (
        <div className="print-area" ref={printRef}>
          <h1>Picking Slip</h1>
          <p>
            <strong>{customer?.name}</strong>
            <br />
            Order received {new Date(order.created_at).toLocaleString()}
          </p>
          <table>
            <thead>
              <tr><th>✔</th><th>Product</th><th className="num">Qty</th><th>Unit</th></tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td style={{ width: 30 }}>☐</td>
                  <td>{itemName(it)}</td>
                  <td className="num">{it.qty}</td>
                  <td>{it.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Picked by: ______________________ &nbsp;&nbsp; Checked by: ______________________</p>
        </div>
      )}

      {printTarget === 'invoice' && invoice && (
        <div className="print-area" ref={printRef}>
          <h1>{invoice.status === 'draft' ? 'DRAFT Invoice' : 'Invoice'}</h1>
          <p>
            <strong>Bill to: {customer?.name}</strong>
            <br />
            {customer?.contact}
            <br />
            Order date {new Date(order.created_at).toLocaleDateString()}
          </p>
          <table>
            <thead>
              <tr><th>Item</th><th className="num">Qty</th><th>Unit</th><th className="num">Unit price</th><th className="num">Total</th></tr>
            </thead>
            <tbody>
              {invoiceItems.map((it, i) => (
                <tr key={i}>
                  <td>{it.description || itemName(it)}</td>
                  <td className="num">{it.qty}</td>
                  <td>{it.unit}</td>
                  <td className="num">{money(it.unit_price)}</td>
                  <td className="num">{it.unit_price != null ? money(it.qty * it.unit_price) : '—'}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={3}></td>
                <td className="num">Total</td>
                <td className="num">{money(invoiceTotals.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
