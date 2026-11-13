// ShopDesk demo: a pretend database that runs inside the page, so the real app can be tried with sample data.
// It stands in for src/lib/database.js. Each function copies what the real one in supabase/schema.sql does,
// closely enough for a demo. Nothing is sent anywhere; changes stay in this browser.
import { demo } from './runtime.js';
import { PHOTOS } from './photos.js';

export const configured = true;
export const privacyEmail = '';

const KEY = 'shopdesk-demo-v9';
const DAY = 864e5;
const HOUR = 36e5;
const MIN = 6e4;
export const VENDOR = { id: 'a0000000-0000-4000-8000-000000000001', email: 'bimpe@example.com' };
export const CUSTOMER = { id: 'a0000000-0000-4000-8000-000000000002', email: 'funmi@example.com' };
const RESERVED = [
  'admin',
  'privacy',
  'orders',
  'order',
  'login',
  'signin',
  'shopdesk',
  'help',
  'support',
  'api',
  'app',
];

// ---------- small tools ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let R = rng(7);
const pick = (list) => list[Math.floor(R() * list.length)];
const between = (a, b) => a + R() * (b - a);
function weighted(items, weightOf) {
  const total = items.reduce((s, x) => s + weightOf(x), 0);
  let r = R() * total;
  for (const x of items) {
    r -= weightOf(x);
    if (r <= 0) return x;
  }
  return items[items.length - 1];
}
function uuid() {
  const h = () =>
    Math.floor(R() * 65536)
      .toString(16)
      .padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-${'89ab'[Math.floor(R() * 4)]}${h().slice(1)}-${h()}${h()}${h()}`;
}
const iso = (t) => new Date(t).toISOString();
const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const fail = (message) => {
  throw new Error(message);
};

// ---------- the sample shop: Bimpe's Beauty Store, about 13 months of orders ----------
const FIRST = [
  'Chioma',
  'Tunde',
  'Halima',
  'Kemi',
  'Ada',
  'Segun',
  'Ifeoma',
  'Bola',
  'Emeka',
  'Ngozi',
  'Yemi',
  'Zainab',
  'Tolu',
  'Uche',
  'Funke',
  'Ibrahim',
  'Amaka',
  'Dapo',
  'Nneka',
  'Femi',
  'Aisha',
  'Kunle',
  'Blessing',
  'Chidi',
  'Sade',
  'Ronke',
  'Obinna',
  'Hauwa',
  'Lola',
  'Gbenga',
  'Kelechi',
  'Temi',
  'Bisi',
  'Ebuka',
  'Folake',
  'Sani',
  'Adaeze',
  'Wale',
  'Ijeoma',
  'Moyo',
];
const LAST = 'ABDEFIKMNOSU';
const STREETS = [
  'Allen Avenue, Ikeja',
  'Bode Thomas Street, Surulere',
  'Admiralty Way, Lekki Phase 1',
  'Abraham Adesanya, Ajah',
  'Herbert Macaulay Way, Yaba',
  'Isaac John Street, Ikeja GRA',
  'Adeola Odeku Street, Victoria Island',
  '2nd Avenue, Festac Town',
  'Okota Road, Isolo',
  'Mende Street, Maryland',
  'Coker Road, Ilupeju',
  'Ogunusi Road, Ojodu Berger',
  'Diya Street, Gbagada Phase 2',
  'CMD Road, Magodo',
  'Aguda Road, Ogba',
];
// the area part of each street above, as a customer picks it at checkout
const AREA_OF = {
  'Allen Avenue, Ikeja': 'Ikeja',
  'Bode Thomas Street, Surulere': 'Surulere',
  'Admiralty Way, Lekki Phase 1': 'Lekki Phase 1',
  'Abraham Adesanya, Ajah': 'Ajah',
  'Herbert Macaulay Way, Yaba': 'Yaba',
  'Isaac John Street, Ikeja GRA': 'Ikeja GRA',
  'Adeola Odeku Street, Victoria Island': 'Victoria Island',
  '2nd Avenue, Festac Town': 'Festac',
  'Okota Road, Isolo': 'Isolo',
  'Mende Street, Maryland': 'Maryland',
  'Coker Road, Ilupeju': 'Ilupeju',
  'Ogunusi Road, Ojodu Berger': 'Ojodu',
  'Diya Street, Gbagada Phase 2': 'Gbagada',
  'CMD Road, Magodo': 'Magodo',
  'Aguda Road, Ogba': 'Ogba',
};
const RIDERS = [
  ['Musa Bello', '0800 000 0901'],
  ['Sunday Okon', '0800 000 0902'],
  ['Kola Ade', '0800 000 0903'],
];
const HOURS = [
  [7, 1],
  [8, 2],
  [9, 3],
  [10, 4],
  [11, 5],
  [12, 7],
  [13, 7],
  [14, 5],
  [15, 4],
  [16, 4],
  [17, 5],
  [18, 6],
  [19, 8],
  [20, 8],
  [21, 6],
  [22, 3],
];

function seed() {
  R = rng(20261106);
  const now = Date.now();
  const t0 = startOfDay(now);
  const opened = t0 - 400 * DAY;
  const shop = {
    id: 'b0000000-0000-4000-8000-0000000000aa',
    owner_id: VENDOR.id,
    name: "Bimpe's Beauty Store",
    slug: 'bimpes-beauty',
    order_prefix: 'BB',
    bank: 'OPay',
    account_number: '0123456789',
    account_name: 'BIMPE ADEYEMI',
    whatsapp: '0800 000 0000',
    allow_part_payment: true,
    delivery_paid_by: 'customer',
    sells: 'Shea butter, black soap, oils and skin care',
    location: 'Yaba, Lagos',
    pickup_address: '14 Herbert Macaulay Way, Yaba, Lagos',
    social: '@bimpesbeauty',
    status: 'active',
    reviewed_at: iso(opened + DAY),
    review_note: '',
    details_changed_at: null,
    accepted_rules_at: iso(opened),
    created_at: iso(opened),
    last_active_at: iso(now),
    paid_until: null,
    monthly_goal: 1500000,
  };
  const P = (key, name, price, stock, low, daysAgo, pop) => ({
    id: uuid(),
    shop_id: shop.id,
    name,
    price,
    sale_price: null,
    stock,
    low_at: low,
    photo_path: 'demo/' + key,
    option_label: '',
    active: true,
    hidden_by_admin: false,
    hidden_reason: '',
    created_at: iso(t0 - daysAgo * DAY + 10 * HOUR),
    pop,
  });
  const products = [
    P('shea', 'Shea butter, 250g', 3500, 24, 8, 400, 9),
    P('soap', 'Black soap, 500g', 2800, 6, 8, 400, 8),
    P('oil', 'Hair growth oil, 100ml', 6000, 15, 5, 399, 6),
    P('cream', 'Body cream, 400ml', 7500, 11, 5, 398, 5),
    P('balm', 'Lip balm set', 2000, 30, 10, 390, 7),
    P('serum', 'Glow serum, 30ml', 9500, 3, 4, 210, 4),
    P('coconut', 'Coconut oil, 500ml', 4500, 18, 6, 120, 4),
    P('butter', 'Whipped body butter', 6500, 9, 4, 40, 6),
  ];

  // Customers: everyone orders with an account. The first dozen come back often.
  const customers = [];
  const users = [VENDOR, CUSTOMER];
  for (let i = 0; i < 70; i++) {
    const id = uuid();
    const email = `customer${i + 1}@example.com`;
    users.push({ id, email });
    customers.push({
      id,
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}.`,
      phone: `0800 000 0${String(100 + i).padStart(3, '0')}`,
      address: `${3 + ((i * 13) % 40)}, ${STREETS[i % STREETS.length]}`,
      area: AREA_OF[STREETS[i % STREETS.length]],
      joined: Math.floor(i * 5.4), // days after the shop opened
      weight: i < 12 ? 6 : 1,
    });
  }
  const funmi = {
    id: CUSTOMER.id,
    name: 'Funmi Adebayo',
    phone: '0800 000 0123',
    address: 'Flat 4, 12 Adeola Odeku Street, Victoria Island',
    area: 'Victoria Island',
    joined: 300,
    weight: 0,
  };

  const orders = [];
  const items = [];
  const payments = [];
  const method = () => {
    const r = R();
    return r < 0.55 ? 'tap' : r < 0.85 ? 'alert' : 'notification';
  };
  function basket(at) {
    const open = products.filter((p) => Date.parse(p.created_at) <= at);
    const n = R() < 0.62 ? 1 : R() < 0.75 ? 2 : 3;
    const chosen = [];
    while (chosen.length < n && chosen.length < open.length) {
      const p = weighted(open, (x) => (chosen.includes(x) ? 0 : x.pop));
      chosen.push(p);
    }
    return chosen.map((p) => ({ p, qty: R() < 0.72 ? 1 : R() < 0.75 ? 2 : 3 }));
  }
  // Sales in the past: the glow serum has been ₦8,500 (from ₦9,500) for the last 45 days, shea butter was
  // ₦3,000 last December. Where customers came from: a separate random stream, so the rest of the sample stays the same.
  const R2 = rng(4242);
  const saleAt = (p, at) => {
    const m = new Date(at).getMonth();
    if (p.name.startsWith('Glow serum') && at > t0 - 45 * DAY) return 8500;
    if (p.name.startsWith('Shea butter') && m === 11 && at < t0 - 30 * DAY) return 3000;
    return null;
  };
  const sourceAt = (at) => {
    const recent = 1 - (t0 - at) / (400 * DAY); // 0 a year ago, 1 today: TikTok and Instagram grow
    const r = R2();
    const tt = 0.04 + 0.12 * recent,
      ig = 0.22 + 0.08 * recent;
    if (r < 0.4) return 'whatsapp';
    if (r < 0.4 + ig) return 'instagram';
    if (r < 0.4 + ig + tt) return 'tiktok';
    if (r < 0.4 + ig + tt + 0.05) return 'facebook';
    return 'direct';
  };
  function addOrder(c, at, lines, mode, fee) {
    lines.forEach((l) => {
      const sale = saleAt(l.p, at);
      l.price = sale || l.p.price;
      l.was = sale ? l.p.price : null;
    });
    const o = {
      id: 0,
      shop_id: shop.id,
      public_token: uuid(),
      customer_id: c.id,
      customer_name: c.name,
      customer_phone: c.phone,
      mode,
      address: mode === 'delivery' ? c.address : '',
      area: mode === 'delivery' ? c.area || null : null,
      source: sourceAt(at),
      items_total: lines.reduce((s, l) => s + l.price * l.qty, 0),
      delivery_fee: mode === 'delivery' ? fee : null,
      delivery_paid_by: 'customer',
      amount_paid: 0,
      status: 'awaiting',
      customer_says_paid: false,
      customer_says_paid_at: null,
      created_at: iso(at),
      confirmed_at: null,
      paid_at: null,
      out_at: null,
      done_at: null,
      deliver_by: null,
      received_at: null,
      received_by: null,
      rider_name: '',
      rider_phone: '',
      customer_details_purged: false,
      _lines: lines,
    };
    orders.push(o);
    return o;
  }
  const due = (o) => o.items_total + (o.mode === 'delivery' ? o.delivery_fee || 0 : 0);
  function pay(o, amount, at) {
    payments.push({ id: 0, order_id: o, shop_id: shop.id, amount, method: method(), created_at: iso(at) });
    o.amount_paid += amount;
  }
  // Moves an order along: paid, out with a rider (or ready to collect), delivered.
  // Every step happens before "now", squeezed together if the order was placed only a few hours ago.
  function finish(o, at, upTo) {
    const confirm = between(3, 30) * MIN;
    const paid = confirm + between(5, 210) * MIN;
    const out = paid + between(1, 6) * HOUR;
    const promised = out + between(2, 6) * HOUR;
    const done = promised + between(-90, 60) * MIN;
    const last = upTo === 'paid' ? paid : upTo === 'out' ? out : Math.max(done, promised);
    const room = now - 2 * MIN - at;
    const k = last > room ? Math.max(0.02, room / last) : 1;
    const t = (off) => at + off * k;
    o.confirmed_at = iso(t(confirm));
    if (R() < 0.1) {
      const first = Math.round((due(o) * 0.5) / 100) * 100;
      pay(o, first, t(confirm + (paid - confirm) * 0.4));
      pay(o, due(o) - first, t(paid));
    } else pay(o, due(o), t(paid));
    o.paid_at = iso(t(paid));
    o.status = 'paid';
    if (upTo === 'paid') return;
    o.out_at = iso(t(out));
    o.deliver_by = iso(t(promised));
    if (o.mode === 'delivery') [o.rider_name, o.rider_phone] = pick(RIDERS);
    o.status = 'out';
    if (upTo === 'out') return;
    o.status = 'delivered';
    o.done_at = iso(t(done));
    if (R() < 0.7) {
      o.received_by = 'customer';
      o.received_at = o.done_at;
    } else o.received_by = 'shop';
  }
  const fee = () => pick([1500, 2000, 2000, 2500, 2500, 3000, 3500]);
  const hourOf = () => weighted(HOURS, (h) => h[1])[0];

  // Every day from opening until yesterday
  for (let d = 400; d >= 1; d--) {
    const day = t0 - d * DAY;
    const wd = new Date(day).getDay();
    const grow = 1.1 + 4.4 * (1 - d / 400);
    const week = wd === 5 ? 1.25 : wd === 6 ? 1.35 : wd === 0 ? 0.8 : 1;
    const december = new Date(day).getMonth() === 11 ? 1.4 : 1;
    const n = Math.max(0, Math.round(grow * week * december + between(-1.2, 1.2)));
    for (let k = 0; k < n; k++) {
      const at = day + hourOf() * HOUR + between(0, 59) * MIN;
      const pool = customers.filter((c) => c.joined <= 400 - d);
      const c = weighted(pool.length ? pool : customers.slice(0, 1), (x) => x.weight);
      const mode = R() < 0.72 ? 'delivery' : 'pickup';
      const o = addOrder(c, at, basket(at), mode, fee());
      if (R() < 0.06) {
        o.status = 'cancelled';
        o.done_at = iso(Math.min(now - MIN, at + between(20, 40) * HOUR));
      } else finish(o, at, d <= 1 && R() < 0.2 ? 'out' : 'delivered');
    }
  }
  // Funmi's earlier orders (the sample customer account)
  for (const d of [96, 41, 12]) {
    const at = t0 - d * DAY + 19 * HOUR;
    finish(addOrder(funmi, at, basket(at), 'delivery', 2500), at, 'delivered');
  }
  // and one delivered yesterday evening, so she can still report a problem with it (3 days)
  const lastNight = t0 - DAY + 17 * HOUR;
  finish(
    addOrder(
      funmi,
      lastNight,
      [
        { p: products[0], qty: 1 },
        { p: products[4], qty: 1 },
      ],
      'delivery',
      2000,
    ),
    lastNight,
    'delivered',
  );
  // Today: a realistic mix, placed in the hours before now
  const ago = (h) => Math.max(t0 + 5 * MIN, now - h * HOUR);
  const regular = (i) => customers[i];
  const L = (...pairs) => pairs.map(([i, qty]) => ({ p: products[i], qty }));
  // a customer reported a problem this morning with an order delivered yesterday (the shop has 48 hours to answer)
  const complained = addOrder(regular(2), t0 - DAY + 11 * HOUR, L([4, 1], [0, 1]), 'delivery', 2000);
  finish(complained, t0 - DAY + 11 * HOUR, 'delivered');
  finish(addOrder(regular(0), ago(9), L([0, 2], [1, 1]), 'delivery', 1500), ago(9), 'delivered');
  finish(addOrder(regular(3), ago(7.5), L([4, 2]), 'pickup', null), ago(7.5), 'delivered');
  finish(addOrder(regular(5), ago(5), L([2, 2]), 'delivery', 2000), ago(5), 'paid');
  const out = addOrder(funmi, ago(4), L([5, 1], [7, 1]), 'delivery', 2500);
  finish(out, ago(4), 'out');
  out.deliver_by = iso(Math.max(now + 90 * MIN, Date.parse(out.out_at) + HOUR));
  const part = addOrder(regular(8), ago(3), L([3, 2]), 'delivery', 3000);
  part.confirmed_at = iso(ago(2.9));
  pay(part, 9000, ago(2.7));
  part.status = 'part';
  const says = addOrder(regular(1), ago(2), L([0, 1], [6, 1]), 'delivery', 2000);
  says.confirmed_at = iso(ago(1.9));
  says.customer_says_paid = true;
  says.customer_says_paid_at = iso(ago(1.5));
  addOrder(regular(14), ago(0.6), L([5, 1], [4, 1]), 'delivery', null);
  addOrder(regular(20), ago(0.2), L([1, 2]), 'pickup', null);

  // Number the orders in time order, and write out their lines
  orders.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  orders.forEach((o, i) => {
    o.id = 1001 + i;
    o.packing_photo = null;
    const sent = ['out', 'delivered'].includes(o.status); // orders that went out were packed
    o._lines.forEach((l) =>
      items.push({
        id: items.length + 1,
        order_id: o.id,
        product_id: l.p.id,
        name: l.p.name,
        price: l.price,
        was_price: l.was,
        qty: l.qty,
        packed: sent,
      }),
    );
    delete o._lines;
  });
  const photos = {};
  const problems = [];
  {
    const photo = `${complained.id}/c-0d3c5b8e-3c1f-4f6a-9d1e-2b7a1c9e4f00.jpg`;
    photos[photo] = PHOTOS.balm;
    problems.push({
      id: 1,
      order_id: complained.id,
      shop_id: shop.id,
      customer_id: complained.customer_id,
      kind: 'missing_item',
      details: 'The lip balm set came with two balms, not three. The box was sealed.',
      photos: [photo],
      status: 'open',
      reply: null,
      reply_note: '',
      reply_photos: [],
      refund_amount: null,
      refund_received_at: null,
      answered_at: null,
      escalated_at: null,
      escalated_by: null,
      decision: null,
      decision_note: '',
      decided_at: null,
      closed_at: null,
      created_at: iso(
        Math.max(t0 + 8 * HOUR, now - 3 * HOUR) > now
          ? now - 20 * MIN
          : Math.max(t0 + 8 * HOUR, now - 3 * HOUR),
      ),
    });
  }
  payments.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  payments.forEach((p, i) => {
    p.id = i + 1;
    p.order_id = p.order_id.id;
  });
  products.forEach((p) => delete p.pop);
  // Sizes and a sale: the hair oil comes in three sizes (the 200ml on sale), the glow serum is on sale.
  const product_options = [];
  const oil = products[2];
  [
    ['50ml', 3500, null, 7],
    ['100ml', 6000, null, oil.stock],
    ['200ml', 10500, 9500, 4],
  ].forEach(([name, price, sale, stock], i) =>
    product_options.push({
      id: uuid(),
      product_id: oil.id,
      shop_id: shop.id,
      name,
      price,
      sale_price: sale,
      stock,
      sort_order: i + 1,
      created_at: oil.created_at,
    }),
  );
  // orders from before the sizes were added were all the 100ml: name them the way new orders are named
  items.forEach((i) => {
    if (i.product_id === oil.id) {
      i.name = 'Hair growth oil · 100ml';
      i.option_id = product_options[1].id;
      i.option_name = '100ml';
    }
  });
  Object.assign(oil, {
    name: 'Hair growth oil',
    option_label: 'Size',
    price: 3500,
    stock: 7 + oil.stock + 4,
  });
  products[5].sale_price = 8500;
  // Money out: what Bimpe spends to run the shop (restocking, packaging, transport, data and her ShopDesk plan)
  const money_out = [];
  {
    const R3 = rng(777);
    const out = (at, amount, kind, note) =>
      money_out.push({
        id: 0,
        shop_id: shop.id,
        amount: Math.round(amount / 100) * 100,
        kind,
        note,
        spent_on: iso(at).slice(0, 10),
        created_at: iso(at),
      });
    for (let d = 398; d >= 0; d--) {
      const day = t0 - d * DAY + 11 * HOUR;
      const date = new Date(day);
      const grow = 1 + 3.2 * (1 - d / 400);
      if (date.getDate() === 3 || date.getDate() === 17)
        out(day, 38000 * grow + R3() * 25000, 'restock', 'Restock from the market');
      if (date.getDate() === 5) out(day, 6000 + R3() * 5000, 'packaging', 'Packaging nylons and boxes');
      if (date.getDate() === 1) out(day, 5000, 'data', 'Data and airtime');
      if (date.getDate() === 1 && d < 300) out(day, 3000, 'shopdesk', 'ShopDesk plan');
      if (date.getDay() === 2) out(day, 2500 + R3() * 3000, 'transport', 'Transport to the market');
    }
    money_out.forEach((m, i) => (m.id = i + 1));
  }
  const custRows = [funmi, ...customers]
    .filter((c) => orders.some((o) => o.customer_id === c.id))
    .map((c) => ({
      user_id: c.id,
      name: c.name,
      phone: c.phone,
      address: c.address,
      area: c.area || '',
      updated_at: iso(now),
    }));
  R = rng(now % 100000);
  // Chats: Funmi and the shop about her order on its way; a customer who says she has paid, waiting for the shop's reply
  const messages = [];
  const notifications = [];
  const msg = (o, sender, body, at) => {
    messages.push({
      id: messages.length + 1,
      order_id: o.id,
      shop_id: shop.id,
      customer_id: o.customer_id,
      sender,
      body,
      photo: null,
      created_at: iso(at),
    });
    if (sender === 'customer')
      notifications.push({
        id: notifications.length + 1,
        user_id: VENDOR.id,
        order_id: o.id,
        kind: 'message',
        title: `${o.customer_name} · BB-${o.id}`,
        body,
        url: `/?chat=${o.id}#orders`,
        created_at: iso(at),
        read_at: iso(at + MIN),
        pushed_at: iso(at),
      });
  };
  msg(out, 'shop', 'Hi Funmi, Musa is on his way with your order.', Date.parse(out.out_at) + 2 * MIN);
  msg(out, 'customer', "Thank you! I'm home all evening.", Date.parse(out.out_at) + 6 * MIN);
  msg(says, 'customer', "I've sent the money. Please check and send it today 🙏", ago(1.4));
  notifications[notifications.length - 1].read_at = null;
  return {
    v: 12,
    day: t0,
    uid: VENDOR.id,
    path: '/',
    users,
    shops: [shop],
    products,
    product_options,
    orders,
    order_items: items,
    payments,
    money_out,
    customers: custRows,
    reports: [],
    problems,
    photos,
    messages,
    notifications,
  };
}

