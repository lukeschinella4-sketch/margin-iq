import { NavLink, Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import NewOrder from './pages/NewOrder'
import Customers from './pages/Customers'
import Products from './pages/Products'
import OrderDetail from './pages/OrderDetail'
import { db } from './lib/db'
import { parserName } from './lib/parser'

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar no-print">
        <div className="brand">
          <span className="brand-mark">🥬</span>
          <div>
            <div className="brand-name">Produce OS</div>
            <div className="brand-sub">order management</div>
          </div>
        </div>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/new">＋ New Order</NavLink>
          <NavLink to="/customers">Customers</NavLink>
          <NavLink to="/products">Products &amp; Stock</NavLink>
        </nav>
        <div className="sidebar-foot">
          <div>db: {db.kind === 'supabase' ? 'Supabase' : 'local demo'}</div>
          <div>parser: {parserName()}</div>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<NewOrder />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/products" element={<Products />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Routes>
      </main>
    </div>
  )
}
