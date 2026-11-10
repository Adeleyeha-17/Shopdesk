// The Sales tab: how the shop's sales are doing.
// (In the code, "income" means sales: money that reached the vendor for their goods, without delivery fees.)
// Pick a period (Today, 7 days, 30 days, This month, This year) and everything follows it:
//   income (without delivery fees) and how it compares with the period before, orders, average order,
//   items sold, customers, a sales chart, where the money stands, best sellers, highlights,
//   when customers order, top customers, and a download for Excel.
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { dayOf, timeOf } from '../lib/dates.js';
import { copyText, errText, orderCode } from '../lib/helpers.js';
import { downloadExcel } from '../lib/excel.js';
import { lowStock } from '../lib/products.js';
import {
  PERIODS,
  periodFor,
  salesStats,
  change,
  slotLabel,
  slotTitle,
  waitText,
  hourRange,
  owedIncome,
} from './salesMath.js';
import { IncomeChart, RunningChart, CountBars, SplitBar, RankList } from './charts.jsx';

const SAVED = 'shopdesk-sales-period';
const PER = { today: 'hour', '7d': 'day', '30d': 'day', month: 'day', year: 'month' };
const UNTIL = { today: 'today', month: 'this month', year: 'this year' };
// names for the chart key: the period shown, and the one before it (the grey line)
const NOW_NAME = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  month: 'This month',
  year: 'This year',
};
const BEFORE_NAME = {
  today: 'Yesterday',
  '7d': 'The 7 days before',
  '30d': 'The 30 days before',
  month: 'Last month',
  year: 'Last year',
};