// The month-end alert, for showing it in the demo (the real one is sent by the database on the last day of the month).
export function monthEndAlert() {
  const s = S.shops.find((x) => x.owner_id === VENDOR.id);
  const n = new Date();
  const first = new Date(n.getFullYear(), n.getMonth(), 1);
  const share = (p) => {
    const o = S.orders.find((x) => x.id === p.order_id);
    const fee = o && o.delivery_paid_by === 'customer' ? o.delivery_fee || 0 : 0;
    return fee ? Math.round((p.amount * o.items_total) / (o.items_total + fee)) : p.amount;
  };
  const inn = S.payments
    .filter((p) => p.shop_id === s.id && Date.parse(p.created_at) >= +first)
    .reduce((a, p) => a + share(p), 0);
  const orders = S.orders.filter(
    (o) => o.shop_id === s.id && o.status !== 'cancelled' && Date.parse(o.created_at) >= +first,
  ).length;
  const mine = S.money_out.filter((m) => m.shop_id === s.id && m.spent_on >= iso(+first).slice(0, 10));
  // "left" only for shops that note their own spending
  const out = mine.some((m) => m.kind !== 'shopdesk') ? mine.reduce((a, m) => a + m.amount, 0) : 0;
  const ym = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  const month = n.toLocaleDateString('en-NG', { month: 'long' });
  const was = S.uid;
  S.uid = null; // sent by ShopDesk, not by the shop itself
  notify(
    s.owner_id,
    null,
    'monthly_report',
    `Your ${month} report is ready`,
    `${naira(inn)} in from ${orders} orders${out ? ` · ${naira(inn - out)} left after money out` : ''}. Tap to see it.`,
    `/?report=${ym}#sales`,
  );
  S.uid = was;
}

// ---------- keeping the demo in this browser ----------
let S = null;
try {
  S = JSON.parse(localStorage.getItem(KEY) || 'null');
} catch (e) {
  S = null;
}
// A fresh sample each day, so "today" always has orders in it.
if (!S || S.v !== 12 || S.day !== startOfDay(Date.now())) S = seed();
demo.go(S.path || '/');
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
    } catch (e) {
      /* storage full or blocked: the demo still works until the page is closed */
    }
  }, 250);
}
demo.subscribe(() => {
  if (S.path !== demo.path) {
    S.path = demo.path;
    save();
  }
});

