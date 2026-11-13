// The shop's sales report: every number on the Sales tab, in the Full report and in the Excel file, worked out
// in one place so the three always agree.
//   loadReport()  reads the orders, payments and money out from the start of last year until now
//   buildReport() turns them into the report for one period
// "Sales" here means money that reached the shop for its goods (delivery fees left out: they're the rider's),
// counted when the money comes in. "Order value" is what orders were placed for, paid or not.
import { supabase } from '../lib/database.js';
import { DAY, startOfDay } from '../lib/dates.js';
import { owes, toPay } from '../lib/money.js';
import { options } from '../lib/products.js';
import { periodFor, salesStats, splitPayment, owedIncome, change } from './salesMath.js';

export const SOURCES = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  snapchat: 'Snapchat',
  x: 'X (Twitter)',
  direct: 'Direct or other',
};
export const OUT_KINDS = [
  ['restock', 'Restock'],
  ['packaging', 'Packaging'],
  ['transport', 'Transport'],
  ['data', 'Data and airtime'],
  ['rent', 'Rent and bills'],
  ['staff', 'Staff'],
  ['ads', 'Adverts'],
  ['shopdesk', 'ShopDesk plan'],
  ['other', 'Other'],
];
export const outKind = (k) => (OUT_KINDS.find(([x]) => x === k) || OUT_KINDS[OUT_KINDS.length - 1])[1];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DONE = ['paid', 'out', 'delivered'];

// Loads every page of a list (the database sends at most 1,000 rows at a time).
async function fetchAll(makeQuery) {
  const out = [];
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await makeQuery().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// Everything the report needs, from 1 January last year (so "This year" can be compared with last year).
export async function loadReport(now = Date.now()) {
  const since = new Date(new Date(now).getFullYear() - 1, 0, 1).toISOString();
  const [orders, payments, moneyOut] = await Promise.all([
    fetchAll(() =>
      supabase
        .from('orders')
        .select(
          'id, created_at, paid_at, out_at, done_at, status, mode, area, source, items_total, delivery_fee, delivery_paid_by, amount_paid, customer_id, customer_name, customer_phone, deliver_by, rider_name, order_items(name, price, was_price, qty)',
        )
        .or(`created_at.gte."${since}",paid_at.gte."${since}",done_at.gte."${since}"`)
        .order('id'),
    ),
    fetchAll(() =>
      supabase
        .from('payments')
        .select(
          'id, amount, created_at, method, order_id, orders(id, items_total, delivery_fee, delivery_paid_by, customer_name, source)',
        )
        .gte('created_at', since)
        .order('id'),
    ),
    fetchAll(() =>
      supabase
        .from('money_out')
        .select('*')
        .gte('spent_on', since.slice(0, 10))
        .order('spent_on', { ascending: true }),
    ).catch(() => []), // before the database update that adds money out, the report works without it
  ]);
  return { orders, payments, moneyOut, since: Date.parse(since), at: now };
}

// A period picked by the shop: one of the usual ones, or their own dates (from and to are 'YYYY-MM-DD').
export function reportPeriod(key, custom, now = Date.now()) {
  if (key !== 'custom' || !custom) return periodFor(key, now);
  const [fy, fm, fd] = custom.from.split('-').map(Number);
  const [ty, tm, td] = custom.to.split('-').map(Number);
  const start = +new Date(fy, fm - 1, fd);
  const finish = Math.min(+new Date(ty, tm - 1, td + 1), now);
  const end = finish === now ? now : finish - 1; // the last moment counted: the end of the last day, or now
  const days = Math.max(1, Math.round((+new Date(ty, tm - 1, td + 1) - start) / DAY));
  const slots = [];
  for (let i = 0; i < days; i++)
    slots.push([+new Date(fy, fm - 1, fd + i), +new Date(fy, fm - 1, fd + i + 1)]);
  // a whole calendar month (a monthly report) is compared with the whole month before it
  const fullMonth = fd === 1 && fy === ty && fm === tm && td === new Date(ty, tm, 0).getDate();
  if (fullMonth) {
    const prevDays = new Date(fy, fm - 1, 0).getDate();
    return {
      key: 'custom',
      fullMonth: true,
      start,
      end,
      finish,
      prevStart: +new Date(fy, fm - 2, 1),
      prevEnd: start - 1,
      compare: 'the month before',
      slots,
      prevSlots: slots.map((_, i) =>
        i < prevDays ? [+new Date(fy, fm - 2, 1 + i), +new Date(fy, fm - 2, 2 + i)] : [0, 0],
      ),
    };
  }
  const prevSlots = slots.map(([a, b]) => [a - days * DAY, b - days * DAY]);
  return {
    key: 'custom',
    start,
    end,
    finish,
    prevStart: start - days * DAY,
    prevEnd: start - 1,
    compare: `the ${days} days before`,
    slots,
    prevSlots,
  };
}

const within = (iso, a, b) => {
  if (!iso) return false;
  const t = +new Date(iso);
  return t >= a && t <= b;
};
const sum = (list, f) => list.reduce((a, x) => a + (f(x) || 0), 0);
export const customerKey = (o) =>
  o.customer_id || (o.customer_phone || '').replace(/\D/g, '') || o.customer_name;

// The shop's products as they are now, one line per product or per size: name, price, stock.
function stockLines(products) {
  const out = [];
  (products || []).forEach((p) => {
    const opts = options(p);
    if (opts.length)
      opts.forEach((o) =>
        out.push({
          name: `${p.name} · ${o.name}`,
          price: o.sale_price ?? o.price,
          stock: o.stock,
          active: p.active,
        }),
      );
    else out.push({ name: p.name, price: p.sale_price ?? p.price, stock: p.stock, active: p.active });
  });
  return out;
}

// "Friday 6pm–9pm": the 3-hour block of the week (12am–3am, 3am–6am, ...) when most orders come in
function bestTime(orders) {
  const grid = Array.from({ length: 7 }, () => Array(8).fill(0));
  orders.forEach((o) => {
    const t = new Date(o.created_at);
    grid[(t.getDay() + 6) % 7][Math.floor(t.getHours() / 3)] += 1;
  });
  let best = null;
  for (let d = 0; d < 7; d++)
    for (let b = 0; b < 8; b++)
      if (!best || grid[d][b] > best.n) best = { day: d, hour: b * 3, n: grid[d][b] };
  return best && best.n ? best : null;
}
export const hourWord = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 || h === 24 ? 'am' : 'pm');