// Loads every page of a list (the database sends at most 1,000 rows at a time).
async function fetchAll(makeQuery) {
  const out = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await makeQuery().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// Orders and payments from the start of the previous period until now.
async function loadSince(since) {
  const iso = new Date(since).toISOString();
  const [orders, payments] = await Promise.all([
    fetchAll(() =>
      supabase
        .from('orders')
        .select(
          'id, created_at, paid_at, done_at, status, mode, items_total, delivery_fee, delivery_paid_by, amount_paid, customer_id, customer_name, customer_phone, deliver_by, order_items(name, price, qty)',
        )
        .or(`created_at.gte."${iso}",paid_at.gte."${iso}",done_at.gte."${iso}"`)
        .order('id'),
    ),
    fetchAll(() =>
      supabase
        .from('payments')
        .select(
          'id, amount, created_at, method, order_id, orders(id, items_total, delivery_fee, delivery_paid_by, customer_name)',
        )
        .gte('created_at', iso)
        .order('id'),
    ),
  ]);
  return { orders, payments };
}

// "▲ 18%" in green, "▼ 12%" in red, or "Same"
// "▲ 18%", "▼ 12%", or for a very big jump "▲ 131×" (easier to read than 13,078%)
function changeText(c, now, before) {
  if (c >= 1000) return `▲ ${Math.round(now / before)}×`;
  return `${c > 0 ? '▲' : '▼'} ${Math.abs(c)}%`;
}

function Change({ now, before, compare }) {
  const c = change(now, before);
  if (c === null) return <span className="delta up">New · nothing {compare}</span>;
  if (c === 0) return <span className="delta same">Same as {compare}</span>;
  return (
    <span className={'delta ' + (c > 0 ? 'up' : 'down')}>
      {changeText(c, now, before)} vs {compare}
    </span>
  );
}

function Tile({ label, value, now, before }) {
  const c = change(now, before);
  return (
    <div className="dash-tile">
      <div className="label">{label}</div>
      <div className="mid">{value}</div>
      {c !== null && c !== 0 && (
        <div className={'sub ' + (c > 0 ? 'up' : 'down')}>{changeText(c, now, before)}</div>
      )}
    </div>
  );
}

const STATUS_WORDS = {
  awaiting: 'Not paid',
  part: 'Part paid',
  paid: 'Paid',
  out: 'With rider / ready',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
const dateText = (iso) => {
  const t = new Date(iso);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const clockText = (iso) => {
  const t = new Date(iso);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
};

export function SalesTab({ shop, data, say }) {
  const [key, setKey] = useState(() => {
    try {
      return localStorage.getItem(SAVED) || '7d';
    } catch (e) {
      return '7d';
    }
  });
  const [loaded, setLoaded] = useState({ key: null, orders: [], payments: [], err: '' });
  const [picked, setPicked] = useState(null);
  const [view, setView] = useState('each'); // 'each' = income per hour/day/month, 'running' = running total

  // Reload when the period changes, or when an order or payment changes (the app checks every 20 seconds).
  const changes =
    data.orders.map((o) => `${o.id}:${o.status}:${o.amount_paid}`).join(',') + '|' + data.payments.length;
  useEffect(() => {
    let alive = true;
    loadSince(periodFor(key).prevStart).then(
      (d) => alive && setLoaded({ key, ...d, err: '' }),
      (e) => alive && setLoaded((l) => ({ ...l, err: errText(e) })),
    );
    return () => {
      alive = false;
    };
  }, [key, changes]);

  function choose(k) {
    setKey(k);
    setPicked(null);
    try {
      localStorage.setItem(SAVED, k);
    } catch (e) {
      /* private browsing */
    }
  }

  const period = useMemo(() => periodFor(key), [key, loaded]); // worked out again when new numbers arrive, so "now" stays current
  const s = useMemo(
    () => (loaded.key === key ? salesStats({ ...loaded, openOrders: data.orders, period }) : null),
    [loaded, key, data.orders, period],
  );

  return (
    <>
      <div className="filters wrap" role="group" aria-label="Period">
        {PERIODS.map(([k, l]) => (
          <button key={k} className="filter" aria-pressed={key === k} onClick={() => choose(k)}>
            {l}
          </button>
        ))}
      </div>
      {loaded.err && <p className="err">{loaded.err}</p>}
      {!s ? (
        <p className="note">Working out your numbers…</p>
      ) : (
        <SalesView
          shop={shop}
          data={data}
          s={s}
          period={period}
          picked={picked}
          setPicked={setPicked}
          view={view}
          setView={setView}
          say={say}
        />
      )}
    </>
  );
}

function SalesView({ shop, data, s, period, picked, setPicked, view, setView, say }) {
  const { key, slots, compare } = period;
  const labels = slots.map(([a], i) => slotLabel(key, a, i, slots.length));
  const titles = slots.map(([a]) => slotTitle(key, a));
  const lastFilled = s.slotIncome.reduce((last, v, i) => (v != null ? i : last), 0);
  const lastWithIncome = s.slotIncome.reduce((last, v, i) => (v > 0 ? i : last), -1);
  const sel = picked == null ? (lastWithIncome >= 0 ? lastWithIncome : lastFilled) : picked;
  const riders = shop.delivery_paid_by === 'customer' || s.delivery > 0;
  const periodName = PERIODS.find(([k]) => k === key)[1].toLowerCase();

  function excel() {
    const from = new Date(period.start).toLocaleDateString('en-NG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const to = new Date(period.end).toLocaleDateString('en-NG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const money = (v) => ({ value: v, money: true });
    const sheets = [
      {
        name: 'Summary',
        columns: [
          { header: shop.name, width: 34 },
          { header: `${from} to ${to}`, width: 22 },
        ],
        rows: [
          ['Sales (without delivery fees)', money(s.income)],
          [`Sales ${compare}`, money(s.prevIncome)],
          ['Orders', s.orders],
          ['Average order', money(s.avgOrder)],
          ['Items sold', s.itemsSold],
          ['Customers', s.customers],
          ['Customers who ordered more than once', s.returning],
          ...(riders ? [['Delivery money collected for riders', money(s.delivery)]] : []),
          ['Owed to you now (without delivery fees)', money(s.owed)],
          ['Cancelled orders', s.cancelled],
          ['Value of cancelled orders', money(s.cancelledValue)],
          ['Deliveries on time', s.delivered ? `${s.onTime} of ${s.delivered}` : 'none yet'],
        ],
      },
      {
        name: `Sales by ${PER[key]}`,
        columns: [
          { header: key === 'today' ? 'Hour' : key === 'year' ? 'Month' : 'Day', width: 22 },
          { header: 'Sales', width: 16, money: true },
          { header: `Same ${PER[key]}, period before`, width: 24, money: true },
        ],
        rows: slots.map(([a], i) => [
          slotTitle(key, a),
          s.slotIncome[i] == null ? '' : s.slotIncome[i],
          s.prevSlotIncome[i] || 0,
        ]),
      },
      {
        name: 'Orders',
        columns: [
          { header: 'Order', width: 9 },
          { header: 'Date', width: 12 },
          { header: 'Time', width: 8 },
          { header: 'Customer', width: 24 },
          { header: 'Phone', width: 16 },
          { header: 'Items', width: 40 },
          { header: 'Items total', width: 14, money: true },
          { header: 'Delivery fee', width: 13, money: true },
          { header: 'Delivery paid by', width: 16 },
          { header: 'Paid so far', width: 14, money: true },
          { header: 'Status', width: 18 },
          { header: 'Delivery or pick-up', width: 18 },
        ],
        rows: s.periodOrders.map((o) => [
          orderCode(shop, o),
          dateText(o.created_at),
          clockText(o.created_at),
          o.customer_name,
          o.customer_phone,
          (o.order_items || []).map((i) => `${i.qty} × ${i.name}`).join(', '),
          o.items_total,
          o.mode === 'delivery' && o.delivery_paid_by === 'customer' ? (o.delivery_fee ?? '') : '',
          o.mode === 'delivery'
            ? o.delivery_paid_by === 'customer'
              ? 'Customer'
              : 'You (free delivery)'
            : '',
          o.amount_paid,
          STATUS_WORDS[o.status] || o.status,
          o.mode === 'delivery' ? 'Delivery' : 'Pick-up',
        ]),
      },
      {
        name: 'Payments',
        columns: [
          { header: 'Date', width: 12 },
          { header: 'Time', width: 8 },
          { header: 'Order', width: 9 },
          { header: 'Customer', width: 24 },
          { header: 'Money received', width: 16, money: true },
          { header: 'Your sales', width: 14, money: true },
          { header: 'For the rider', width: 14, money: true },
          { header: 'Confirmed by', width: 18 },
        ],
        rows: s.payments.map((p) => [
          dateText(p.created_at),
          clockText(p.created_at),
          orderCode(shop, { id: p.order_id }),
          p.orders ? p.orders.customer_name : '',
          p.amount,
          p.income,
          p.delivery,
          p.method === 'tap' ? 'You' : 'Bank alert',
        ]),
      },
      {
        name: 'Products sold',
        columns: [
          { header: 'Product', width: 40 },
          { header: 'Quantity', width: 10 },
          { header: 'Sales', width: 16, money: true },
        ],
        rows: s.allSold.map((p) => [p.name, p.qty, p.income]),
      },
    ];
    downloadExcel(`shopdesk-${shop.slug}-${key}-${dateText(new Date().toISOString())}.xlsx`, sheets);
    say('Excel file downloaded');
  }

  // A short message about today, to copy into WhatsApp or notes.
  function todayMessage() {
    const t = salesStats({
      orders: data.orders,
      payments: data.payments.map((p) => ({ ...p, orders: data.orders.find((o) => o.id === p.order_id) })),
      openOrders: data.orders,
      period: periodFor('today'),
    });
    const owing = data.orders.filter((o) => owedIncome(o) > 0);
    const low = lowStock(data.products);
    return (
      `${shop.name} today.\nSales so far: ${naira(t.income)} from ${t.orders} order${t.orders === 1 ? '' : 's'}.\n` +
      `Owed to you: ${naira(t.owed)}${owing.length ? ' (' + owing.map((o) => o.customer_name).join(', ') + ')' : ''}.\n` +
      (low.length
        ? 'Running low: ' + low.map((x) => `${x.name} (${x.stock} left)`).join(', ') + '.'
        : 'Stock is fine.')
    );
  }

  return (
    <>
      <section className="card dash-hero">
        <div className="label">Sales · {periodName}</div>
        <div className="huge">{naira(s.income)}</div>
        <Change now={s.income} before={s.prevIncome} compare={compare} />
        {(s.perDay != null || s.onTrack != null) && (
          <div className="hero-extra">
            {s.perDay != null && (
              <span>
                <strong>{naira(s.perDay)}</strong> a day on average
              </span>
            )}
            {s.onTrack != null && (
              <span>
                On track for <strong>{naira(s.onTrack)}</strong> {UNTIL[key]}
              </span>
            )}
          </div>
        )}
        <div className="sub">Money in for what you sold, without delivery fees.</div>
      </section>

      <div className="dash-tiles">
        <Tile label="Orders" value={s.orders} now={s.orders} before={s.prevOrders} />
        <Tile label="Average order" value={naira(s.avgOrder)} now={s.avgOrder} before={s.prevAvgOrder} />
        <Tile label="Items sold" value={s.itemsSold} now={s.itemsSold} before={s.prevItemsSold} />
        <Tile label="Customers" value={s.customers} now={s.customers} before={s.prevCustomers} />
      </div>

      <section className="card dash-card">
        <div className="row chart-head">
          <h2>Sales</h2>
          <div className="seg" role="group" aria-label="Chart">
            <button aria-pressed={view === 'each'} onClick={() => setView('each')}>
              Each {PER[key]}
            </button>
            <button aria-pressed={view === 'running'} onClick={() => setView('running')}>
              Running total
            </button>
          </div>
        </div>
        <div className="readout">
          <span>{view === 'running' ? `By ${titles[sel]}` : titles[sel]}</span>
          <strong className="num">
            {(view === 'running' ? s.runningIncome : s.slotIncome)[sel] == null
              ? 'still to come'
              : naira((view === 'running' ? s.runningIncome : s.slotIncome)[sel])}
          </strong>
          {(view === 'running' ? s.prevRunningIncome : s.prevSlotIncome)[sel] > 0 && (
            <span className="sub">
              before: {naira((view === 'running' ? s.prevRunningIncome : s.prevSlotIncome)[sel])}
            </span>
          )}
        </div>
        {view === 'running' ? (
          <RunningChart
            values={s.runningIncome}
            previous={s.prevRunningIncome}
            labels={labels}
            titles={titles}
            selected={sel}
            onSelect={setPicked}
          />
        ) : (
          <IncomeChart
            values={s.slotIncome}
            previous={s.prevSlotIncome}
            labels={labels}
            titles={titles}
            selected={sel}
            onSelect={setPicked}
          />
        )}
        <div className="legend-key">
          <i className={view === 'running' ? 'key-now-line' : 'key-bar'} /> {NOW_NAME[key]}
          <i className="key-line" /> {BEFORE_NAME[key]}
        </div>
        <details className="numbers">
          <summary>See the numbers</summary>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>{key === 'today' ? 'Hour' : key === 'year' ? 'Month' : 'Day'}</th>
                  <th className="r">Sales</th>
                  <th className="r">Running total</th>
                  <th className="r">Before</th>
                </tr>
              </thead>
              <tbody>
                {slots.map(([a], i) =>
                  s.slotIncome[i] == null ? null : (
                    <tr key={a}>
                      <td>{titles[i]}</td>
                      <td className="r">{naira(s.slotIncome[i])}</td>
                      <td className="r">{naira(s.runningIncome[i])}</td>
                      <td className="r">{naira(s.prevSlotIncome[i] || 0)}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="card dash-card">
        <h2>Where your money is</h2>
        <SplitBar
          parts={[
            { key: 'in', label: 'Received', value: s.income },
            {
              key: 'owed',
              label: 'Owed to you now',
              value: s.owed,
              note: `${s.owingCount} order${s.owingCount === 1 ? '' : 's'}`,
            },
            ...(riders
              ? [{ key: 'rider', label: 'Delivery money for riders', value: s.delivery, note: 'not yours' }]
              : []),
            {
              key: 'cancelled',
              label: 'Cancelled',
              value: s.cancelledValue,
              note: `${s.cancelled} order${s.cancelled === 1 ? '' : 's'}`,
            },
          ]}
        />
      </section>

      <section className="card dash-card">
        <h2>Best sellers</h2>
        {s.best.length ? (
          <RankList items={s.best.map((b) => ({ name: b.name, sub: `${b.qty} sold`, value: b.income }))} />
        ) : (
          <p className="note">Nothing sold in this period yet.</p>
        )}
      </section>

      <section className="card dash-card">
        <h2>Highlights</h2>
        <div className="facts">
          <div className="fact">
            <div className="label">Best {PER[key]}</div>
            <div className="mid">{s.bestSlot ? naira(s.bestSlot.income) : '—'}</div>
            <div className="sub">{s.bestSlot ? titles[s.bestSlot.index] : 'No sales yet'}</div>
          </div>
          <div className="fact">
            <div className="label">Biggest order</div>
            <div className="mid">{s.biggest ? naira(s.biggest.items_total) : '—'}</div>
            <div className="sub">
              {s.biggest
                ? `${s.biggest.customer_name} · ${orderCode(shop, s.biggest)}`
                : 'No paid orders yet'}
            </div>
          </div>
          <div className="fact">
            <div className="label">Orders paid</div>
            <div className="mid">{s.orders ? `${s.paidOfPlaced} of ${s.orders}` : '—'}</div>
            <div className="sub">{s.orders ? 'of the orders placed' : 'No orders yet'}</div>
          </div>
          <div className="fact">
            <div className="label">Customers pay within</div>
            <div className="mid">{s.payWait == null ? '—' : waitText(s.payWait).replace('about ', '')}</div>
            <div className="sub">usually, after ordering</div>
          </div>
          <div className="fact">
            <div className="label">Delivered on time</div>
            <div className="mid">{s.delivered ? `${s.onTime} of ${s.delivered}` : '—'}</div>
            <div className="sub">{s.delivered ? 'by the time you promised' : 'No deliveries yet'}</div>
          </div>
        </div>
      </section>

      <section className="card dash-card">
        <h2>When customers order</h2>
        {s.busiest ? (
          <p className="note">
            Busiest on <strong>{s.busiest.day}</strong>, from <strong>{hourRange(s.busiest.fromHour)}</strong>
            . A good time to post your link.
          </p>
        ) : (
          <p className="note">No orders in this period yet.</p>
        )}
        <div className="label">By day of the week</div>
        <CountBars
          values={s.weekdays}
          labels={['M', 'T', 'W', 'T', 'F', 'S', 'S']}
          label="Orders by day of the week"
        />
        <div className="label">By time of day</div>
        <CountBars
          values={s.hours}
          labels={s.hours.map((_, h) =>
            h % 6 === 0 ? (h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? h + 'am' : h - 12 + 'pm') : '',
          )}
          label="Orders by hour of the day"
        />
      </section>

      <section className="card dash-card">
        <h2>Your customers</h2>
        <div className="facts">
          <div className="fact">
            <div className="label">Ordered</div>
            <div className="mid">{s.customers}</div>
          </div>
          <div className="fact">
            <div className="label">Came back</div>
            <div className="mid">{s.returning}</div>
            <div className="sub">
              {s.returning && s.returningSpent
                ? `brought ${naira(s.returningSpent)} · ${s.returningShare}% of sales`
                : 'ordered more than once'}
            </div>
          </div>
        </div>
        {s.deliveries + s.pickups > 0 && (
          <div className="mode-split">
            <div className="row">
              <span className="sub">Delivery {s.deliveries}</span>
              <span className="sub">Pick-up {s.pickups}</span>
            </div>
            <div
              className="split"
              aria-label={`${s.deliveries} delivery orders, ${s.pickups} pick-up orders`}
            >
              {s.deliveries > 0 && <i className="part-delivery" style={{ flexGrow: s.deliveries }} />}
              {s.pickups > 0 && <i className="part-pickup" style={{ flexGrow: s.pickups }} />}
            </div>
          </div>
        )}
        {s.topCustomers.length > 0 && (
          <>
            <div className="label">Top customers</div>
            <RankList
              items={s.topCustomers.map((c) => ({
                name: c.name,
                sub: `${c.orders} order${c.orders === 1 ? '' : 's'}`,
                value: c.spent,
              }))}
            />
          </>
        )}
      </section>

      <div className="btns">
        <button className="btn" onClick={excel}>
          Download for Excel
        </button>
        <button className="btn ghost" onClick={() => copyText(todayMessage(), say, "Today's summary copied")}>
          Copy today's summary
        </button>
      </div>
      <p className="note" style={{ fontSize: 12 }}>
        Sales count when you tap Money in. Updated {dayOf(new Date().toISOString())}{' '}
        {timeOf(new Date().toISOString())}.
      </p>
    </>
  );
}