// ---------- who is signed in ----------
const authListeners = new Set();
const me = () => S.users.find((u) => u.id === S.uid) || null;
const uid = () => (me() ? me().id : null);
const session = () => {
  const u = me();
  return u ? { access_token: 'demo', token_type: 'bearer', user: { id: u.id, email: u.email } } : null;
};
function authChanged(event) {
  const s = session();
  authListeners.forEach((cb) => setTimeout(() => cb(event, s), 0));
  demo.changed();
}
export function signInAs(user) {
  S.uid = user ? user.id : null;
  save();
  authChanged(user ? 'SIGNED_IN' : 'SIGNED_OUT');
}
export function whoIsIn() {
  return S.uid === VENDOR.id ? 'vendor' : S.uid === CUSTOMER.id ? 'customer' : S.uid ? 'other' : 'none';
}
export function resetDemo() {
  S = seed();
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    /* ignore */
  }
  save();
}

// ---------- rules the real database keeps ----------
const myShop = () => S.shops.find((s) => s.owner_id === uid()) || null;
const hasShop = (u) => S.shops.some((s) => s.owner_id === u);
const hasShopped = (u) =>
  S.orders.some((o) => o.customer_id === u) || S.customers.some((c) => c.user_id === u);
const shopOpen = (s) => s && s.status === 'active';
const SHOP_EMAIL = 'This email runs a shop. Use another email to order.';
function ownedOrder(id) {
  const s = myShop();
  const o = s && S.orders.find((x) => x.id === Number(id) && x.shop_id === s.id);
  return o || fail('Order not found.');
}
function customerOrder(token) {
  const o = S.orders.find((x) => x.public_token === token) || fail('Order not found.');
  if (uid() && hasShop(uid())) fail(SHOP_EMAIL);
  if (o.customer_id && o.customer_id !== uid()) fail('Sign in with the email you ordered with.');
  return o;
}
const toPay = (o) => o.items_total + (o.delivery_paid_by === 'customer' ? o.delivery_fee || 0 : 0);
const codeOf = (o) => `${(S.shops.find((s) => s.id === o.shop_id) || {}).order_prefix || 'SD'}-${o.id}`;
const unpacked = (o) => S.order_items.some((i) => i.order_id === o.id && !i.packed);
const problemOf = (o) => S.problems.find((p) => p.order_id === o.id) || null;
const problemStatus = (p) =>
  p.status === 'open' && Date.parse(p.created_at) < Date.now() - 48 * HOUR ? 'with_shopdesk' : p.status;
const canReport = (o) =>
  ((o.status === 'delivered' && Date.parse(o.done_at) > Date.now() - 3 * DAY) ||
    (o.status === 'out' && Date.parse(o.deliver_by) < Date.now())) &&
  !problemOf(o);
const KINDS = ['not_arrived', 'wrong_item', 'damaged', 'missing_item', 'other'];
const CANCEL_TEXT = {
  unpaid: 'not paid in 48 hours',
  customer: 'you cancelled it',
  out_of_stock: 'out of stock',
  cant_deliver: "can't deliver there",
  customer_asked: 'you asked to cancel',
  other: 'cancelled by the shop',
};
const KIND_TEXT = {
  not_arrived: "Didn't arrive",
  wrong_item: 'Wrong item',
  damaged: 'Damaged',
  missing_item: 'Something missing',
  other: 'Something else',
};
const nowIso = () => new Date().toISOString();

// ---------- ratings and Shops near you (update 014) ----------
// A few sample ratings for the demo shop, and a few sample shops elsewhere (their pages aren't in the demo).
const RATING_SEED = [
  ['Amaka O.', 5, 'The body butter is so rich, a little goes a long way. Came the same evening.', 2, 'Whipped body butter'],
  ['Tobi K.', 5, 'Second time ordering. Packaging was neat and she replied fast.', 6, 'Coconut oil, 500ml'],
  ['Ngozi E.', 4, 'Lovely lip balms. The rider came a bit late but they kept me posted.', 13, 'Lip balm set'],
  ['Seyi B.', 5, '', 20, 'Glow serum, 30ml'],
  ['Kunle A.', 4, 'Good products, and the delivery fee was fair.', 27, 'Black soap, 500g'],
];
const OTHER_SHOPS = [
  { name: 'Kemi Wigs', slug: 'kemi-wigs', sells: 'Wigs, frontals and closures', location: 'Yaba, Lagos', rating: null, ratings: 0 },
  { name: "Tola's Kitchen", slug: 'tolas-kitchen', sells: 'Food and drinks', location: 'Surulere, Lagos', rating: 4.9, ratings: 41 },
  { name: 'Ada Fabrics', slug: 'ada-fabrics-lekki', sells: 'Ankara and lace', location: 'Lekki Phase 1, Lagos', rating: 4.6, ratings: 12 },
  { name: 'Gadget Hub Ikeja', slug: 'gadget-hub-ikeja', sells: 'Phones and accessories', location: 'Ikeja, Lagos', rating: 4.7, ratings: 18 },
];
function ratingsOf(shopId) {
  if (!S.ratings) {
    const s0 = S.shops[0];
    S.ratings = RATING_SEED.map(([who, stars, comment, days, bought], i) => ({
      shop_id: s0.id,
      customer_id: 'sample-' + i,
      who,
      stars,
      comment,
      bought,
      at: new Date(Date.now() - days * 86400000).toISOString(),
    }));
  }
  return S.ratings.filter((r) => r.shop_id === shopId);
}
function ratingOf(shopId) {
  const l = ratingsOf(shopId);
  return {
    rating: l.length ? Math.round((l.reduce((a, r) => a + r.stars, 0) / l.length) * 10) / 10 : null,
    ratings: l.length,
  };
}
const shortName = (n) => {
  const w = String(n || '').trim().split(/\s+/).filter(Boolean);
  return w.length ? w[0] + (w[1] ? ' ' + w[1][0].toUpperCase() + '.' : '') : 'A customer';
};
// A product with sizes takes its price (the lowest) and stock (all added up) from them.
const optionsOf = (p) =>
  S.product_options.filter((o) => o.product_id === p.id).sort((a, b) => a.sort_order - b.sort_order);
function syncProduct(p) {
  const list = optionsOf(p);
  if (!list.length) return;
  p.price = Math.min(...list.map((o) => o.price));
  p.stock = list.reduce((a, o) => a + o.stock, 0);
  p.sale_price = null;
}
// A cancelled order's line goes back on sale: to its size, or to the product.
function restockItem(i) {
  if (i.option_id) {
    const o = S.product_options.find((x) => x.id === i.option_id);
    if (!o) return;
    o.stock += i.qty;
    syncProduct(S.products.find((p) => p.id === o.product_id));
  } else if (!i.option_name) {
    const p = S.products.find((x) => x.id === i.product_id);
    if (p && !optionsOf(p).length) p.stock += i.qty;
  }
}
const jsonInt = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const naira = (n) => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
function lagosTime(t) {
  const d = new Date(t);
  const h = d.getHours(),
    m = d.getMinutes();
  return `${d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })}, ${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
}
const canChat = (o) =>
  !!o.customer_id &&
  (['awaiting', 'part', 'paid', 'out'].includes(o.status) ||
    Date.parse(o.done_at || o.created_at) > Date.now() - 7 * DAY ||
    !!(
      problemOf(o) &&
      (!problemOf(o).closed_at || (problemOf(o).owed_amount && !problemOf(o).owed_paid_at))
    ));

// ---------- live updates (stands in for Supabase Realtime): channels hear new alerts and messages ----------
const channels = new Set();
function live(table, row) {
  channels.forEach((ch) =>
    ch.binds.forEach((b) => {
      if (b.table !== table) return;
      const [col, val] = String(b.filter || '').split('=');
      if (col && String(row[col]) !== String(val).replace(/^eq\./, '')) return;
      setTimeout(() => b.cb({ new: clone(row) }), 120);
    }),
  );
}
// Alerts, as in the real database: nobody hears about their own action.
function notify(user, orderId, kind, title, body, url) {
  if (!user || user === uid()) return;
  const n = {
    id: Math.max(0, ...S.notifications.map((x) => x.id)) + 1,
    user_id: user,
    order_id: orderId,
    kind,
    title,
    body: String(body).slice(0, 300),
    url,
    created_at: nowIso(),
    read_at: null,
    pushed_at: nowIso(),
  };
  S.notifications.push(n);
  live('notifications', n);
}
const shopOf = (o) => S.shops.find((x) => x.id === o.shop_id);
// What the other side hears when an order moves (orders_notify in the real database).
function orderMoved(o, b) {
  const s = shopOf(o),
    c = codeOf(o),
    cu = '/o/' + o.public_token,
    su = `/?order=${o.id}#orders`;
  const due = toPay(o) - o.amount_paid;
  if (o.status === 'cancelled' && b.status !== 'cancelled')
    notify(o.customer_id, o.id, 'cancelled', s.name, `${c} was cancelled.`, cu);
  else if (o.status === 'paid' && ['awaiting', 'part'].includes(b.status))
    notify(o.customer_id, o.id, 'paid', s.name, `${c}: payment received. Packing now.`, cu);
  else if (o.status === 'part' && o.amount_paid > b.amount_paid)
    notify(
      o.customer_id,
      o.id,
      'part_paid',
      s.name,
      `${c}: ${naira(o.amount_paid - b.amount_paid)} received. ${naira(due)} left.`,
      cu,
    );
  else if (['awaiting', 'part'].includes(o.status) && !b.confirmed_at && o.confirmed_at)
    notify(o.customer_id, o.id, 'confirmed', s.name, `${c} confirmed. Pay ${naira(due)}.`, cu);
  else if (['awaiting', 'part'].includes(o.status) && o.delivery_fee !== b.delivery_fee)
    notify(
      o.customer_id,
      o.id,
      'fee',
      s.name,
      `${c}: delivery is now ${naira(o.delivery_fee)}. Pay ${naira(due)}.`,
      cu,
    );
  else if (o.status === 'out' && b.status !== 'out')
    notify(
      o.customer_id,
      o.id,
      o.mode === 'pickup' ? 'ready' : 'out',
      s.name,
      o.mode === 'pickup'
        ? `${c} is ready. Collect from ${lagosTime(o.deliver_by)}.`
        : `${c} is on its way with ${o.rider_name}, ${o.rider_phone}. By ${lagosTime(o.deliver_by)}.`,
      cu,
    );
  else if (o.status === 'out' && o.deliver_by !== b.deliver_by)
    notify(o.customer_id, o.id, 'moved', s.name, `${c}: new time ${lagosTime(o.deliver_by)}.`, cu);
  else if (o.status === 'delivered' && b.status !== 'delivered' && o.received_by === 'shop')
    notify(o.customer_id, o.id, 'delivered', s.name, `${c} delivered. Got everything?`, cu);
  else if (o.received_by === 'customer' && b.received_by !== 'customer')
    notify(
      s.owner_id,
      o.id,
      'received',
      `${o.customer_name} got ${c}`,
      `Confirmed ${lagosTime(Date.now())}.`,
      su,
    );
  else if (o.customer_says_paid && !b.customer_says_paid)
    notify(
      s.owner_id,
      o.id,
      'says_paid',
      `${o.customer_name} says they paid`,
      `${c} · ${naira(due)}. Check your bank app.`,
      su,
    );
}

// ---------- ShopDesk Delivery in the demo ----------
const COURIERS = [
  { id: 'kwik', name: 'Kwik', extra: 0, eta: 'Same day, by bike', fast: true },
  { id: 'dellyman', name: 'Dellyman', extra: 350, eta: 'Same day' },
  { id: 'gig', name: 'GIG Logistics', extra: 900, eta: '1 to 2 days' },
];
const SHIP_STEPS = [
  ['pending', 'Booked'],
  ['picked_up', 'Picked up from the shop'],
  ['in_transit', 'On the way'],
  ['completed', 'Delivered'],
];
// Paystack's fee, added on top for the customer who pays online (online_fee in the real database)
const onlineFee = (b) =>
  b <= 0 ? 0 : Math.ceil(b / 0.985) < 2500 ? Math.ceil(b / 0.985) - b : Math.min(Math.ceil((b + 100) / 0.985) - b, 2000);
const shipmentOf = (o) => (S.shipments || []).find((x) => x.order_id === o.id) || null;
const shipView = (sh) => ({
  courier: sh.courier,
  status: sh.status,
  tracking_url: sh.tracking_url,
  tracking_code: sh.tracking_code,
  steps: sh.steps,
  rider: sh.rider,
});

