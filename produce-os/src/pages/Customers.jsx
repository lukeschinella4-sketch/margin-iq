import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { money } from '../lib/pricing'

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [selected, setSelected] = useState(null)
  const [prices, setPrices] = useState({}) // product_id -> price

  useEffect(() => {
    ;(async () => {
      const [cs, ps] = await Promise.all([db.listCustomers(), db.listProducts()])
      setCustomers(cs)
      setProducts(ps)
      if (cs.length) select(cs[0])
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function select(customer) {
    setSelected(customer)
    const rows = await db.getCustomerPrices(customer.id)
    setPrices(Object.fromEntries(rows.map((r) => [r.product_id, r.price])))
  }

  async function updatePrice(productId, value) {
    const price = parseFloat(value)
    if (Number.isNaN(price) || price < 0) return
    setPrices((p) => ({ ...p, [productId]: price }))
    await db.setCustomerPrice(selected.id, productId, price)
  }

  return (
    <div>
      <h1>Customers</h1>
      <p className="page-sub">Each customer has their own agreed price list, applied automatically when their orders are priced.</p>

      <div className="card">
        <table>
          <thead>
            <tr><th>Customer</th><th>Contact</th><th>Phone</th><th></th></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: selected?.id === c.id ? 700 : 400 }}>{c.name}</td>
                <td className="muted small">{c.contact}</td>
                <td className="muted small">{c.phone}</td>
                <td>
                  <button className="btn-ghost" onClick={() => select(c)}>
                    {selected?.id === c.id ? '▸ price list below' : 'View price list'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Price list — {selected.name}</h2>
          <p className="muted small" style={{ marginTop: -4 }}>
            Agreed price per unit for this customer. Edit a price and it applies to their future orders.
          </p>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Unit</th>
                <th className="num">Today&rsquo;s base</th>
                <th className="num">Agreed price</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="muted">{p.unit}</td>
                  <td className="num muted">{money(p.price_today)}</td>
                  <td className="num">
                    <input
                      className="narrow"
                      type="number"
                      step="0.05"
                      min="0"
                      value={prices[p.id] ?? ''}
                      placeholder={String(p.price_today)}
                      onChange={(e) => updatePrice(p.id, e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
