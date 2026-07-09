// Demo seed data: 5 produce customers and 20 common fruit & veg products.
// Prices are "today's prices" in dollars per unit; stock is boxes/units on hand today.

export const SEED_PRODUCTS = [
  { id: 'p-tomatoes',     name: 'Tomatoes',            unit: 'box',    price_today: 28.0, stock_on_hand: 42, aliases: ['toms', 'tomato', 'tomatos', 'gourmet toms'] },
  { id: 'p-iceberg',      name: 'Iceberg Lettuce',     unit: 'each',   price_today: 3.2,  stock_on_hand: 60, aliases: ['iceberg', 'lettuce', 'icebergs'] },
  { id: 'p-bananas',      name: 'Bananas',             unit: 'case',   price_today: 32.0, stock_on_hand: 25, aliases: ['nanas', 'banana', 'cavendish'] },
  { id: 'p-potatoes',     name: 'Potatoes (Brushed)',  unit: 'bag',    price_today: 22.0, stock_on_hand: 38, aliases: ['spuds', 'potato', 'potatos', 'brushed'] },
  { id: 'p-carrots',      name: 'Carrots',             unit: 'bag',    price_today: 14.0, stock_on_hand: 30, aliases: ['carrot'] },
  { id: 'p-onions-brown', name: 'Brown Onions',        unit: 'bag',    price_today: 16.0, stock_on_hand: 27, aliases: ['brown onion', 'onions brown'] },
  { id: 'p-onions-red',   name: 'Red Onions',          unit: 'bag',    price_today: 19.0, stock_on_hand: 18, aliases: ['red onion', 'spanish onions', 'onions red'] },
  { id: 'p-cucumbers',    name: 'Cucumbers (Lebanese)',unit: 'box',    price_today: 24.0, stock_on_hand: 22, aliases: ['cukes', 'cucumber', 'lebs', 'lebanese cucumbers'] },
  { id: 'p-zucchini',     name: 'Zucchini',            unit: 'box',    price_today: 26.0, stock_on_hand: 15, aliases: ['zukes', 'zucchinis', 'courgette', 'courgettes'] },
  { id: 'p-broccoli',     name: 'Broccoli',            unit: 'box',    price_today: 30.0, stock_on_hand: 20, aliases: ['brocc', 'brocoli'] },
  { id: 'p-cauliflower',  name: 'Cauliflower',         unit: 'box',    price_today: 27.0, stock_on_hand: 12, aliases: ['caulis', 'cauli', 'caulies'] },
  { id: 'p-capsicum-red', name: 'Red Capsicum',        unit: 'box',    price_today: 34.0, stock_on_hand: 16, aliases: ['caps', 'capsicum', 'red caps', 'peppers', 'red peppers'] },
  { id: 'p-mushrooms',    name: 'Cup Mushrooms',       unit: 'box',    price_today: 38.0, stock_on_hand: 14, aliases: ['shrooms', 'mushies', 'mushroom', 'cups'] },
  { id: 'p-avocados',     name: 'Avocados (Hass)',     unit: 'tray',   price_today: 42.0, stock_on_hand: 24, aliases: ['avos', 'avocado', 'hass', 'avo'] },
  { id: 'p-strawberries', name: 'Strawberries',        unit: 'tray',   price_today: 25.0, stock_on_hand: 28, aliases: ['strawbs', 'strawberry', 'berries'] },
  { id: 'p-blueberries',  name: 'Blueberries',         unit: 'tray',   price_today: 36.0, stock_on_hand: 10, aliases: ['blueys', 'blueberry', 'blues'] },
  { id: 'p-oranges',      name: 'Navel Oranges',       unit: 'case',   price_today: 29.0, stock_on_hand: 33, aliases: ['oranges', 'navels', 'orange'] },
  { id: 'p-lemons',       name: 'Lemons',              unit: 'case',   price_today: 31.0, stock_on_hand: 19, aliases: ['lemon'] },
  { id: 'p-apples',       name: 'Pink Lady Apples',    unit: 'case',   price_today: 45.0, stock_on_hand: 26, aliases: ['apples', 'pink ladies', 'pink lady', 'apple'] },
  { id: 'p-spinach',      name: 'Baby Spinach',        unit: 'box',    price_today: 21.0, stock_on_hand: 17, aliases: ['spinach', 'baby spin', 'spin'] },
]

export const SEED_CUSTOMERS = [
  { id: 'c-harbourview', name: 'Harbourview Bistro',  contact: 'orders@harbourview.example', phone: '0412 555 101', price_factor: 1.0 },
  { id: 'c-greenfork',   name: 'Green Fork Cafe',     contact: 'kitchen@greenfork.example',  phone: '0412 555 102', price_factor: 1.05 },
  { id: 'c-tonys',       name: "Tony's Fruit Market", contact: 'tony@tonysfruit.example',    phone: '0412 555 103', price_factor: 0.92 },
  { id: 'c-sunrise',     name: 'Sunrise Grocers',     contact: 'buy@sunrisegrocers.example', phone: '0412 555 104', price_factor: 0.95 },
  { id: 'c-goldenwok',   name: 'The Golden Wok',      contact: 'chef@goldenwok.example',     phone: '0412 555 105', price_factor: 1.08 },
]

// Every customer gets their own agreed price for every product,
// derived from today's base price so the demo data hangs together.
export function buildSeedCustomerPrices() {
  const rows = []
  for (const c of SEED_CUSTOMERS) {
    for (const p of SEED_PRODUCTS) {
      rows.push({
        customer_id: c.id,
        product_id: p.id,
        price: Math.round(p.price_today * c.price_factor * 20) / 20, // to nearest 5c
      })
    }
  }
  return rows
}

export const SEED_DEMO_ORDER_TEXT =
  '2 boxes toms, 5 iceberg, case nanas\n1 bag spuds\n3 trays avos if they look good'
