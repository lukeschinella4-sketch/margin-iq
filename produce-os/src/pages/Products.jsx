import { useEffect, useState } from 'react'
import { db } from '../lib/db'

export default function Products() {
  const [products, setProducts] = useState([])

  useEffect(() => {
    db.listProducts().then(setProducts)
  }, [])

  async function update(id, field, value) {
    const n = parseFloat(value)
    if (Number.isNaN(n) || n < 0) return
    setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, [field]: n } : p)))
    await db.updateProduct(id, { [field]: n })
  }

  return (
    <div>
      <h1>Products &amp; Stock</h1>
      <p className="page-sub">
        Set today&rsquo;s base price and boxes on hand each morning. Confirming an order decrements stock;
        shortfalls are flagged before you commit.
      </p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Unit</th>
              <th className="num">Today&rsquo;s price ($)</th>
              <th className="num">Stock on hand</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.name}
                  {p.aliases?.length > 0 && (
                    <div className="muted small">aka {p.aliases.slice(0, 3).join(', ')}</div>
                  )}
                </td>
                <td className="muted">{p.unit}</td>
                <td className="num">
                  <input
                    className="narrow"
                    type="number"
                    step="0.5"
                    min="0"
                    value={p.price_today}
                    onChange={(e) => update(p.id, 'price_today', e.target.value)}
                  />
                </td>
                <td className="num">
                  <input
                    className="narrow"
                    type="number"
                    step="1"
                    min="0"
                    value={p.stock_on_hand}
                    onChange={(e) => update(p.id, 'stock_on_hand', e.target.value)}
                  />
                </td>
                <td>{p.stock_on_hand <= 5 && <span className="badge low">low stock</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
