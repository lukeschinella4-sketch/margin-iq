-- Produce OS — Supabase schema + demo seed.
-- Run this in the Supabase SQL editor, then set VITE_SUPABASE_URL and
-- VITE_SUPABASE_ANON_KEY in produce-os/.env.
--
-- Delete semantics: user-initiated order deletes are HARD deletes. The
-- ON DELETE CASCADE foreign keys below remove line items, invoices and
-- invoice items together with the order row. No soft-delete, no audit table.

create table customers (
  id      text primary key,
  name    text not null,
  contact text,
  phone   text
);

create table products (
  id            text primary key,
  name          text not null,
  unit          text not null,
  price_today   numeric not null default 0,
  stock_on_hand numeric not null default 0,
  aliases       jsonb not null default '[]'
);

create table customer_prices (
  customer_id text not null references customers (id) on delete cascade,
  product_id  text not null references products (id) on delete cascade,
  price       numeric not null,
  primary key (customer_id, product_id)
);

create table orders (
  id          uuid primary key default gen_random_uuid(),
  customer_id text not null references customers (id),
  raw_text    text not null,               -- saved BEFORE any parsing
  status      text not null default 'needs_review'
              check (status in ('needs_review', 'parsed', 'confirmed')),
  parse_note  text,
  created_at  timestamptz not null default now()
);

create table order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders (id) on delete cascade,
  product_id  text references products (id),
  description text,
  qty         numeric not null default 1,
  unit        text not null default 'each',
  unit_price  numeric,
  confidence  numeric
);

create table invoices (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders (id) on delete cascade,
  customer_id text not null references customers (id),
  status      text not null default 'draft' check (status in ('draft', 'approved')),
  created_at  timestamptz not null default now()
);

create table invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices (id) on delete cascade,
  product_id  text references products (id),
  description text,
  qty         numeric not null default 1,
  unit        text not null default 'each',
  unit_price  numeric
);

-- Demo app: open access via anon key. Lock this down before real use.
alter table customers enable row level security;
alter table products enable row level security;
alter table customer_prices enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;

create policy "open" on customers for all using (true) with check (true);
create policy "open" on products for all using (true) with check (true);
create policy "open" on customer_prices for all using (true) with check (true);
create policy "open" on orders for all using (true) with check (true);
create policy "open" on order_items for all using (true) with check (true);
create policy "open" on invoices for all using (true) with check (true);
create policy "open" on invoice_items for all using (true) with check (true);

-- ---------- seed: 5 customers ----------
insert into customers (id, name, contact, phone) values
  ('c-harbourview', 'Harbourview Bistro',  'orders@harbourview.example', '0412 555 101'),
  ('c-greenfork',   'Green Fork Cafe',     'kitchen@greenfork.example',  '0412 555 102'),
  ('c-tonys',       'Tony''s Fruit Market','tony@tonysfruit.example',    '0412 555 103'),
  ('c-sunrise',     'Sunrise Grocers',     'buy@sunrisegrocers.example', '0412 555 104'),
  ('c-goldenwok',   'The Golden Wok',      'chef@goldenwok.example',     '0412 555 105');

-- ---------- seed: 20 products ----------
insert into products (id, name, unit, price_today, stock_on_hand, aliases) values
  ('p-tomatoes',     'Tomatoes',             'box',  28.0, 42, '["toms","tomato","tomatos","gourmet toms"]'),
  ('p-iceberg',      'Iceberg Lettuce',      'each', 3.2,  60, '["iceberg","lettuce","icebergs"]'),
  ('p-bananas',      'Bananas',              'case', 32.0, 25, '["nanas","banana","cavendish"]'),
  ('p-potatoes',     'Potatoes (Brushed)',   'bag',  22.0, 38, '["spuds","potato","potatos","brushed"]'),
  ('p-carrots',      'Carrots',              'bag',  14.0, 30, '["carrot"]'),
  ('p-onions-brown', 'Brown Onions',         'bag',  16.0, 27, '["brown onion","onions brown"]'),
  ('p-onions-red',   'Red Onions',           'bag',  19.0, 18, '["red onion","spanish onions","onions red"]'),
  ('p-cucumbers',    'Cucumbers (Lebanese)', 'box',  24.0, 22, '["cukes","cucumber","lebs","lebanese cucumbers"]'),
  ('p-zucchini',     'Zucchini',             'box',  26.0, 15, '["zukes","zucchinis","courgette","courgettes"]'),
  ('p-broccoli',     'Broccoli',             'box',  30.0, 20, '["brocc","brocoli"]'),
  ('p-cauliflower',  'Cauliflower',          'box',  27.0, 12, '["caulis","cauli","caulies"]'),
  ('p-capsicum-red', 'Red Capsicum',         'box',  34.0, 16, '["caps","capsicum","red caps","peppers","red peppers"]'),
  ('p-mushrooms',    'Cup Mushrooms',        'box',  38.0, 14, '["shrooms","mushies","mushroom","cups"]'),
  ('p-avocados',     'Avocados (Hass)',      'tray', 42.0, 24, '["avos","avocado","hass","avo"]'),
  ('p-strawberries', 'Strawberries',         'tray', 25.0, 28, '["strawbs","strawberry","berries"]'),
  ('p-blueberries',  'Blueberries',          'tray', 36.0, 10, '["blueys","blueberry","blues"]'),
  ('p-oranges',      'Navel Oranges',        'case', 29.0, 33, '["oranges","navels","orange"]'),
  ('p-lemons',       'Lemons',               'case', 31.0, 19, '["lemon"]'),
  ('p-apples',       'Pink Lady Apples',     'case', 45.0, 26, '["apples","pink ladies","pink lady","apple"]'),
  ('p-spinach',      'Baby Spinach',         'box',  21.0, 17, '["spinach","baby spin","spin"]');

-- ---------- seed: per-customer agreed prices ----------
-- Derived from today's base price with each customer's negotiated factor,
-- rounded to the nearest 5 cents (mirrors src/lib/seed.js).
insert into customer_prices (customer_id, product_id, price)
select c.id, p.id, round((p.price_today * f.factor) * 20) / 20
from products p
cross join (values
  ('c-harbourview', 1.00::numeric),
  ('c-greenfork',   1.05),
  ('c-tonys',       0.92),
  ('c-sunrise',     0.95),
  ('c-goldenwok',   1.08)
) as f(cid, factor)
join customers c on c.id = f.cid;