export function buildReport({ shop, data: raw, products, openOrders, period, now = Date.now() }) {
  const { orders, payments, moneyOut } = raw;
  const { start, end, prevStart, prevEnd } = period;
  const s = salesStats({ orders, payments, openOrders, period });

  // ---------- money: order value = paid + still owed; delivery money and cancelled orders kept apart ----------
  const placed = orders.filter((o) => within(o.created_at, start, end));
  const live = placed.filter((o) => o.status !== 'cancelled');
  const cancelledOrders = placed.filter((o) => o.status === 'cancelled');
  const orderValue = sum(live, (o) => o.items_total);
  const owedOnThese = sum(live, (o) => owedIncome(o));
  const paidOnThese = orderValue - owedOnThese;
  const discounts = sum(
    orders.filter((o) => within(o.paid_at, start, end) && DONE.includes(o.status)),
    (o) =>
      sum(o.order_items || [], (i) =>
        i.was_price && i.was_price > i.price ? (i.was_price - i.price) * i.qty : 0,
      ),
  );
  const saleItems = sum(
    orders.filter((o) => within(o.paid_at, start, end) && DONE.includes(o.status)),
    (o) => sum(o.order_items || [], (i) => (i.was_price && i.was_price > i.price ? i.qty : 0)),
  );

  // ---------- money out ----------
  const outIn = (a, b) =>
    moneyOut.filter((m) => {
      const t = +new Date(m.spent_on + 'T00:00:00');
      return t >= startOfDay(a) && t <= b;
    });
  const outNow = outIn(start, end);
  const spent = sum(outNow, (m) => m.amount);
  const spentBefore = sum(outIn(prevStart, prevEnd), (m) => m.amount);
  const outByKind = {};
  outNow.forEach((m) => (outByKind[m.kind] = (outByKind[m.kind] || 0) + m.amount));

  // ---------- this month's goal: how far, at this pace, and what's needed a day ----------
  const n = new Date(now);
  const monthStart = +new Date(n.getFullYear(), n.getMonth(), 1);
  const P = payments.map((p) => ({ ...p, ...splitPayment(p.amount, p.orders) }));
  const monthIncome = sum(
    P.filter((p) => within(p.created_at, monthStart, now)),
    (p) => p.income,
  );
  // counted in whole days (today counts), the same way the Excel file works it out
  const dayOfMonth = n.getDate();
  const daysInMonth = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - dayOfMonth + 1;
  const goalAmount = shop.monthly_goal || 0;
  const goal = {
    amount: goalAmount,
    month: new Date(now).toLocaleDateString('en-NG', { month: 'long' }),
    soFar: monthIncome,
    share: goalAmount ? Math.min(1, monthIncome / goalAmount) : 0,
    pace: dayOfMonth >= 3 ? Math.round((monthIncome / dayOfMonth) * daysInMonth) : null,
    perDayNeeded: goalAmount > monthIncome ? Math.ceil((goalAmount - monthIncome) / daysLeft / 100) * 100 : 0,
    daysLeft,
  };

  // ---------- products: what sold, how it's moving, stock and when it runs out ----------
  const paidIn = (a, b) => orders.filter((o) => within(o.paid_at, a, b) && DONE.includes(o.status));
  const soldBy = (list) => {
    const m = {};
    list.forEach((o) =>
      (o.order_items || []).forEach((i) => {
        const x = (m[i.name] = m[i.name] || { qty: 0, sales: 0 });
        x.qty += i.qty;
        x.sales += i.qty * i.price;
      }),
    );
    return m;
  };
  const nowSold = soldBy(paidIn(start, end));
  const beforeSold = soldBy(paidIn(prevStart, prevEnd));
  const lastMonth = soldBy(paidIn(now - 28 * DAY, now));
  const stock = stockLines(products);
  const names = new Set([...Object.keys(nowSold), ...stock.filter((x) => x.active).map((x) => x.name)]);
  const totalSold = sum(Object.values(nowSold), (x) => x.sales);
  const productRows = [...names]
    .map((name) => {
      const st = stock.find((x) => x.name === name);
      const a = nowSold[name] || { qty: 0, sales: 0 };
      const b = beforeSold[name] || { qty: 0, sales: 0 };
      const perWeek = (lastMonth[name] || { qty: 0 }).qty / 4 || 0;
      const runsOut = st && st.stock > 0 && perWeek > 0 ? Math.round((st.stock / perWeek) * 7) : null;
      return {
        name,
        qty: a.qty,
        sales: a.sales,
        share: totalSold ? a.sales / totalSold : 0,
        qtyBefore: b.qty,
        trend: change(a.qty, b.qty),
        stock: st ? st.stock : null,
        stockValue: st ? st.stock * st.price : null,
        perWeek: Math.round(perWeek * 10) / 10,
        runsOut,
      };
    })
    .sort((x, y) => y.sales - x.sales || y.qty - x.qty || x.name.localeCompare(y.name));
  const shelfValue = sum(stock, (x) => (x.active ? x.stock * x.price : 0));
  const deadStock = productRows.filter((p) => p.stock > 0 && !(lastMonth[p.name] || { qty: 0 }).qty);

  // ---------- customers: everyone in the report, what they spent in total and in this period ----------
  const byCustomer = {};
  orders
    .filter((o) => o.status !== 'cancelled')
    .forEach((o) => {
      const k = customerKey(o);
      const c = (byCustomer[k] = byCustomer[k] || {
        key: k,
        name: o.customer_name,
        phone: o.customer_phone,
        area: '',
        first: o.created_at,
        last: o.created_at,
        orders: 0,
        paidOrders: 0,
        spent: 0,
        periodOrders: 0,
        periodSpent: 0,
      });
      c.name = o.customer_name || c.name;
      if (o.customer_id) c.customerId = o.customer_id;
      c.phone = o.customer_phone || c.phone;
      if (o.area) c.area = o.area;
      if (o.created_at < c.first) c.first = o.created_at;
      if (o.created_at > c.last) c.last = o.created_at;
      c.orders += 1;
      if (DONE.includes(o.status)) {
        c.paidOrders += 1;
        c.spent += o.items_total;
      }
      if (within(o.created_at, start, end)) {
        c.periodOrders += 1;
        if (DONE.includes(o.status)) c.periodSpent += o.items_total;
      }
    });
  const customers = Object.values(byCustomer).map((c) => ({
    ...c,
    regular: c.paidOrders >= 3,
    isNew: within(c.first, start, end),
  }));
  customers.sort((a, b) => b.periodSpent - a.periodSpent || b.spent - a.spent);
  const inPeriod = customers.filter((c) => c.periodOrders > 0);
  const newCustomers = inPeriod.filter((c) => c.isNew).length;
  const periodSpendAll = sum(inPeriod, (c) => c.periodSpent);
  const returningSpend = sum(
    inPeriod.filter((c) => !c.isNew),
    (c) => c.periodSpent,
  );
  const top10 = sum(inPeriod.slice(0, 10), (c) => c.periodSpent);

  // ---------- who owes, oldest first, grouped by age ----------
  const owed = openOrders
    .filter((o) => owes(o) > 0)
    .map((o) => {
      const days = Math.floor((now - Date.parse(o.created_at)) / DAY);
      return {
        id: o.id,
        name: o.customer_name,
        phone: o.customer_phone,
        created_at: o.created_at,
        total: toPay(o),
        paid: o.amount_paid,
        owes: owes(o),
        days,
        age: days <= 7 ? '0–7 days' : days <= 30 ? '8–30 days' : 'Over 30 days',
        says: !!o.customer_says_paid,
      };
    })
    .sort((a, b) => b.days - a.days);
  const ageTotals = ['0–7 days', '8–30 days', 'Over 30 days'].map((age) => ({
    age,
    count: owed.filter((x) => x.age === age).length,
    amount: sum(
      owed.filter((x) => x.age === age),
      (x) => x.owes,
    ),
  }));

  // ---------- where orders came from, and where they went ----------
  const paidNow = paidIn(start, end);
  const group = (list, keyOf, valueOf) => {
    const m = {};
    list.forEach((o) => {
      const k = keyOf(o);
      if (!k) return;
      const x = (m[k] = m[k] || { name: k, orders: 0, sales: 0 });
      x.orders += 1;
      x.sales += valueOf(o);
    });
    return Object.values(m).sort((a, b) => b.sales - a.sales || b.orders - a.orders);
  };
  const sources = group(
    paidNow,
    (o) => SOURCES[o.source || 'direct'] || SOURCES.direct,
    (o) => o.items_total,
  );
  const areas = group(
    paidNow.filter((o) => o.mode === 'delivery'),
    (o) => o.area || 'Not given',
    (o) => o.items_total,
  );
  const riders = group(
    orders.filter((o) => o.mode === 'delivery' && o.rider_name && within(o.out_at, start, end)),
    (o) => o.rider_name,
    (o) => (o.delivery_paid_by === 'customer' ? o.delivery_fee || 0 : 0),
  ).map((r) => ({ name: r.name, deliveries: r.orders, deliveryMoney: r.sales }));

  // ---------- when people order: day of the week × hour ----------
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  live.forEach((o) => {
    const t = new Date(o.created_at);
    heat[(t.getDay() + 6) % 7][t.getHours()] += 1;
  });

  // ---------- every day of the period, and every month in the report: money in, money out, left ----------
  const dayKey = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const days = [];
  for (let t = startOfDay(start); t < Math.min(period.finish, now + 1); t = startOfDay(t + DAY * 1.5))
    days.push(dayKey(t));
  const dayIn = {},
    dayOrders = {},
    dayDelivery = {},
    dayOut = {};
  P.forEach((p) => {
    const k = dayKey(p.created_at);
    dayIn[k] = (dayIn[k] || 0) + p.income;
    dayDelivery[k] = (dayDelivery[k] || 0) + p.delivery;
  });
  live.forEach((o) => (dayOrders[dayKey(o.created_at)] = (dayOrders[dayKey(o.created_at)] || 0) + 1));
  moneyOut.forEach((m) => (dayOut[m.spent_on] = (dayOut[m.spent_on] || 0) + m.amount));
  let balance = 0;
  const cashBook = days.map((k) => {
    const inn = dayIn[k] || 0,
      out = dayOut[k] || 0;
    balance += inn - out;
    return {
      day: k,
      orders: dayOrders[k] || 0,
      moneyIn: inn,
      delivery: dayDelivery[k] || 0,
      moneyOut: out,
      left: inn - out,
      balance,
    };
  });
  const months = [];
  {
    // from the first month with an order (no empty months before the shop began)
    const firstOrder = orders.reduce((a, o) => Math.min(a, Date.parse(o.created_at)), Infinity);
    const first = new Date(Math.max(raw.since, Number.isFinite(firstOrder) ? firstOrder : now));
    for (let y = first.getFullYear(), m = first.getMonth(); +new Date(y, m, 1) <= now; m++) {
      const a = +new Date(y, m, 1),
        b = +new Date(y, m + 1, 1) - 1;
      const inn = sum(
        P.filter((p) => within(p.created_at, a, b)),
        (p) => p.income,
      );
      const out = sum(outIn(a, b), (x) => x.amount);
      months.push({
        month: new Date(a).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' }),
        start: a,
        orders: orders.filter((o) => o.status !== 'cancelled' && within(o.created_at, a, b)).length,
        moneyIn: inn,
        delivery: sum(
          P.filter((p) => within(p.created_at, a, b)),
          (p) => p.delivery,
        ),
        moneyOut: out,
        left: inn - out,
      });
    }
  }

  // ---------- records (in everything the report holds) ----------
  const allDays = Object.entries(dayIn).sort((a, b) => b[1] - a[1]);
  const bestMonth = [...months].sort((a, b) => b.moneyIn - a.moneyIn)[0];
  const records = {
    since:
      shop.created_at && Date.parse(shop.created_at) >= raw.since
        ? 'ever'
        : 'since ' + new Date(raw.since).getFullYear(),
    bestDay: allDays.length ? { day: allDays[0][0], amount: allDays[0][1] } : null,
    bestMonth: bestMonth && bestMonth.moneyIn ? bestMonth : null,
  };

  // ---------- "Do this today": a few things that make money, each one tap away ----------
  const actions = [];
  const owedTotal = sum(owed, (x) => x.owes);
  // orders not paid yet: nobody owes anything (payment is in full, up front); these just wait, then cancel after 48 hours
  if (owed.length)
    actions.push({
      kind: 'unpaid',
      title: `${owed.length} ${owed.length === 1 ? 'order is' : 'orders are'} waiting for payment`,
      text: 'Unpaid orders cancel after 48 hours, and the items go back on sale.',
      button: 'See them',
    });
  const running = productRows
    .filter((p) => p.runsOut != null && p.runsOut <= 10)
    .sort((a, b) => a.runsOut - b.runsOut);
  if (running.length)
    actions.push({
      kind: 'stock',
      title: `${running[0].name} runs out in ${running[0].runsOut <= 1 ? 'a day' : running[0].runsOut + ' days'}`,
      text: `It sells about ${Math.max(1, Math.round(running[0].perWeek))} a week and ${running[0].stock} ${running[0].stock === 1 ? 'is' : 'are'} left.${running.length > 1 ? ` ${running.length - 1} more running low.` : ''}`,
      button: 'Restock',
    });
  const quiet = customers
    .filter((c) => c.regular && now - Date.parse(c.last) > 30 * DAY && now - Date.parse(c.last) < 180 * DAY)
    .sort((a, b) => b.spent - a.spent);
  if (quiet.length)
    actions.push({
      kind: 'quiet',
      title: `${quiet.length} ${quiet.length === 1 ? 'regular hasn’t' : 'regulars haven’t'} ordered in a month`,
      text: `${quiet
        .slice(0, 2)
        .map((c) => c.name)
        .join(' and ')}${quiet.length > 2 ? ' and others' : ''}. A quick hello brings them back.`,
      button: 'Message',
      list: quiet.slice(0, 10),
    });
  const bt = bestTime(
    orders.filter((o) => o.status !== 'cancelled' && within(o.created_at, now - 56 * DAY, now)),
  );
  if (bt)
    actions.push({
      kind: 'post',
      title: `Post your Status on ${WEEKDAYS[bt.day]}, ${hourWord(bt.hour)}–${hourWord(bt.hour + 3)}`,
      text: 'That’s when most of your orders came in the last 8 weeks.',
      button: null,
    });

  return {
    raw,
    s,
    period,
    money: {
      sales: s.income,
      salesBefore: s.prevIncome,
      orderValue,
      paidOnThese,
      owedOnThese,
      cancelledValue: sum(cancelledOrders, (o) => o.items_total),
      cancelled: cancelledOrders.length,
      delivery: s.delivery,
      discounts,
      saleItems,
      spent,
      spentBefore,
      left: s.income - spent,
      leftBefore: s.prevIncome - spentBefore,
      // the shop notes its own spending (not just the ShopDesk plan, which is added for it): show money out and left
      hasOut: moneyOut.some((x) => x.kind !== 'shopdesk'),
      outByKind: OUT_KINDS.map(([k, label]) => ({ kind: k, label, amount: outByKind[k] || 0 })).filter(
        (x) => x.amount,
      ),
      owedNow: owedTotal,
      waiting: owed.length,
      waitingValue: owedTotal,
    },
    goal,
    products: productRows,
    shelfValue,
    deadStock,
    customers,
    customerFacts: {
      count: inPeriod.length,
      newCount: newCustomers,
      returningShare: periodSpendAll ? Math.round((returningSpend / periodSpendAll) * 100) : 0,
      top10Share: periodSpendAll ? Math.round((top10 / periodSpendAll) * 100) : 0,
      regulars: customers.filter((c) => c.regular).length,
    },
    owed,
    ageTotals,
    sources,
    areas,
    riders,
    heat,
    cashBook,
    months,
    records,
    actions,
    moneyOut: outNow.slice().reverse(),
    orders: placed,
    paidOrders: paidNow,
  };
}
