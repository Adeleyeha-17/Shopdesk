// The numbers behind the vendor's Sales tab. ("Income" in this file means sales: money that reached the vendor
// for their goods.)
// Income is money that reached the vendor's account for the items they sold. Delivery fees are left out:
// when the customer pays delivery, that part of each payment goes to the rider, so it isn't the vendor's income.
import { DAY, startOfDay } from '../lib/dates.js';
import { owes } from '../lib/money.js';

export const PERIODS = [
  ['today', 'Today'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['month', 'This month'],
  ['year', 'This year'],
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// The chart's slots for a period that starts at `start`: hours for Today, days for 7/30 days and a month,
// months for a year. Each slot is [from, to] in milliseconds.
function slotsFrom(key, start) {
  const s = new Date(start);
  const y = s.getFullYear(),
    m = s.getMonth(),
    d = s.getDate();
  const out = [];
  if (key === 'today')
    for (let h = 0; h < 24; h++) out.push([new Date(y, m, d, h), new Date(y, m, d, h + 1)]);
  if (key === '7d' || key === '30d') {
    const n = key === '7d' ? 7 : 30;
    for (let i = 0; i < n; i++) out.push([new Date(y, m, d + i), new Date(y, m, d + i + 1)]);
  }
  if (key === 'month') {
    const n = new Date(y, m + 1, 0).getDate();
    for (let i = 0; i < n; i++) out.push([new Date(y, m, 1 + i), new Date(y, m, 2 + i)]);
  }
  if (key === 'year') for (let i = 0; i < 12; i++) out.push([new Date(y, i, 1), new Date(y, i + 1, 1)]);
  return out.map(([a, b]) => [+a, +b]);
}

// The chosen period, the same stretch of time just before it (for "vs ..."), and the chart's slots.
export function periodFor(key, now = Date.now()) {
  const n = new Date(now);
  const y = n.getFullYear(),
    m = n.getMonth(),
    d = n.getDate();
  const t0 = startOfDay(now);
  let start, prevStart, prevEnd, compare;
  if (key === 'today') {
    start = t0;
    prevStart = +new Date(y, m, d - 1);
    prevEnd = now - DAY;
    compare = 'yesterday by this time';
  } else if (key === '7d' || key === '30d') {
    const days = key === '7d' ? 7 : 30;
    start = +new Date(y, m, d - days + 1);
    prevStart = +new Date(y, m, d - 2 * days + 1);
    prevEnd = start;
    compare = `the ${days} days before`;
  } else if (key === 'month') {
    start = +new Date(y, m, 1);
    prevStart = +new Date(y, m - 1, 1);
    const sameTimeLastMonth = new Date(y, m - 1, d, n.getHours(), n.getMinutes());
    prevEnd = Math.min(+sameTimeLastMonth, start); // a short last month ends at its last day
    compare = 'last month by this date';
  } else {
    start = +new Date(y, 0, 1);
    prevStart = +new Date(y - 1, 0, 1);
    prevEnd = +new Date(y - 1, m, d, n.getHours(), n.getMinutes());
    compare = 'last year by this date';
  }
  // where the period finishes: end of today, the month or the year (7 and 30 days end now)
  const finish =
    key === 'today'
      ? +new Date(y, m, d + 1)
      : key === 'month'
        ? +new Date(y, m + 1, 1)
        : key === 'year'
          ? +new Date(y + 1, 0, 1)
          : now;
  return {
    key,
    start,
    end: now,
    finish,
    prevStart,
    prevEnd,
    compare,
    slots: slotsFrom(key, start),
    prevSlots: slotsFrom(key, prevStart),
  };
}

// Short label under a chart slot, and the longer one shown when it's tapped.
export function slotLabel(key, from, i, count) {
  const t = new Date(from);
  if (key === 'today') {
    const h = t.getHours();
    return h % 6 === 0 ? (h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? h + 'am' : h - 12 + 'pm') : '';
  }
  if (key === '7d') return i === count - 1 ? 'Today' : WEEKDAYS[(t.getDay() + 6) % 7];
  if (key === 'year') return MONTHS[t.getMonth()];
  const day = t.getDate();
  return key === 'month'
    ? day === 1 || day % 7 === 1
      ? String(day)
      : ''
    : i % 5 === 0 || i === count - 1
      ? String(day)
      : '';
}
export function slotTitle(key, from) {
  const t = new Date(from);
  if (key === 'today') {
    const h = t.getHours();
    const f = (x) => (x % 12 === 0 ? 12 : x % 12) + (x < 12 || x === 24 ? 'am' : 'pm');
    return `${f(h)} to ${f(h + 1)}`;
  }
  if (key === 'year') return t.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
  return t.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
}

// What the customer has to pay for an order in total, and how much of that is the rider's delivery fee.
function riderFee(o) {
  return o && o.delivery_paid_by === 'customer' ? o.delivery_fee || 0 : 0;
}

// Splits one payment into the vendor's income and the rider's delivery money, in proportion to the order.
export function splitPayment(amount, order) {
  const fee = riderFee(order);
  if (!order || !fee) return { income: amount, delivery: 0 };
  const income = Math.round((amount * order.items_total) / (order.items_total + fee));
  return { income, delivery: amount - income };
}

// The income part of what a customer still owes (without the rider's fee).
export function owedIncome(o) {
  const due = owes(o);
  const fee = riderFee(o);
  return fee ? Math.round((due * o.items_total) / (o.items_total + fee)) : due;
}

const within = (iso, a, b) => {
  if (!iso) return false;
  const t = +new Date(iso);
  return t >= a && t <= b;
};
const customerKey = (o) => o.customer_id || (o.customer_phone || '').replace(/\D/g, '') || o.customer_name;
const median = (list) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// The change from the period before, as a whole percent. null when there's nothing to compare with.
export function change(now, before) {
  if (!before) return now ? null : 0;
  return Math.round(((now - before) / before) * 100);
}

// Every number on the Sales tab for one period.
//   orders:   orders created, paid or finished since the previous period started (with their order_items)
//   payments: payments since the previous period started (each with its order: items_total, delivery fee, who pays it)
//   openOrders: the vendor's current orders, for "owed to you now"
export function salesStats({ orders, payments, openOrders, period }) {
  const { key, start, end, finish, prevStart, prevEnd, slots, prevSlots } = period;
  const P = payments.map((p) => ({ ...p, ...splitPayment(p.amount, p.orders) }));
  const curPay = P.filter((p) => within(p.created_at, start, end));
  const prevPay = P.filter((p) => within(p.created_at, prevStart, prevEnd));
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

  const placed = (a, b) => orders.filter((o) => within(o.created_at, a, b) && o.status !== 'cancelled');
  const paid = (a, b) =>
    orders.filter((o) => within(o.paid_at, a, b) && ['paid', 'out', 'delivered'].includes(o.status));
  const cur = { placed: placed(start, end), paid: paid(start, end) };
  const prev = { placed: placed(prevStart, prevEnd), paid: paid(prevStart, prevEnd) };
  const avg = (list) => (list.length ? Math.round(sum(list, (o) => o.items_total) / list.length) : 0);
  const itemsSold = (list) => sum(list, (o) => sum(o.order_items || [], (i) => i.qty));
  const people = (list) => new Set(list.map(customerKey)).size;

  // income per chart slot, now and in the period before
  const bySlot = (list, ss) =>
    ss.map(([a, b]) =>
      sum(
        list.filter((p) => {
          const t = +new Date(p.created_at);
          return t >= a && t < b;
        }),
        (p) => p.income,
      ),
    );
  const slotIncome = bySlot(curPay, slots).map((v, i) => (slots[i][0] > end ? null : v)); // future slots stay empty
  const prevSlotIncome = bySlot(prevPay, prevSlots);

  // best sellers: what the items of fully paid orders sold for
  const sold = {};
  cur.paid.forEach((o) =>
    (o.order_items || []).forEach((i) => {
      const s = (sold[i.name] = sold[i.name] || { name: i.name, qty: 0, income: 0 });
      s.qty += i.qty;
      s.income += i.qty * i.price;
    }),
  );
  const allSold = Object.values(sold).sort((a, b) => b.income - a.income || b.qty - a.qty);
  const best = allSold.slice(0, 5);

  // when customers order: by day of the week (Mon first) and by hour
  const weekdays = Array(7).fill(0),
    hours = Array(24).fill(0);
  cur.placed.forEach((o) => {
    const t = new Date(o.created_at);
    weekdays[(t.getDay() + 6) % 7] += 1;
    hours[t.getHours()] += 1;
  });
  let busiestHour = -1,
    busiestHourCount = 0;
  for (let h = 0; h < 24; h++) {
    const n = hours[h] + hours[(h + 1) % 24] + hours[(h + 2) % 24];
    if (n > busiestHourCount) {
      busiestHourCount = n;
      busiestHour = h;
    }
  }
  const topDay = weekdays.indexOf(Math.max(...weekdays));

  // customers: who spent most, and who ordered more than once
  const spend = {};
  cur.placed.forEach((o) => {
    const k = customerKey(o);
    const c = (spend[k] = spend[k] || { name: o.customer_name, orders: 0, spent: 0 });
    c.orders += 1;
    if (['paid', 'out', 'delivered'].includes(o.status)) c.spent += o.items_total;
  });
  const customers = Object.values(spend);
  const returners = customers.filter((c) => c.orders > 1);
  const totalSpent = sum(customers, (c) => c.spent);
  const returningSpent = sum(returners, (c) => c.spent);
  const topCustomers = customers
    .filter((c) => c.spent > 0)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 3);

  // deliveries: kept on time, and how long customers take to pay
  const delivered = orders.filter(
    (o) => o.status === 'delivered' && o.deliver_by && within(o.done_at, start, end),
  );
  const onTime = delivered.filter((o) => +new Date(o.done_at) <= +new Date(o.deliver_by) + 5 * 60e3).length;
  const payWait = median(
    cur.paid
      .filter((o) => o.paid_at && o.created_at)
      .map((o) => +new Date(o.paid_at) - +new Date(o.created_at)),
  );

  const cancelled = orders.filter((o) => o.status === 'cancelled' && within(o.created_at, start, end));
  const owing = openOrders.filter((o) => owes(o) > 0);
  const filled = slotIncome.map((v, i) => [v || 0, i]).filter(([v]) => v > 0);
  const bestSlot = filled.length ? filled.reduce((a, b) => (b[0] > a[0] ? b : a)) : null;
  const biggest = cur.paid.reduce((a, o) => (!a || o.items_total > a.items_total ? o : a), null);

  const income = sum(curPay, (p) => p.income);

  // income a day on average, and where this month or year is heading at this pace
  const daysSoFar = Math.max(1, (end - start) / DAY);
  const perDay = key === 'today' ? null : Math.round(income / Math.ceil(daysSoFar - 1e-9));
  const enoughToGuess = (key === 'month' && daysSoFar >= 3) || (key === 'year' && daysSoFar >= 14);
  const onTrack =
    enoughToGuess && income > 0 ? Math.round((income / (end - start)) * (finish - start)) : null;

  // of the orders placed in the period (not cancelled), how many have been paid in full
  const paidOfPlaced = cur.placed.filter((o) => ['paid', 'out', 'delivered'].includes(o.status)).length;

  // running total of income through the period, now and before
  const running = (list) => {
    let total = 0;
    return list.map((v) => (v == null ? null : (total += v)));
  };

  return {
    income,
    perDay,
    onTrack,
    paidOfPlaced,
    runningIncome: running(slotIncome),
    prevRunningIncome: running(prevSlotIncome),
    returningSpent,
    returningShare: totalSpent ? Math.round((returningSpent / totalSpent) * 100) : 0,
    prevIncome: sum(prevPay, (p) => p.income),
    delivery: sum(curPay, (p) => p.delivery),
    payments: curPay,
    orders: cur.placed.length,
    prevOrders: prev.placed.length,
    paidOrders: cur.paid,
    avgOrder: avg(cur.paid),
    prevAvgOrder: avg(prev.paid),
    itemsSold: itemsSold(cur.paid),
    prevItemsSold: itemsSold(prev.paid),
    customers: people(cur.placed),
    prevCustomers: people(prev.placed),
    returning: returners.length,
    topCustomers,
    slotIncome,
    prevSlotIncome,
    bestSlot: bestSlot && { index: bestSlot[1], income: bestSlot[0] },
    biggest,
    best,
    allSold,
    periodOrders: orders.filter((o) => within(o.created_at, start, end)), // every order placed, cancelled ones too
    weekdays,
    hours,
    busiest: busiestHourCount ? { day: WEEKDAYS[topDay], fromHour: busiestHour } : null,
    deliveries: cur.placed.filter((o) => o.mode === 'delivery').length,
    pickups: cur.placed.filter((o) => o.mode === 'pickup').length,
    delivered: delivered.length,
    onTime,
    payWait,
    cancelled: cancelled.length,
    cancelledValue: sum(cancelled, (o) => o.items_total),
    owed: sum(owing, owedIncome),
    owingCount: owing.length,
  };
}

// "about 2 hours", "about 25 minutes", "about 3 days"
export function waitText(ms) {
  const min = Math.max(1, Math.round(ms / 60e3));
  if (min < 60) return `about ${min} minute${min === 1 ? '' : 's'}`;
  const h = Math.round(min / 60);
  if (h < 48) return `about ${h} hour${h === 1 ? '' : 's'}`;
  return `about ${Math.round(h / 24)} days`;
}

// "6pm to 9pm"
export function hourRange(h) {
  const f = (x) => {
    x = ((x % 24) + 24) % 24;
    return (x % 12 === 0 ? 12 : x % 12) + (x < 12 ? 'am' : 'pm');
  };
  return `${f(h)} to ${f(h + 3)}`;
}

// ₦1.2m, ₦45k, ₦2.5k, ₦900: short money for chart labels
export function shortNaira(v) {
  if (v >= 1e6) return '₦' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'm';
  if (v >= 1e3) return '₦' + (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return '₦' + Math.round(v);
}

// The top of a chart: the highest value rounded up to a clean number (6,500 -> 8,000), so the labels are round.
export function niceTop(v) {
  if (v <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(v));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((f) => f * step).find((x) => x >= v);
}
