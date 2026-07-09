import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { intakeOrder } from '../lib/store'
import { parserName } from '../lib/parser'
import { SEED_DEMO_ORDER_TEXT } from '../lib/seed'

export default function NewOrder() {
  const [customers, setCustomers] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [rawText, setRawText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    db.listCustomers().then((cs) => {
      setCustomers(cs)
      if (cs.length) setCustomerId((prev) => prev || cs[0].id)
    })
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (!customerId || !rawText.trim()) return
    setBusy(true)
    setError(null)
    try {
      // Raw text is saved first inside intakeOrder — before any AI parsing.
      const order = await intakeOrder(customerId, rawText.trim())
      navigate(`/orders/${order.id}`)
    } catch (err) {
      // Even here the order may already be saved; the dashboard will show it.
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div>
      <h1>New Order</h1>
      <p className="page-sub">
        Paste the customer&rsquo;s email or text exactly as it arrived. The raw text is saved first,
        then parsed with the {parserName()} — a failed parse goes to the review queue, never in the bin.
      </p>

      <form className="card" onSubmit={submit} style={{ maxWidth: 640 }}>
        <label className="field">
          <span>Customer</span>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Raw order text (email / SMS)</span>
          <textarea
            rows={7}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={'e.g.\n2 boxes toms, 5 iceberg, case nanas\nbag of spuds if you have them'}
            required
          />
        </label>

        {error && <div className="callout error">Something went wrong: {error}. Check the dashboard — the order text may already be saved in the review queue.</div>}

        <div className="btn-row">
          <button className="btn-primary" type="submit" disabled={busy || !rawText.trim()}>
            {busy ? 'Saving & parsing…' : 'Save & parse order'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setRawText(SEED_DEMO_ORDER_TEXT)}>
            Use example text
          </button>
        </div>
      </form>
    </div>
  )
}