// Paystack's page, in the demo: a pretend checkout sheet instead of leaving the page.
function demoPaystack(ref, done) {
  const p = (S.online || []).find((x) => x.reference === ref);
  if (!p) return done && done();
  const o = S.orders.find((x) => x.id === p.order_id);
  const s = shopOf(o);
  const wrap = document.createElement('div');
  wrap.className = 'demo-paystack';
  wrap.innerHTML = `<div class="dp-sheet" role="dialog" aria-modal="true" aria-label="Pay online">
    <div class="dp-top"><span class="dp-brand">paystack</span><span class="dp-test">Demo checkout</span></div>
    <div class="dp-shop"></div><div class="dp-amt"></div>
    <div class="dp-ways"><span class="on">Card</span><span>Transfer</span><span>USSD</span></div>
    <button class="btn dp-pay"></button><button class="btn ghost dp-cancel">Cancel</button>
    <p class="note dp-note">In the real app this is Paystack's own page. Nothing is charged in the demo.</p></div>`;
  wrap.querySelector('.dp-shop').textContent = s.name;
  wrap.querySelector('.dp-amt').textContent = naira(p.amount + p.fee);
  wrap.querySelector('.dp-pay').textContent = 'Pay ' + naira(p.amount + p.fee);
  const close = () => {
    wrap.remove();
    if (done) done();
  };
  wrap.querySelector('.dp-cancel').onclick = close;
  wrap.querySelector('.dp-pay').onclick = async () => {
    wrap.querySelector('.dp-pay').textContent = 'Paying…';
    await rpc('customer_paid_online', { p_ref: ref });
    close();
  };
  document.body.appendChild(wrap);
}
if (typeof window !== 'undefined') window.__demoPay = demoPaystack;

