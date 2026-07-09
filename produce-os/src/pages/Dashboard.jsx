import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { money, orderTotal } from '../lib/pricing'

const STATUS_LABEL = {
  needs_review: 'Needs review',
  parsed: 'Parsed',
  confirmed: 'Confirmed',
}

export default function Dashboard() {
  const [orders, setOrders] = useState(null)
  const [customers, setCustomers] = useState([])
  const [totals, setTotals] = useState({})
  const navigate = useNavigate()

  useEffect(() => {
    ;(async () => {
      const [ords, custs] = await Promise.all([db.listOrders(), db.listCustomers()])
      setOrders(ords)
      setCustomers(custs)
      const t = {}
      for (const o of ords) {
        const items = await db.getOrderItems(o.id)
        t[o.id] = orderTotal(items)
      }
      setTotals(t)
    })()
  }, [])

  if (!orders) return <p className="muted">Loading…</p>

  const customerName = (id) => customers.find((c) => c.id === id)?.name || '—'
  const todayKey = new Date().toISOString().slice(0, 10)
  const today = orders.filter((o) => o.created_at.slice(0, 10) === todayKey)
  const needsReview = orders.filter((o) => o.status === 'needs_review')
  const older = orders.filter((o) => o.created_at.slice(0, 10) !== todayKey && o.status !== 'needs_review')

  const OrderRows = ({ list }) => (
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Customer</th>
          <th>Order</th>
          <th>Status</th>
          <th className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {list.map((o) => (
          <tr key={o.id} className="clickable-row" onClick={() => navigate(`/orders/${o.id}`)}>
            <td className="muted small">
              {new Date(o.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </td>
            <td>{customerName(o.customer_id)}</td>
            <td className="muted small" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {o.raw_text}
            </td>
            <td><span className={`badge ${o.status}`}>{STATUS_LABEL[o.status]}</span></td>
            <td className="num">{totals[o.id]?.complete ? money(totals[o.id].total) : totals[o.id] ? `${money(totals[o.id].total)}*` : '…'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="page-sub">Every order in the system, always visible with a clear status.</p>

      <div className="stat-grid">
        <div className="stat"><div className="n">{today.length}</div><div className="l">Orders today</div></div>
        <div className="stat"><div className="n">{needsReview.length}</div><div className="l">Needs review</div></div>
        <div className="stat"><div className="n">{orders.filter((o) => o.status === 'confirmed').length}</div><div className="l">Confirmed</div></div>
      </div>

      {needsReview.length > 0 && (
        <div className="card" style={{ borderColor: '#f3ddba' }}>
          <h2 style={{ marginTop: 0 }}>⚠️ Needs review</h2>
          <p className="muted small" style={{ marginTop: -4 }}>
            These orders were saved but could not be parsed confidently. Nothing is lost — open one to fix it by hand.
          </p>
          <OrderRows list={needsReview} />
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Today&rsquo;s orders</h2>
        {today.length === 0 ? (
          <p className="muted">
            No orders yet today. <Link to="/new">Paste one in</Link> to get started.
          </p>
        ) : (
          <OrderRows list={today} />
        )}
      </div>

      {older.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Earlier orders</h2>
          <OrderRows list={older} />
        </div>
      )}
    </div>
  )
}