// ---------- the database functions the app calls ----------
const RPC = {
  is_admin: () => false,
  my_account: () => ({ vendor: hasShop(uid()), customer: hasShopped(uid()) }),
  touch_shop: () => {
    const s = myShop();
    if (s) s.last_active_at = nowIso();
    return null;
  },
  my_plan: () =>
    myShop()
      ? {
          paid_until: null,
          open: shopOpen(myShop()),
          monthly_price: 0,
          grace_days: 7,
          close_unpaid: true,
          pay_bank: '',
          pay_account_number: '',
          pay_account_name: '',
          admin_whatsapp: '',
        }
      : null,
  get_announcements: () => [],
  set_delivery_fee: ({ p_order, p_fee }) => {
    const o = ownedOrder(p_order);
    if (o.mode !== 'delivery') fail('This order is a pick-up.');
    if (!['awaiting', 'part'].includes(o.status)) fail('The fee is locked once paid.');
    if (p_fee == null || p_fee < 0 || p_fee > 1000000) fail('Enter a delivery fee in naira.');
    o.delivery_fee = p_fee;
    o.delivery_by = 'shop';
    o.delivery_quote = null;
    o.confirmed_at = o.confirmed_at || nowIso();
    return null;
  },
  confirm_payment: ({ p_order, p_method = 'tap', p_amount = null }) => {
    const o = ownedOrder(p_order);
    const s = myShop();
    if (!['awaiting', 'part'].includes(o.status)) fail('This order is already paid or closed.');
    if (o.mode === 'delivery' && o.delivery_paid_by === 'customer' && o.delivery_fee == null)
      fail('Set the delivery fee first.');
    const left = toPay(o) - o.amount_paid;
    const amt = p_amount == null ? left : p_amount;
    if (amt <= 0 || amt > left) fail(`Enter an amount up to ${naira(left)}.`);
    if (amt < left && !s.allow_part_payment) fail(`Part payments are off. Ask for the full ${naira(left)}.`);
    S.payments.push({
      id: S.payments.length + 1,
      order_id: o.id,
      shop_id: o.shop_id,
      amount: amt,
      method: p_method || 'tap',
      created_at: nowIso(),
    });
    o.amount_paid += amt;
    o.customer_says_paid = false;
    o.confirmed_at = o.confirmed_at || nowIso();
    o.status = amt >= left ? 'paid' : 'part';
    if (amt >= left) o.paid_at = nowIso();
    return { paid: amt, left: left - amt };
  },
  mark_customer_says_paid: ({ p_order }) => {
    const o = ownedOrder(p_order);
    if (['awaiting', 'part'].includes(o.status)) {
      o.customer_says_paid = true;
      o.customer_says_paid_at = o.customer_says_paid_at || nowIso();
    }
    return null;
  },
  advance_order: ({ p_order }) => {
    const o = ownedOrder(p_order);
    if (o.status === 'paid' && o.mode === 'delivery') fail('Hand it to a rider first.');
    if (o.status === 'paid' && unpacked(o)) fail('Tick every item as packed first.');
    if (!['paid', 'out'].includes(o.status)) fail('Only paid orders can move on.');
    o.status = 'delivered';
    o.done_at = nowIso();
    o.received_by = 'shop';
    return 'delivered';
  },
  cancel_order: ({ p_order, p_reason = 'other', p_note = '' }) => {
    const o = ownedOrder(p_order);
    if (o.status !== 'awaiting' || o.amount_paid > 0) fail('Only unpaid orders can be cancelled.');
    if (!['out_of_stock', 'cant_deliver', 'customer_asked', 'other'].includes(p_reason))
      fail("Choose why you're cancelling.");
    if (o.customer_says_paid && Date.parse(o.customer_says_paid_at) > Date.now() - DAY)
      fail("The customer says they've paid. Check your bank app first.");
    o.cancel_reason = p_reason;
    o.cancel_note = String(p_note || '')
      .trim()
      .slice(0, 200);
    notify(
      o.customer_id,
      o.id,
      'cancelled',
      shopOf(o).name,
      `${codeOf(o)} was cancelled: ${CANCEL_TEXT[p_reason]}.`,
      '/o/' + o.public_token,
    );
    S.order_items.filter((i) => i.order_id === o.id).forEach(restockItem);
    o.status = 'cancelled';
    o.done_at = nowIso();
    return null;
  },
  add_stock: ({ p_product, p_qty }) => {
    if (p_qty == null || p_qty < 1 || p_qty > 100000) fail('Enter how many came in.');
    const s = myShop();
    const p = s && S.products.find((x) => x.id === p_product && x.shop_id === s.id);
    if (!p) fail('Product not found.');
    if (optionsOf(p).length) fail(`Add stock to each ${(p.option_label || 'size').toLowerCase()} instead.`);
    p.stock += p_qty;
    return p.stock;
  },
  add_option_stock: ({ p_option, p_qty }) => {
    if (p_qty == null || p_qty < 1 || p_qty > 100000) fail('Enter how many came in.');
    const s = myShop();
    const o = s && S.product_options.find((x) => x.id === p_option && x.shop_id === s.id);
    if (!o) fail('Product not found.');
    o.stock += p_qty;
    syncProduct(S.products.find((p) => p.id === o.product_id));
    return o.stock;
  },
  delete_product: ({ p_product }) => {
    const s = myShop();
    const p = s && S.products.find((x) => x.id === p_product && x.shop_id === s.id);
    if (!p) fail("That product isn't in your shop. Refresh the page.");
    if (p.hidden_by_admin) fail('ShopDesk hid this product, so it stays. Message ShopDesk about it.');
    const open = S.order_items.some(
      (i) =>
        i.product_id === p.id &&
        ['awaiting', 'part', 'paid', 'out'].includes(
          (S.orders.find((o) => o.id === i.order_id) || {}).status,
        ),
    );
    if (open)
      fail(
        `${p.name} is in an order that isn't finished yet. Hide it now, and delete it once that order is delivered or cancelled.`,
      );
    S.products = S.products.filter((x) => x.id !== p.id);
    S.product_options = S.product_options.filter((o) => o.product_id !== p.id);
    S.order_items.forEach((i) => {
      if (i.product_id === p.id) {
        if (!i.photo_path) i.photo_path = p.photo_path;
        i.product_id = null;
        i.option_id = null;
      }
    });
    return null;
  },
  // the same checks and messages as save_product in schema.sql
  save_product: ({ p_product, p }) => {
    const s = myShop();
    if (!s) fail('Set up your shop first.');
    let v = null;
    if (p_product) {
      v = S.products.find((x) => x.id === p_product && x.shop_id === s.id);
      if (!v) fail("That product isn't in your shop. Refresh the page.");
    }
    const name = String(p.name || '').trim();
    if (!name) fail('Give the product a name.');
    if (name.length > 60) fail('Shorten the name to 60 letters or fewer.');
    const photo = String(p.photo_path || '').trim() || (v ? v.photo_path : '');
    if (!photo) fail("Add a photo. Customers want to see what they're buying.");
    const low = jsonInt(p.low_at) ?? (v ? v.low_at : 2);
    if (low < 0 || low > 100000) fail('Enter when to warn you as a number, like 3.');
    const opts = Array.isArray(p.options) ? p.options : [];
    if (opts.length > 20) fail('A product can have up to 20 choices.');
    let label = String(p.option_label || '').trim();
    let price,
      sale = null,
      stock;
    if (!opts.length) {
      label = '';
      price = jsonInt(p.price);
      if (!price || price < 1) fail('Enter a price in naira.');
      if (price > 100000000) fail('The price can be up to ₦100,000,000.');
      sale = jsonInt(p.sale_price);
      if (sale != null && (sale < 1 || sale >= price))
        fail(`The sale price must be less than the price (${'₦' + price.toLocaleString('en-NG')}).`);
      stock = jsonInt(p.stock);
      if (stock == null && (!v || optionsOf(v).length)) fail('Enter how many you have (0 is fine).');
      if (stock != null && (stock < 0 || stock > 1000000))
        fail('Enter how many you have, from 0 to 1,000,000.');
    } else {
      label = label || 'Size';
      if (label.length > 20) fail('Use a shorter word for the choices, like Size or Colour.');
    }
    // check every choice before changing anything (the database does it all in one step)
    const seen = new Set();
    const word = label.toLowerCase();
    const checked = opts.map((o) => {
      const n = String(o.name || '').trim();
      if (!n) fail(`Give each ${word} a name, like Small or 50ml.`);
      if (n.length > 30) fail(`Shorten "${n.slice(0, 30)}" to 30 letters or fewer.`);
      if (seen.has(n.toLowerCase())) fail(`Two choices are called "${n}". Give each one its own name.`);
      seen.add(n.toLowerCase());
      const op = jsonInt(o.price);
      if (!op || op < 1) fail(`Enter a price for ${n}.`);
      const os = jsonInt(o.sale_price);
      if (os != null && (os < 1 || os >= op))
        fail(`The sale price for ${n} must be less than its price (${'₦' + op.toLocaleString('en-NG')}).`);
      const ost = jsonInt(o.stock);
      if (ost != null && (ost < 0 || ost > 1000000))
        fail(`Enter how many ${n} you have, from 0 to 1,000,000.`);
      const old = o.id ? S.product_options.find((x) => x.id === o.id && v && x.product_id === v.id) : null;
      if (o.id && !old)
        fail('This product changed while you were editing it. Refresh the page and try again.');
      if (!old && ost == null) fail(`Enter how many ${n} you have (0 is fine).`);
      return { old, name: n, price: op, sale_price: os, stock: ost };
    });
    if (!v) {
      v = {
        id: uuid(),
        shop_id: s.id,
        active: true,
        hidden_by_admin: false,
        hidden_reason: '',
        created_at: nowIso(),
        stock: 0,
      };
      S.products.push(v);
    }
    Object.assign(v, { name, photo_path: photo, low_at: low, option_label: label, sale_price: sale });
    if (!opts.length) {
      v.price = price;
      if (stock != null) v.stock = stock;
    }
    const keep = new Set(checked.filter((c) => c.old).map((c) => c.old.id));
    S.product_options = S.product_options.filter((x) => x.product_id !== v.id || keep.has(x.id));
    S.order_items.forEach((i) => {
      if (i.option_id && !S.product_options.some((x) => x.id === i.option_id)) i.option_id = null;
    });
    checked.forEach((c, i) => {
      const row = c.old || { id: uuid(), product_id: v.id, shop_id: s.id, created_at: nowIso(), stock: 0 };
      Object.assign(row, {
        name: c.name,
        price: c.price,
        sale_price: c.sale_price,
        sort_order: i + 1,
        ...(c.stock != null ? { stock: c.stock } : {}),
      });
      if (!c.old) S.product_options.push(row);
    });
    syncProduct(v);
    return v.id;
  },
  hand_to_rider: ({ p_order, p_rider_name, p_rider_phone, p_deliver_by }) => {
    const o = ownedOrder(p_order);
    if (o.mode !== 'delivery') fail('This is a pick-up order.');
    if (!['paid', 'out'].includes(o.status)) fail('Only paid orders can go out.');
    if (o.status === 'paid' && unpacked(o)) fail('Tick every item as packed first.');
    if (String(p_rider_name || '').trim().length < 2) fail("Enter the rider's name.");
    if (!/^(234|0)?[789][01]\d{8}$/.test(String(p_rider_phone || '').replace(/\D/g, '')))
      fail("Check the rider's number, like 0803 123 4567.");
    const by = Date.parse(p_deliver_by);
    if (!by || by < Date.now() - 5 * MIN || by > Date.now() + 14 * DAY)
      fail('Pick a delivery time within 14 days.');
    Object.assign(o, {
      status: 'out',
      out_at: o.out_at || nowIso(),
      rider_name: String(p_rider_name).trim().slice(0, 60),
      rider_phone: String(p_rider_phone).trim().slice(0, 20),
      deliver_by: iso(by),
      confirmed_at: o.confirmed_at || nowIso(),
    });
    return null;
  },
  mark_ready: ({ p_order, p_ready_by }) => {
    const o = ownedOrder(p_order);
    if (o.mode !== 'pickup') fail('This is a delivery order.');
    if (!['paid', 'out'].includes(o.status)) fail('Only paid orders can be made ready.');
    if (o.status === 'paid' && unpacked(o)) fail('Tick every item as packed first.');
    const by = Date.parse(p_ready_by);
    if (!by || by < Date.now() - 5 * MIN || by > Date.now() + 14 * DAY) fail('Pick a time within 14 days.');
    Object.assign(o, {
      status: 'out',
      out_at: o.out_at || nowIso(),
      deliver_by: iso(by),
      confirmed_at: o.confirmed_at || nowIso(),
    });
    return null;
  },
  pack_item: ({ p_item, p_packed }) => {
    const item = S.order_items.find((i) => i.id === Number(p_item)) || fail('Item not found.');
    const o = ownedOrder(item.order_id);
    if (!['awaiting', 'part', 'paid'].includes(o.status)) fail('This order has already gone out.');
    item.packed = !!p_packed;
    return null;
  },
  set_packing_photo: ({ p_order, p_path }) => {
    const o = ownedOrder(p_order);
    if (p_path && !new RegExp('^' + o.id + '/pack-[0-9a-f-]{36}\\.jpg$').test(p_path))
      fail("That photo can't be used. Take it again.");
    o.packing_photo = p_path || null;
    return null;
  },
  answer_problem: ({ p_order, p_reply, p_note, p_refund, p_photos }) => {
    const o = ownedOrder(p_order);
    const pr = problemOf(o) || fail("There's no problem on this order.");
    if (pr.reply || !['open', 'with_shopdesk'].includes(pr.status)) fail("You've already answered.");
    if (!['refund', 'resend', 'explain'].includes(p_reply)) fail("Choose how you'll sort it.");
    if (p_reply === 'explain' && String(p_note || '').trim().length < 10) fail('Say what happened.');
    if (p_reply === 'refund' && (!p_refund || p_refund < 1 || p_refund > Math.max(o.amount_paid, 1)))
      fail(`Enter the amount you sent back (up to ${naira(o.amount_paid)}).`);
    const late = pr.status === 'with_shopdesk' || Date.parse(pr.created_at) < Date.now() - 48 * HOUR;
    Object.assign(pr, {
      reply: p_reply,
      reply_note: String(p_note || '')
        .trim()
        .slice(0, 600),
      reply_photos: (p_photos || []).slice(0, 3),
      refund_amount: p_reply === 'refund' ? p_refund : null,
      answered_at: nowIso(),
      status: late ? 'with_shopdesk' : 'answered',
      escalated_at: late ? pr.escalated_at || nowIso() : pr.escalated_at,
      escalated_by: late ? pr.escalated_by || 'no_reply' : pr.escalated_by,
    });
    if (p_reply === 'resend') {
      S.order_items.filter((i) => i.order_id === o.id).forEach((i) => (i.packed = false));
      Object.assign(o, {
        status: 'paid',
        out_at: null,
        deliver_by: null,
        done_at: null,
        received_at: null,
        received_by: null,
      });
    }
    notify(
      o.customer_id,
      o.id,
      'problem_answer',
      shopOf(o).name,
      `${codeOf(o)}: ${p_reply === 'refund' ? `refund of ${naira(p_refund)} sent. Confirm when it arrives.` : p_reply === 'resend' ? 'sending it again.' : 'the shop answered.'}`,
      '/o/' + o.public_token,
    );
    return null;
  },
  confirm_order: ({ p_order }) => {
    const o = ownedOrder(p_order);
    if (o.status === 'cancelled') fail('This order was cancelled.');
    if (o.mode === 'delivery' && o.delivery_paid_by === 'customer' && o.delivery_fee == null)
      fail('Set the delivery fee first.');
    o.confirmed_at = o.confirmed_at || nowIso();
    return null;
  },

  // ----- customers -----
  // invites: switched on in the demo so the Shop tab shows the card (on the real site Admin switches them on)
  my_invites: () => {
    const s = myShop();
    if (!s || s.status !== 'active') return null;
    const joined = (days) => new Date(Date.now() - days * 86400000).toISOString();
    const real = S.shops
      .filter((x) => x.invited_by === s.id)
      .map((x) => ({ name: x.name, joined: x.created_at, state: x.status === 'active' ? 'approved' : x.status === 'pending' ? 'pending' : 'closed' }));
    const sample =
      s.id === S.shops[0].id
        ? [
            { name: 'Kemi Wigs', joined: joined(1), state: 'pending' },
            { name: "Tola's Kitchen", joined: joined(4), state: 'approved' },
            { name: 'Ada Fabrics', joined: joined(9), state: 'rewarded' },
          ]
        : [];
    return { on: true, slug: s.slug, months: 1, new_months: 1, rewarded: sample.filter((x) => x.state === 'rewarded').length, shops: [...real, ...sample] };
  },
  claim_invite: ({ p_slug }) => {
    const me = myShop();
    const inv = S.shops.find((x) => x.slug === String(p_slug || '').toLowerCase() && x.status === 'active');
    if (!me || !inv || inv.id === me.id || me.invited_by) return false;
    me.invited_by = inv.id;
    save();
    return true;
  },
  shops_near: () => [
    ...S.shops
      .filter((s) => shopOpen(s) && S.products.some((p) => p.shop_id === s.id && p.active && !p.hidden_by_admin))
      .map((s) => ({
        name: s.name,
        slug: s.slug,
        sells: s.sells,
        location: s.location,
        photo_path: (S.products.find((p) => p.shop_id === s.id && p.active && !p.hidden_by_admin) || {}).photo_path || null,
        ...ratingOf(s.id),
      })),
    ...OTHER_SHOPS.map((x) => ({ ...x, photo_path: null })),
  ],
  shop_reviews: ({ p_slug }) => {
    const s = S.shops.find((x) => x.slug === String(p_slug).toLowerCase() && x.status === 'active');
    if (!s) return null;
    const l = ratingsOf(s.id).sort((a, b) => b.at.localeCompare(a.at));
    const stars = {};
    [1, 2, 3, 4, 5].forEach((k) => (stars[k] = l.filter((r) => r.stars === k).length));
    return {
      name: s.name,
      slug: s.slug,
      ...ratingOf(s.id),
      stars,
      reviews: l.map((r) => ({ who: r.who, stars: r.stars, comment: r.comment, at: r.at, bought: r.bought })),
    };
  },
  my_shop_rating: ({ p_token }) => {
    const o = S.orders.find((x) => x.public_token === p_token && x.customer_id === uid());
    if (!o) return null;
    const r = ratingsOf(o.shop_id).find((x) => x.customer_id === uid());
    return r ? { stars: r.stars, comment: r.comment, at: r.at } : null;
  },
  rate_shop: ({ p_token, p_stars, p_comment = '' }) => {
    if (!uid()) fail('Sign in to rate this shop.');
    const o = S.orders.find((x) => x.public_token === p_token && x.customer_id === uid());
    if (!o) fail('Only the customer who placed this order can rate the shop.');
    if (o.status !== 'delivered') fail('You can rate the shop once your order is delivered.');
    if (!(p_stars >= 1 && p_stars <= 5)) fail('Pick 1 to 5 stars.');
    const comment = String(p_comment || '').trim().slice(0, 400);
    ratingsOf(o.shop_id);
    const bought = S.order_items.filter((i) => i.order_id === o.id).map((i) => i.name).join(', ');
    const row = { shop_id: o.shop_id, customer_id: uid(), who: shortName(o.customer_name), stars: p_stars, comment, bought, at: nowIso() };
    const i = S.ratings.findIndex((x) => x.shop_id === o.shop_id && x.customer_id === uid());
    if (i >= 0) S.ratings[i] = row;
    else S.ratings.push(row);
    save();
    return { ...ratingOf(o.shop_id), stars: p_stars, comment };
  },
  get_storefront: ({ p_slug }) => {
    const s = S.shops.find((x) => x.slug === String(p_slug).toLowerCase());
    if (!shopOpen(s)) return null;
    return {
      shop: {
        name: s.name,
        slug: s.slug,
        bank: s.bank,
        account_number: s.account_number,
        account_name: s.account_name,
        allow_part_payment: s.allow_part_payment,
        delivery_paid_by: s.delivery_paid_by,
        ...ratingOf(s.id),
      },
      products: S.products
        .filter((p) => p.shop_id === s.id && p.active && !p.hidden_by_admin)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          sale_price: p.sale_price ?? null,
          stock: p.stock,
          photo_path: p.photo_path,
          option_label: p.option_label || '',
          options: optionsOf(p).map((o) => ({
            id: o.id,
            name: o.name,
            price: o.price,
            sale_price: o.sale_price,
            stock: o.stock,
          })),
        })),
    };
  },
  place_order: ({ p_slug, p_customer, p_items }) => {
    if (!uid()) fail('Sign in to order.');
    if (hasShop(uid())) fail(SHOP_EMAIL);
    const s = S.shops.find((x) => x.slug === String(p_slug).toLowerCase());
    if (!shopOpen(s)) fail("This shop isn't taking orders right now.");
    if (!Array.isArray(p_items) || !p_items.length || p_items.length > 30)
      fail('Pick between 1 and 30 items.');
    const c = p_customer || {};
    const mode = c.mode || 'delivery';
    if (!['delivery', 'pickup'].includes(mode)) fail('Choose delivery or pick-up.');
    if (!String(c.name || '').trim()) fail('Add your name.');
    const pin =
      mode === 'delivery' && typeof c.lat === 'number' && typeof c.lng === 'number' && Math.abs(c.lat) <= 90
        ? { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) }
        : null;
    let address =
      mode === 'delivery'
        ? String(c.address || '')
            .trim()
            .slice(0, 160)
        : '';
    if (mode === 'delivery' && address.length < 3) {
      if (!pin) fail('Add a delivery address.');
      address = `Map pin ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`;
    }
    const taken = {};
    const lines = p_items.map((it) => {
      const qty = Number(it.qty);
      if (!qty || qty < 1 || qty > 99) fail('Each item needs a quantity from 1 to 99.');
      const p = S.products.find(
        (x) => x.id === it.product_id && x.shop_id === s.id && x.active && !x.hidden_by_admin,
      );
      if (!p) fail('An item is no longer available.');
      if (optionsOf(p).length) {
        const o = optionsOf(p).find((x) => x.id === it.option_id);
        if (!o) fail(`Choose a ${(p.option_label || 'size').toLowerCase()} for ${p.name}.`);
        taken[o.id] = (taken[o.id] || 0) + qty;
        if (!o.stock) fail(`${p.name} (${o.name}) is sold out.`);
        if (o.stock < taken[o.id]) fail(`${p.name} (${o.name}) has only ${o.stock} left.`);
        return { p, o, qty };
      }
      taken[p.id] = (taken[p.id] || 0) + qty;
      if (!p.stock) fail(`${p.name} is sold out.`);
      if (p.stock < taken[p.id]) fail(`${p.name} has only ${p.stock} left.`);
      return { p, qty };
    });
    const o = {
      id: Math.max(...S.orders.map((x) => x.id)) + 1,
      shop_id: s.id,
      public_token: uuid(),
      customer_id: uid(),
      customer_name: String(c.name).trim().slice(0, 60),
      customer_phone: String(c.phone || '')
        .trim()
        .slice(0, 20),
      mode,
      address,
      area:
        mode === 'delivery'
          ? String(c.area || '')
              .trim()
              .slice(0, 40) || null
          : null,
      source: ['whatsapp', 'instagram', 'tiktok', 'facebook', 'snapchat', 'x', 'direct'].includes(c.source)
        ? c.source
        : 'direct',
      delivery_lat: pin ? pin.lat : null,
      delivery_lng: pin ? pin.lng : null,
      items_total: 0,
      delivery_fee: null,
      delivery_paid_by: s.delivery_paid_by,
      amount_paid: 0,
      status: 'awaiting',
      customer_says_paid: false,
      customer_says_paid_at: null,
      created_at: nowIso(),
      confirmed_at: null,
      paid_at: null,
      out_at: null,
      done_at: null,
      deliver_by: null,
      received_at: null,
      received_by: null,
      rider_name: '',
      rider_phone: '',
      customer_details_purged: false,
    };
    const old = S.customers.find((x) => x.user_id === uid());
    const row = {
      user_id: uid(),
      name: o.customer_name,
      phone: o.customer_phone,
      address: (pin && address.startsWith('Map pin') ? '' : o.address) || (old ? old.address : ''),
      area: o.area || (old ? old.area : '') || '',
      updated_at: nowIso(),
    };
    if (old) Object.assign(old, row);
    else S.customers.push(row);
    lines.forEach(({ p, o: opt, qty }) => {
      const pay = opt ? (opt.sale_price ?? opt.price) : (p.sale_price ?? p.price);
      const full = opt ? opt.price : p.price;
      if (opt) {
        opt.stock -= qty;
        syncProduct(p);
      } else p.stock -= qty;
      S.order_items.push({
        id: S.order_items.length + 1,
        order_id: o.id,
        product_id: p.id,
        option_id: opt ? opt.id : null,
        option_name: opt ? opt.name : '',
        name: opt ? `${p.name} · ${opt.name}` : p.name,
        price: pay,
        was_price: pay < full ? full : null,
        qty,
        photo_path: p.photo_path,
      });
      o.items_total += pay * qty;
    });
    S.orders.push(o);
    notify(
      s.owner_id,
      o.id,
      'new_order',
      `New order ${codeOf(o)}`,
      `${o.customer_name} · ${naira(o.items_total)}${mode === 'pickup' ? ' · pick-up' : ''}`,
      `/?order=${o.id}#orders`,
    );
    return {
      order_id: o.id,
      token: o.public_token,
      items_total: o.items_total,
      delivery_pending: mode === 'delivery' && s.delivery_paid_by === 'customer',
    };
  },
  // ---------- Pay online and ShopDesk Delivery (switched on in the demo; the real ones are off until Admin turns them on) ----------
  money_switches: () => ({ online: true, delivery: true, fee_by: 'customer' }),
  order_money: ({ p_token }) => {
    const o = S.orders.find((x) => x.public_token === p_token);
    if (!o) return null;
    const s = shopOf(o);
    const sh = shipmentOf(o);
    return {
      online:
        ['OPay', 'Moniepoint', 'Kuda', 'PalmPay'].includes(s.bank) &&
        ['awaiting', 'part'].includes(o.status) &&
        !(o.mode === 'delivery' && o.delivery_paid_by === 'customer' && o.delivery_fee == null),
      fee: onlineFee(toPay(o) - o.amount_paid),
      delivery_by: o.delivery_by || 'shop',
      courier: o.delivery_quote ? o.delivery_quote.name : null,
      shipment: sh ? shipView(sh) : null,
    };
  },
  save_courier_quotes: ({ p_order }) => {
    const o = ownedOrder(p_order);
    if (o.mode !== 'delivery') fail('This order is a pick-up.');
    if (o.status !== 'awaiting' || o.amount_paid > 0) fail('The fee is locked once paid.');
    if (!(myShop().pickup_address || '').trim()) fail('Add your pickup address on the Shop tab first.');
    const base = 1400 + (o.id % 7) * 250;
    const list = COURIERS.map((c, i) => ({
      courier_id: c.id,
      service_code: c.id + '_std',
      name: c.name,
      image: null,
      cost: base + c.extra,
      price: Math.ceil((base + c.extra + 200) / 50) * 50,
      eta: null,
      eta_text: c.eta,
      token: 'demo',
      ...(i === 0 ? { cheapest: true } : {}),
      ...(c.fast ? { fastest: true } : {}),
    }));
    o.delivery_quotes = { at: nowIso(), list };
    return { list: list.map(({ cost, token, ...q }) => q) };
  },
  set_courier: ({ p_order, p_courier, p_service }) => {
    const o = ownedOrder(p_order);
    if (o.status !== 'awaiting' || o.amount_paid > 0) fail('The fee is locked once paid.');
    const q = ((o.delivery_quotes && o.delivery_quotes.list) || []).find(
      (x) => x.courier_id === p_courier && x.service_code === p_service,
    );
    if (!q) fail('Get the courier prices again.');
    Object.assign(o, { delivery_fee: q.price, delivery_by: 'shopdesk', delivery_quote: q, confirmed_at: o.confirmed_at || nowIso() });
    return { name: q.name, price: q.price, eta: q.eta, eta_text: q.eta_text };
  },
  money_own_rider: ({ p_order }) => {
    const o = ownedOrder(p_order);
    if (shipmentOf(o)) fail('This order is already booked with a courier.');
    if ((S.online || []).some((p) => p.order_id === o.id && p.paid && p.delivery_part > 0))
      fail('The customer paid ShopDesk for this delivery, so it goes with ShopDesk Delivery.');
    o.delivery_by = 'shop';
    return null;
  },
  hand_to_courier: ({ p_order }) => {
    const o = ownedOrder(p_order);
    if (o.delivery_by !== 'shopdesk' || !o.delivery_quote) fail("This order isn't set up for ShopDesk Delivery.");
    if (o.status !== 'paid') fail('Only paid orders can be booked.');
    if (unpacked(o)) fail('Tick every item as packed first.');
    if (shipmentOf(o)) fail('This order is already booked.');
    const q = o.delivery_quote;
    S.shipments = S.shipments || [];
    S.shipments.push({
      order_id: o.id,
      shop_id: o.shop_id,
      sb_order: 'SB-' + o.id,
      courier: q.name,
      status: 'pending',
      tracking_url: null,
      tracking_code: 'SDX' + (40000 + o.id),
      rider: null,
      steps: [{ status: 'Booked with ' + q.name, at: nowIso() }],
      cost: q.cost,
      price: q.price,
      paid_online: (S.online || []).some((p) => p.order_id === o.id && p.paid && p.delivery_part > 0),
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    Object.assign(o, {
      status: 'out',
      out_at: nowIso(),
      rider_name: q.name,
      rider_phone: '0201 888 0000',
      deliver_by: iso(Date.now() + (q.courier_id === 'kwik' ? 5 : 26) * HOUR),
    });
    return { courier: q.name, tracking_url: null, status: 'pending' };
  },
  // Each refresh moves a demo delivery one step on (at most every few seconds): picked up, on the way, delivered.
  set_courier_progress: ({ p_order, p_token }) => {
    const o = p_token ? S.orders.find((x) => x.public_token === p_token) : ownedOrder(p_order);
    const sh = o && shipmentOf(o);
    if (!sh) return { shipment: null };
    const step = SHIP_STEPS.findIndex((x) => x[0] === sh.status);
    if (step >= 0 && step < SHIP_STEPS.length - 1 && Date.now() - Date.parse(sh.updated_at) > 6000) {
      const [status, words] = SHIP_STEPS[step + 1];
      sh.status = status;
      sh.steps = [...sh.steps, { status: words, at: nowIso() }];
      sh.updated_at = nowIso();
      if (status === 'picked_up') sh.rider = { name: 'Musa Bello', phone: '0803 555 0199' };
      if (status === 'completed' && o.status === 'out')
        Object.assign(o, { status: 'delivered', done_at: nowIso(), received_by: 'shop' });
    }
    return { shipment: shipView(sh) };
  },
  customer_pay_online: ({ p_token }) => {
    const o = customerOrder(p_token);
    if (!['awaiting', 'part'].includes(o.status)) fail('This order is already paid or closed.');
    if (o.mode === 'delivery' && o.delivery_paid_by === 'customer' && o.delivery_fee == null)
      fail('Wait for the shop to confirm your order and its delivery fee.');
    const due = toPay(o) - o.amount_paid;
    const ref = 'SDDEMO-' + o.id + '-' + Date.now().toString(36).toUpperCase();
    S.online = S.online || [];
    S.online.push({
      reference: ref,
      order_id: o.id,
      amount: due,
      fee: onlineFee(due),
      delivery_part: o.delivery_by === 'shopdesk' && o.amount_paid === 0 ? o.delivery_fee || 0 : 0,
      paid: false,
    });
    return { url: ref, amount: due, shop: shopOf(o).name };
  },
  customer_paid_online: ({ p_ref }) => {
    const p = (S.online || []).find((x) => x.reference === p_ref) || fail('Unknown payment.');
    if (p.paid) return { paid: true };
    const o = S.orders.find((x) => x.id === p.order_id);
    const due = toPay(o) - o.amount_paid;
    p.paid = true;
    if (due > 0 && ['awaiting', 'part'].includes(o.status)) {
      const amt = Math.min(p.amount, due);
      S.payments.push({ id: S.payments.length + 1, order_id: o.id, shop_id: o.shop_id, amount: amt, method: 'online', created_at: nowIso() });
      o.amount_paid += amt;
      o.customer_says_paid = false;
      o.confirmed_at = o.confirmed_at || nowIso();
      o.status = amt >= due ? 'paid' : 'part';
      if (amt >= due) o.paid_at = nowIso();
    }
    return { paid: true };
  },
  get_order_public: ({ p_token }) => {
    const o = S.orders.find((x) => x.public_token === p_token);
    if (!o) return null;
    const s = S.shops.find((x) => x.id === o.shop_id);
    const riderShown =
      o.status === 'out' || (o.status === 'delivered' && Date.parse(o.done_at) > Date.now() - 2 * DAY);
    return {
      order_id: o.id,
      status: o.status,
      mode: o.mode,
      items_total: o.items_total,
      delivery_fee: o.delivery_fee,
      delivery_paid_by: o.delivery_paid_by,
      amount_paid: o.amount_paid,
      customer_says_paid: o.customer_says_paid,
      created_at: o.created_at,
      confirmed_at: o.confirmed_at,
      paid_at: o.paid_at,
      out_at: o.out_at,
      deliver_by: o.deliver_by,
      received_at: o.received_at,
      received_by: o.received_by,
      done_at: o.done_at,
      rider_name: riderShown ? o.rider_name : null,
      rider_phone: riderShown ? o.rider_phone : null,
      saved: !!o.customer_id,
      mine: !!o.customer_id && o.customer_id === uid(),
      to_pay: toPay(o),
      items: S.order_items
        .filter((i) => i.order_id === o.id)
        .map((i) => ({ name: i.name, price: i.price, qty: i.qty })),
      shop: {
        name: s.name,
        slug: s.slug,
        bank: s.bank,
        account_number: s.account_number,
        account_name: s.account_name,
      },
      code: codeOf(o),
      report_until: o.status === 'delivered' ? iso(Date.parse(o.done_at) + 3 * DAY) : null,
      can_report: !!o.customer_id && o.customer_id === uid() && canReport(o),
      has_problem: !!problemOf(o),
      can_chat: !!o.customer_id && o.customer_id === uid() && canChat(o),
      report_block: null,
      pay_by:
        o.status === 'awaiting' && !o.amount_paid && !o.customer_says_paid
          ? iso(Date.parse(o.created_at) + 48 * HOUR)
          : null,
      can_cancel:
        !!o.customer_id &&
        o.customer_id === uid() &&
        o.status === 'awaiting' &&
        !o.amount_paid &&
        !o.customer_says_paid,
      cancel_reason: o.cancel_reason || null,
      cancel_note: o.cancel_note || '',
      problem: (() => {
        const p = problemOf(o);
        if (!p || !o.customer_id || o.customer_id !== uid()) return null;
        const st = problemStatus(p);
        return {
          ...p,
          status: st,
          escalated_by: p.escalated_by || (st === 'with_shopdesk' && p.status === 'open' ? 'no_reply' : null),
          reply_by: iso(Date.parse(p.created_at) + 48 * HOUR),
        };
      })(),
    };
  },
  report_problem: ({ p_token, p_kind, p_details, p_photos }) => {
    const o = customerOrder(p_token);
    if (!uid() || o.customer_id !== uid()) fail('Sign in with the email you ordered with.');
    if (problemOf(o)) fail("You've already reported this order.");
    if (!canReport(o)) fail('You can report up to 3 days after delivery.');
    if (!KINDS.includes(p_kind)) fail('Choose what went wrong.');
    if (String(p_details || '').trim().length < 10) fail('Say what happened.');
    if (['wrong_item', 'damaged', 'missing_item'].includes(p_kind) && !(p_photos || []).length)
      fail('Add a photo of what you got.');
    S.problems.push({
      id: Math.max(0, ...S.problems.map((p) => p.id)) + 1,
      order_id: o.id,
      shop_id: o.shop_id,
      customer_id: uid(),
      kind: p_kind,
      details: String(p_details).trim().slice(0, 600),
      photos: (p_photos || []).slice(0, 3),
      status: 'open',
      reply: null,
      reply_note: '',
      reply_photos: [],
      refund_amount: null,
      refund_received_at: null,
      answered_at: null,
      escalated_at: null,
      escalated_by: null,
      decision: null,
      decision_note: '',
      decided_at: null,
      closed_at: null,
      created_at: nowIso(),
    });
    notify(
      shopOf(o).owner_id,
      o.id,
      'problem',
      `Problem · ${codeOf(o)}`,
      `${KIND_TEXT[p_kind]}. Answer by ${lagosTime(Date.now() + 48 * HOUR)}.`,
      `/?order=${o.id}#orders`,
    );
    return null;
  },
  problem_customer: ({ p_token, p_action }) => {
    const o = customerOrder(p_token);
    if (!uid() || o.customer_id !== uid()) fail('Sign in with the email you ordered with.');
    const pr = problemOf(o) || fail("There's no problem on this order.");
    const st = problemStatus(pr);
    const tell = (kind, title, body) =>
      notify(shopOf(o).owner_id, o.id, kind, `${title} · ${codeOf(o)}`, body, `/?order=${o.id}#orders`);
    if (p_action === 'refund_received' && pr.owed_amount && !pr.owed_paid_at) {
      Object.assign(pr, {
        owed_paid_at: nowIso(),
        owed_cleared_by: 'customer',
        refund_received_at: pr.refund_received_at || nowIso(),
      });
      tell('refund_ok', 'Refund confirmed', `${o.customer_name} got the ${naira(pr.owed_amount)} refund.`);
      return null;
    }
    if (p_action === 'refund_missing') {
      if (!pr.owed_amount || !pr.owed_sent_at) fail("The shop hasn't said it sent the refund yet.");
      if (pr.owed_disputed_at && !pr.owed_paid_at) fail('ShopDesk is already on it.');
      Object.assign(pr, { owed_disputed_at: nowIso(), owed_paid_at: null, owed_cleared_by: null });
      tell(
        'refund_missing',
        'Refund not received',
        `${o.customer_name} says the refund didn't arrive. ShopDesk will check.`,
      );
      return null;
    }
    if (['sorted', 'decided'].includes(st)) fail('This problem is already closed.');
    if (p_action === 'sorted') {
      Object.assign(pr, { status: 'sorted', closed_at: nowIso() });
      tell('problem_sorted', 'Sorted', `${o.customer_name} says it's sorted.`);
    } else if (p_action === 'refund_received') {
      if (pr.reply !== 'refund') fail("The shop hasn't sent a refund.");
      Object.assign(pr, { status: 'sorted', refund_received_at: nowIso(), closed_at: nowIso() });
      tell('refund_ok', 'Refund confirmed', `${o.customer_name} got the refund.`);
    } else if (p_action === 'escalate') {
      if (st === 'open')
        fail(`The shop has until ${lagosTime(Date.parse(pr.created_at) + 48 * HOUR)} to answer.`);
      if (st === 'with_shopdesk') fail('ShopDesk is already on it.');
      Object.assign(pr, { status: 'with_shopdesk', escalated_at: nowIso(), escalated_by: 'customer' });
      tell('problem_escalated', 'ShopDesk is deciding', 'The customer asked ShopDesk to decide.');
    } else fail('Choose what to do.');
    return null;
  },
  customer_says_paid: ({ p_token }) => {
    const o = customerOrder(p_token);
    if (!['awaiting', 'part'].includes(o.status)) fail('This order is already paid or closed.');
    o.customer_says_paid = true;
    o.customer_says_paid_at = o.customer_says_paid_at || nowIso();
    return null;
  },
  customer_received: ({ p_token }) => {
    const o = customerOrder(p_token);
    const ok =
      o.status === 'out' ||
      (o.status === 'paid' && o.mode === 'pickup') ||
      (o.status === 'delivered' && o.received_by !== 'customer');
    if (!ok) fail("This order can't be marked received yet.");
    Object.assign(o, {
      status: 'delivered',
      done_at: o.done_at || nowIso(),
      received_at: nowIso(),
      received_by: 'customer',
    });
    const p = problemOf(o);
    if (p && p.status === 'answered' && p.reply === 'resend')
      Object.assign(p, { status: 'sorted', closed_at: nowIso() });
    return null;
  },
  my_orders: () => {
    if (!uid()) return [];
    return S.orders
      .filter((o) => o.customer_id === uid())
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((o) => {
        const s = S.shops.find((x) => x.id === o.shop_id);
        return {
          token: o.public_token,
          order_id: o.id,
          code: codeOf(o),
          problem: problemOf(o) ? problemStatus(problemOf(o)) : null,
          shop: s.name,
          slug: s.slug,
          status: o.status,
          mode: o.mode,
          created_at: o.created_at,
          deliver_by: o.deliver_by,
          received_by: o.received_by,
          to_pay: toPay(o),
          items: S.order_items
            .filter((i) => i.order_id === o.id)
            .map((i) => `${i.qty} × ${i.name}`)
            .join(', '),
        };
      });
  },
  claim_orders: ({ p_tokens }) => {
    if (!uid()) fail('Sign in first.');
    if (hasShop(uid())) fail(SHOP_EMAIL);
    let n = 0;
    S.orders.forEach((o) => {
      if ((p_tokens || []).includes(o.public_token) && !o.customer_id) {
        o.customer_id = uid();
        n++;
      }
    });
    return n;
  },
  customer_cancel: ({ p_token }) => {
    const o = customerOrder(p_token);
    if (!uid() || o.customer_id !== uid()) fail('Sign in with the email you ordered with.');
    if (o.status !== 'awaiting' || o.amount_paid > 0) fail('Only unpaid orders can be cancelled.');
    if (o.customer_says_paid) fail("You said you've paid. Message the shop.");
    S.order_items.filter((i) => i.order_id === o.id).forEach(restockItem);
    Object.assign(o, { status: 'cancelled', done_at: nowIso(), cancel_reason: 'customer' });
    notify(
      shopOf(o).owner_id,
      o.id,
      'cancelled',
      `${o.customer_name} cancelled ${codeOf(o)}`,
      'The items are back in stock.',
      `/?order=${o.id}#orders`,
    );
    return null;
  },
  report_message: ({ p_message, p_reason }) => {
    const m = S.messages.find((x) => x.id === Number(p_message)) || fail('Message not found.');
    const o = S.orders.find((x) => x.id === m.order_id);
    const who =
      shopOf(o).owner_id === uid()
        ? 'shop'
        : o.customer_id === uid()
          ? 'customer'
          : fail('Message not found.');
    if (m.sender === who) fail("You can't report your own message.");
    if (S.reports.some((r) => r.message_id === m.id && r.reporter_id === uid()))
      fail("You've already reported this message.");
    S.reports.push({
      shop_id: o.shop_id,
      reason: String(p_reason),
      contact: '',
      order_id: o.id,
      reporter_id: uid(),
      message_id: m.id,
      about: m.sender,
      created_at: nowIso(),
    });
    return null;
  },
  report_shop: ({ p_slug, p_reason, p_contact, p_token }) => {
    if (!uid()) fail('Sign in to report a shop.');
    const s = S.shops.find((x) => x.slug === String(p_slug).toLowerCase()) || fail('Shop not found.');
    if (String(p_reason || '').trim().length < 5) fail('Say what went wrong.');
    const o =
      p_token &&
      S.orders.find(
        (x) =>
          x.public_token === p_token && x.shop_id === s.id && (!x.customer_id || x.customer_id === uid()),
      );
    S.reports.push({
      shop_id: s.id,
      reason: String(p_reason).trim(),
      contact: String(p_contact || '').trim(),
      order_id: o ? o.id : null,
      reporter_id: uid(),
      created_at: nowIso(),
    });
    return null;
  },

  // ----- chat and alerts -----
  send_message: ({ p_order, p_body, p_photo = null }) => {
    const o = S.orders.find((x) => x.id === Number(p_order)) || fail('Order not found.');
    const s = shopOf(o);
    const who =
      s.owner_id === uid()
        ? 'shop'
        : o.customer_id && o.customer_id === uid()
          ? 'customer'
          : fail('Order not found.');
    if (!canChat(o)) fail('Chat is closed for this order.');
    const body = String(p_body || '')
      .trim()
      .slice(0, 1000);
    if (!body && !p_photo) fail('Write a message.');
    if (p_photo && !new RegExp('^' + o.id + '/m-[0-9a-f-]{36}\\.jpg$').test(p_photo))
      fail("That photo can't be sent. Try again.");
    const m = {
      id: Math.max(0, ...S.messages.map((x) => x.id)) + 1,
      order_id: o.id,
      shop_id: o.shop_id,
      customer_id: o.customer_id,
      sender: who,
      body,
      photo: p_photo || null,
      created_at: nowIso(),
    };
    S.messages.push(m);
    live('messages', m);
    if (who === 'shop')
      notify(o.customer_id, o.id, 'message', s.name, body || 'Photo', `/o/${o.public_token}#chat`);
    else
      notify(
        s.owner_id,
        o.id,
        'message',
        `${o.customer_name} · ${codeOf(o)}`,
        body || 'Photo',
        `/?chat=${o.id}#orders`,
      );
    return m;
  },
  // a shop writes to one of its customers (shown on that shop in their Shops tab)
  message_customer: ({ p_customer, p_body }) => {
    const s = myShop();
    if (!s) fail('Not allowed.');
    const b = String(p_body || '')
      .trim()
      .slice(0, 300);
    if (!b) fail('Write a message.');
    if (!p_customer || !S.orders.some((o) => o.shop_id === s.id && o.customer_id === p_customer))
      fail('You can only message customers who have ordered from you.');
    if (/\d{10,}/.test(b.replace(/[\s.-]/g, '')))
      fail("Send account and phone numbers in an order's chat instead.");
    if (
      S.notifications.some(
        (n) =>
          n.user_id === p_customer &&
          n.kind === 'shop_message' &&
          n.url === '/' + s.slug &&
          Date.parse(n.created_at) > Date.now() - 7 * DAY,
      )
    )
      fail('You messaged this customer in the last 7 days. Try again later.');
    notify(p_customer, null, 'shop_message', s.name, b, '/' + s.slug);
    return null;
  },
  mark_read: ({ p_order = null, p_kind = null }) => {
    S.notifications.forEach((n) => {
      if (
        n.user_id === uid() &&
        !n.read_at &&
        (p_order == null || n.order_id === Number(p_order)) &&
        (p_kind == null || n.kind === p_kind)
      )
        n.read_at = nowIso();
    });
    return null;
  },
  save_push_sub: () => null,
  delete_push_sub: () => null,
  // email backup: the switch works; nothing is emailed from the demo
  seen_app: () => null,
  my_email_settings: () => ({
    on: S.emailsOff ? !S.emailsOff[uid()] : true,
    email: (me() || {}).email || '',
  }),
  set_email_alerts: ({ p_on }) => {
    S.emailsOff = { ...(S.emailsOff || {}), [uid()]: !p_on };
    demo.setHint(
      p_on
        ? 'On the real site, ShopDesk now emails what you miss after 10 minutes away.'
        : 'Emails off. Phone alerts and the app stay the same.',
    );
    return null;
  },
  email_by_token: () => fail('This link only works in emails from the real site.'),
  refund_sent: ({ p_order, p_receipt = null }) => {
    const o = ownedOrder(p_order);
    const pr =
      S.problems.find((p) => p.order_id === o.id && p.owed_amount && !p.owed_paid_at) ||
      fail('No refund is owed on this order.');
    if (!p_receipt || !new RegExp('^' + o.id + '/r-[0-9a-f-]{36}\\.jpg$').test(p_receipt))
      fail('Add a photo of the transfer receipt.');
    Object.assign(pr, { owed_sent_at: nowIso(), owed_receipt: p_receipt });
    notify(
      o.customer_id,
      o.id,
      'refund_sent',
      shopOf(o).name,
      `${codeOf(o)}: refund of ${naira(pr.owed_amount)} sent. Check your bank and tell us if it arrived.`,
      '/o/' + o.public_token,
    );
    return null;
  },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const WRITES =
  /^(set_|confirm|mark_|advance|cancel|add_|hand_|place|customer_|claim|report|touch|pack_|answer_|problem_|send_|refund_|save_|delete_)/;
async function rpc(name, args = {}) {
  await wait(90);
  const fn = RPC[name];
  if (!fn) return { data: null, error: { message: "This part of ShopDesk isn't in the demo." } };
  try {
    const before = WRITES.test(name) ? new Map(S.orders.map((o) => [o.id, { ...o }])) : null;
    const data = clone(fn(args || {}));
    if (before) S.orders.forEach((o) => before.has(o.id) && orderMoved(o, before.get(o.id)));
    if (WRITES.test(name)) save();
    return { data, error: null };
  } catch (e) {
    return { data: null, error: { message: e.message } };
  }
}

// ---------- tables the app reads and writes directly (with the same "only your own rows" rules) ----------
function visible(table) {
  const u = uid();
  const s = myShop();
  if (table === 'shops') return S.shops.filter((x) => x.owner_id === u);
  if (table === 'customers') return S.customers.filter((x) => x.user_id === u);
  if (table === 'notifications') return S.notifications.filter((x) => x.user_id === u);
  if (table === 'messages')
    return S.messages.filter((x) => (s && x.shop_id === s.id) || (u && x.customer_id === u));
  if (!s) return [];
  if (table === 'products') return S.products.filter((x) => x.shop_id === s.id);
  if (table === 'product_options') return S.product_options.filter((x) => x.shop_id === s.id);
  if (table === 'orders') return S.orders.filter((x) => x.shop_id === s.id);
  if (table === 'shipments') return (S.shipments || []).filter((x) => x.shop_id === s.id);
  if (table === 'payments') return S.payments.filter((x) => x.shop_id === s.id);
  if (table === 'money_out') return S.money_out.filter((x) => x.shop_id === s.id);
  if (table === 'problems') return S.problems.filter((x) => x.shop_id === s.id);
  return [];
}
function cmp(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
}
const OPS = {
  eq: (v, x) => v != null && String(v) === String(x),
  neq: (v, x) => String(v) !== String(x),
  gt: (v, x) => v != null && cmp(v, x) > 0,
  gte: (v, x) => v != null && cmp(v, x) >= 0,
  lt: (v, x) => v != null && cmp(v, x) < 0,
  lte: (v, x) => v != null && cmp(v, x) <= 0,
  is: (v, x) => (x === null || x === 'null' ? v == null : v === x),
};

class Query {
  constructor(table) {
    this.table = table;
    this.kind = 'select';
    this.sel = '*';
    this.tests = [];
    this.sorts = [];
    this.from = 0;
    this.to = null;
    this.single = null;
  }
  select(s = '*') {
    if (this.kind === 'select') this.sel = s;
    else this.returning = s;
    return this;
  }
  insert(v) {
    this.kind = 'insert';
    this.values = v;
    return this;
  }
  update(v) {
    this.kind = 'update';
    this.values = v;
    return this;
  }
  delete() {
    this.kind = 'delete';
    return this;
  }
  filter(col, op, val) {
    this.tests.push((r) => OPS[op](r[col], val));
    return this;
  }
  eq(c, v) {
    return this.filter(c, 'eq', v);
  }
  neq(c, v) {
    return this.filter(c, 'neq', v);
  }
  gt(c, v) {
    return this.filter(c, 'gt', v);
  }
  gte(c, v) {
    return this.filter(c, 'gte', v);
  }
  lt(c, v) {
    return this.filter(c, 'lt', v);
  }
  lte(c, v) {
    return this.filter(c, 'lte', v);
  }
  is(c, v) {
    return this.filter(c, 'is', v);
  }
  in(c, list) {
    this.tests.push((r) => list.map(String).includes(String(r[c])));
    return this;
  }
  not(c, op, v) {
    this.tests.push((r) => !OPS[op](r[c], v));
    return this;
  }
  // .or('created_at.gte."2026-01-01T00:00:00Z",paid_at.gte."..."')
  or(text) {
    const parts = [...String(text).matchAll(/([a-z_]+)\.(eq|neq|gt|gte|lt|lte|is)\.(?:"([^"]*)"|([^,]*))/g)];
    this.tests.push((r) => parts.some((m) => OPS[m[2]](r[m[1]], m[3] !== undefined ? m[3] : m[4])));
    return this;
  }
  order(col, opts = {}) {
    this.sorts.push([col, opts.ascending !== false]);
    return this;
  }
  limit(n) {
    this.to = this.from + n - 1;
    return this;
  }
  range(a, b) {
    this.from = a;
    this.to = b;
    return this;
  }
  maybeSingle() {
    this.single = 'maybe';
    return this;
  }
  then(ok, bad) {
    return this.run().then(ok, bad);
  }
  async run() {
    await wait(70);
    try {
      return this.kind === 'select' ? this.read() : this.write();
    } catch (e) {
      return { data: null, error: { message: e.message } };
    }
  }
  read() {
    let rows = visible(this.table).filter((r) => this.tests.every((t) => t(r)));
    for (const [col, asc] of [...this.sorts].reverse())
      rows = [...rows].sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]));
    rows = rows.slice(this.from, this.to == null ? undefined : this.to + 1).map(clone);
    if (this.table === 'products' && /product_options\s*\(/.test(this.sel))
      rows.forEach(
        (r) => (r.product_options = clone(S.product_options.filter((o) => o.product_id === r.id))),
      );
    if (/order_items\s*\(/.test(this.sel))
      rows.forEach((r) => (r.order_items = clone(S.order_items.filter((i) => i.order_id === r.id))));
    if (this.table === 'payments' && /orders\s*\(/.test(this.sel))
      rows.forEach((r) => (r.orders = clone(S.orders.find((o) => o.id === r.order_id) || null)));
    if (this.single) return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  }
  write() {
    const u = uid();
    const t = this.table;
    if (this.kind === 'insert') {
      const v = Array.isArray(this.values) ? this.values[0] : this.values;
      if (t === 'products') {
        const s = myShop();
        if (!s || v.shop_id !== s.id) fail('new row violates row-level security policy');
        S.products.push({
          id: uuid(),
          active: true,
          hidden_by_admin: false,
          hidden_reason: '',
          low_at: 2,
          stock: 0,
          created_at: nowIso(),
          ...v,
        });
      } else if (t === 'shops') {
        if (v.owner_id !== u) fail('new row violates row-level security policy');
        if (hasShop(u)) fail('You already have a shop.');
        if (hasShopped(u)) fail('This email is a customer account. Use another email for your shop.');
        if (RESERVED.includes(v.slug) || S.shops.some((s) => s.slug === v.slug))
          fail('duplicate key value violates unique constraint "shops_slug_key"');
        S.shops.push({
          id: uuid(),
          bank: 'OPay',
          account_number: '',
          account_name: '',
          whatsapp: '',
          allow_part_payment: false,
          delivery_paid_by: 'customer',
          sells: '',
          location: '',
          social: '',
          status: 'pending',
          reviewed_at: null,
          review_note: '',
          details_changed_at: null,
          paid_until: null,
          accepted_rules_at: nowIso(),
          created_at: nowIso(),
          last_active_at: nowIso(),
          ...v,
        });
      } else if (t === 'money_out') {
        const s = myShop();
        if (!s || v.shop_id !== s.id) fail('new row violates row-level security policy');
        if (!(v.amount > 0))
          fail('new row for relation "money_out" violates check constraint "money_out_amount_check"');
        S.money_out.push({
          id: Math.max(0, ...S.money_out.map((m) => m.id)) + 1,
          kind: 'other',
          note: '',
          spent_on: nowIso().slice(0, 10),
          created_at: nowIso(),
          ...v,
        });
      } else if (t === 'customers') {
        if (v.user_id !== u) fail('new row violates row-level security policy');
        if (hasShop(u)) fail(SHOP_EMAIL);
        if (S.customers.some((c) => c.user_id === u))
          fail('duplicate key value violates unique constraint "customers_pkey"');
        S.customers.push({ name: '', phone: '', address: '', updated_at: nowIso(), ...v });
      } else fail('Not allowed.');
      save();
      return { data: null, error: null };
    }
    const rows = visible(t).filter((r) => this.tests.every((x) => x(r)));
    if (this.kind === 'update') {
      if (
        t === 'shops' &&
        this.values.slug &&
        S.shops.some((s) => s.slug === this.values.slug && !rows.includes(s))
      )
        fail('duplicate key value violates unique constraint "shops_slug_key"');
      if (t === 'shops' && RESERVED.includes(this.values.slug))
        fail('new row for relation "shops" violates check constraint "shops_slug_reserved"');
      const allowed = { shops: true, products: true, customers: true };
      if (!allowed[t]) fail('Not allowed.');
      rows.forEach((r) =>
        Object.assign(r, this.values, t === 'shops' ? { status: r.status, owner_id: r.owner_id } : {}),
      );
    } else if (this.kind === 'delete') {
      if (t === 'money_out') S.money_out = S.money_out.filter((m) => !rows.includes(m));
      else if (t === 'customers') S.customers = S.customers.filter((c) => !rows.includes(c));
      else fail('Not allowed.');
    }
    save();
    return { data: null, error: null };
  }
}

// ---------- photos ----------
function readAsDataUrl(blob) {
  return new Promise((ok) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => ok('');
    r.readAsDataURL(blob);
  });
}
const storage = {
  from: () => ({
    upload: async (path, blob) => {
      S.photos[path] = await readAsDataUrl(blob);
      save();
      return { data: { path }, error: null };
    },
    getPublicUrl: (path) => ({
      data: {
        publicUrl: String(path).startsWith('demo/')
          ? PHOTOS[String(path).slice(5)] || ''
          : S.photos[path] || '',
      },
    }),
    // like the real app: a photo a product or a past order still uses is kept
    remove: async (paths) => {
      (paths || [])
        .filter(
          (p) =>
            !S.products.some((x) => x.photo_path === p) && !S.order_items.some((i) => i.photo_path === p),
        )
        .forEach((p) => delete S.photos[p]);
      save();
      return { data: [], error: null };
    },
    // order photos are private in the real app; here the "link" is the photo itself
    createSignedUrls: async (paths) => ({
      data: (paths || []).map((p) => ({
        path: p,
        signedUrl: S.photos[p] || null,
        error: S.photos[p] ? null : 'not found',
      })),
      error: null,
    }),
  }),
};

// ---------- sign-in: no email is sent; any 6 digits work ----------
const auth = {
  getSession: async () => ({ data: { session: session() }, error: null }),
  onAuthStateChange(cb) {
    authListeners.add(cb);
    setTimeout(() => cb('INITIAL_SESSION', session()), 0);
    return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
  },
  signInWithOtp: async ({ email }) => {
    await wait(300);
    demo.setHint(`No email is sent in the demo. Type any 6 digits to sign in as ${email}.`);
    return { data: {}, error: null };
  },
  verifyOtp: async ({ email, token }) => {
    await wait(300);
    if (!/^\d{6}$/.test(String(token || '')))
      return { data: null, error: { message: 'Token has expired or is invalid' } };
    const em = String(email).toLowerCase();
    let u = S.users.find((x) => x.email === em);
    if (!u) {
      // a new account always gets a new id (uuid() repeats itself after a reload, since the sample data is seeded)
      let id = uuid();
      while (S.users.some((x) => x.id === id) || S.shops.some((x) => x.owner_id === id))
        id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : uuid();
      u = { id, email: em };
      S.users.push(u);
    }
    demo.setHint('');
    signInAs(u);
    return { data: { session: session() }, error: null };
  },
  signOut: async () => {
    signInAs(null);
    return { error: null };
  },
};

// Live updates and the push function, as far as a demo needs them.
const channel = (name) => {
  const ch = {
    name,
    binds: [],
    on(type, f, cb) {
      if (type === 'postgres_changes') ch.binds.push({ table: f.table, filter: f.filter, cb });
      return ch;
    },
    subscribe() {
      channels.add(ch);
      return ch;
    },
  };
  return ch;
};
// The money server function, in the demo: each action runs one of the demo database functions above.
const MONEY = {
  quote: (b) => ['save_courier_quotes', { p_order: b.order }],
  pick: (b) => ['set_courier', { p_order: b.order, p_courier: b.courier_id, p_service: b.service_code }],
  book: (b) => ['hand_to_courier', { p_order: b.order }],
  track: (b) => ['set_courier_progress', { p_order: b.order, p_token: b.token }],
  pay: (b) => ['customer_pay_online', { p_token: b.token }],
  check: (b) => ['customer_paid_online', { p_ref: b.reference }],
};
const functions = {
  invoke: async (fn, { body } = {}) => {
    if (fn === 'money') {
      const m = MONEY[body && body.action];
      if (!m) return { data: { error: "This part of ShopDesk isn't in the demo." }, error: null };
      const { data, error } = await rpc(...m(body));
      return { data: error ? { error: error.message } : data, error: null };
    }
    return { data: body && body.action === 'key' ? { key: 'demo' } : { alerts: 0, sent: 0 }, error: null };
  },
};

export const supabase = {
  demo: true,
  auth,
  storage,
  functions,
  channel,
  removeChannel: (ch) => channels.delete(ch),
  from: (table) => new Query(table),
  rpc,
};
