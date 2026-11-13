// The Sales tab: how the shop is doing, where the money stands, and what to do today.
// Pick a period (Today, 7 days, 30 days, This month, This year, or your own dates) and everything follows it.
// Top to bottom: this month's goal, sales and how they compare, where the money stands (order value = paid + owed,
// money out, what's left), "Do this today", the sales chart, what's selling, where orders come from, when people
// order, customers and records. "Full report" opens the same numbers as tables; "Download for Excel" saves them.
// Every number comes from report.js, so the screen, the Full report and the Excel file always agree.
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira, toInt } from '../lib/money.js';
import { dayOf, timeOf } from '../lib/dates.js';
import { copyText, errText, orderCode } from '../lib/helpers.js';
import { lowStock } from '../lib/products.js';
import { useBusy } from '../lib/busy.js';
import { PERIODS, slotLabel, slotTitle, change, owedIncome } from './salesMath.js';
import { loadReport, reportPeriod, buildReport, hourWord } from './report.js';
import { IncomeChart, RunningChart, RankList } from './charts.jsx';
import { FullReport } from './FullReport.jsx';
import { MoneyOutSheet } from './MoneyOutSheet.jsx';
import { downloadSalesReport } from './salesExcel.js';
import { Skeleton } from '../shared/Skeleton.jsx';

const SAVED = 'shopdesk-sales-period';
const PER = { today: 'hour', '7d': 'day', '30d': 'day', month: 'day', year: 'month', custom: 'day' };
const NOW_NAME = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  month: 'This month',
  year: 'This year',
  custom: 'Your dates',
};
const BEFORE_NAME = {
  today: 'Yesterday',
  '7d': 'The 7 days before',
  '30d': 'The 30 days before',
  month: 'Last month',
  year: 'Last year',
  custom: 'The days before',
};
const startOfToday = () => {
  const d = new Date();
  return +new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
const ymd = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// "▲ 18%" in green, "▼ 12%" in red; a very big jump reads "▲ 13×"
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

// How many people looked at the shop today and this week.
function Visitors() {
  const [v, setV] = useState(null);
  useEffect(() => {
    supabase.rpc('my_visits').then(({ data, error }) => !error && setV(data || null));
  }, []);
  if (!v) return null;
  return (
    <div className="visits">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      <span>
        <strong>{v.today}</strong> {v.today === 1 ? 'person' : 'people'} visited your shop today
        <span className="sub"> · {v.week} this week</span>
      </span>
    </div>
  );
}

export function SalesTab({ shop, data, say, setTab, setFocus, reloadShop, month, setMonth }) {
  const [key, setKey] = useState(() => {
    try {
      return localStorage.getItem(SAVED) || '7d';
    } catch (e) {
      return '7d';
    }
  });
  const [custom, setCustom] = useState(() => ({ from: ymd(Date.now() - 13 * 864e5), to: ymd(Date.now()) }));
  const [raw, setRaw] = useState(null);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState(null);
  const [view, setView] = useState('each');
  const [full, setFull] = useState(null); // the Full report's open sheet, or null
  const [adding, setAdding] = useState(false);
  const [reloads, setReloads] = useState(0);
  useBusy(!raw && !err);

  // Reload when an order or payment changes (the app checks every minute and on every live alert).
  const changes =
    data.orders.map((o) => `${o.id}:${o.status}:${o.amount_paid}`).join(',') + '|' + data.payments.length;
  useEffect(() => {
    let alive = true;
    loadReport().then(
      (d) => alive && (setRaw(d), setErr('')),
      (e) => alive && setErr(errText(e)),
    );
    return () => {
      alive = false;
    };
  }, [changes, reloads]);

  function choose(k) {
    setKey(k);
    setPicked(null);
    try {
      localStorage.setItem(SAVED, k);
    } catch (e) {
      /* private browsing */
    }
  }
  // one month's report ('2026-10'): its dates, then the Full report (from Monthly reports, or the month-end alert)
  function openMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0);
    if (+last >= startOfToday())
      setKey('month'); // this month: "This month", compared with last month by this date
    else {
      setCustom({ from: `${ym}-01`, to: ymd(+last) });
      setKey('custom');
    }
    setPicked(null);
    setFull('summary');
  }
  useEffect(() => {
    if (!month) return;
    openMonth(month);
    setMonth(null);
  }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  const period = useMemo(() => reportPeriod(key, custom), [key, custom, raw]);
  const r = useMemo(
    () =>
      raw ? buildReport({ shop, data: raw, products: data.products, openOrders: data.orders, period }) : null,
    [raw, shop, data.products, data.orders, period],
  );

  async function saveGoal(amount) {
    const { error } = await supabase.from('shops').update({ monthly_goal: amount }).eq('id', shop.id);
    if (error) say(errText(error));
    else {
      say(amount ? `Goal set: ${naira(amount)} a month` : 'Goal removed');
      reloadShop();
    }
  }

  return (
    <>
      <Visitors key={reloads} />
      <div className="filters wrap" role="group" aria-label="Period">
        {[...PERIODS, ['custom', 'Pick dates']].map(([k, l]) => (
          <button key={k} className="filter" aria-pressed={key === k} onClick={() => choose(k)}>
            {l}
          </button>
        ))}
      </div>
      {key === 'custom' && (
        <div className="dates">
          <label className="field">
            From
            <input
              type="date"
              value={custom.from}
              max={custom.to}
              onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })}
            />
          </label>
          <label className="field">
            To
            <input
              type="date"
              value={custom.to}
              min={custom.from}
              max={ymd(Date.now())}
              onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })}
            />
          </label>
        </div>
      )}
      {err && <p className="err">{err}</p>}
      {!r ? (
        <Skeleton kind="sales" />
      ) : (
        <SalesView
          shop={shop}
          data={data}
          r={r}
          picked={picked}
          setPicked={setPicked}
          view={view}
          setView={setView}
          say={say}
          setTab={setTab}
          openFull={setFull}
          openMonth={openMonth}
          addOut={() => setAdding(true)}
          saveGoal={saveGoal}
        />
      )}
      {full && r && (
        <FullReport
          r={r}
          shop={shop}
          sheet={full}
          setSheet={setFull}
          onClose={() => setFull(null)}
          addOut={() => setAdding(true)}
          say={say}
          reload={() => setReloads((x) => x + 1)}
          download={() => downloadSalesReport(r, shop, say)}
          openOrder={(id) => {
            setFull(null);
            setFocus({ id, at: Date.now() });
            setTab('orders');
          }}
        />
      )}
      {adding && (
        <MoneyOutSheet
          shop={shop}
          onClose={() => setAdding(false)}
          onSaved={(m) => {
            setAdding(false);
            say(`${naira(m.amount)} money out added`);
            setReloads((x) => x + 1);
          }}
        />
      )}
    </>
  );
}

// This month's goal: a ring that fills up, what's in so far, where the month is heading, and what's needed a day.
function GoalCard({ goal, saveGoal }) {
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const C = 2 * Math.PI * 34;
  const pct = Math.round(goal.share * 100);
  if (editing || !goal.amount)
    return (
      <section className="card dash-card goal">
        <div>
          <h2>Your goal for {goal.month}</h2>
          <p className="note">
            How much do you want to sell this month? ShopDesk tracks it and tells you what's needed each day.
          </p>
        </div>
        <div className="goal-set">
          <input
            inputMode="numeric"
            aria-label="Monthly goal in naira"
            placeholder={goal.amount ? naira(goal.amount) : '₦500,000'}
            value={typed}
            onChange={(e) => setTyped(e.target.value.replace(/[^\d,₦]/g, ''))}
          />
          <button
            className="btn small"
            onClick={() => {
              const n = toInt(typed);
              if (n) saveGoal(n);
              setEditing(false);
              setTyped('');
            }}
          >
            Set goal
          </button>
          {editing && (
            <button className="linkbtn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
        </div>
      </section>
    );
  return (
    <section className="card dash-card goal">
      <div className="goal-row">
        <button
          className="ring"
          onClick={() => setEditing(true)}
          aria-label={`Goal ${naira(goal.amount)}, ${pct}% done. Change goal`}
        >
          <svg viewBox="0 0 80 80" aria-hidden="true">
            <circle cx="40" cy="40" r="34" className="ring-track" />
            <circle cx="40" cy="40" r="34" className="ring-fill" strokeDasharray={`${C * goal.share} ${C}`} />
          </svg>
          <span>{pct}%</span>
        </button>
        <div className="goal-text">
          <div className="label">
            {goal.month} goal · <strong>{naira(goal.amount)}</strong>
          </div>
          <div className="mid">{naira(goal.soFar)} in</div>
          {goal.pace != null && (
            <div className="sub">
              At this pace:{' '}
              <strong className={goal.pace >= goal.amount ? 'good' : ''}>{naira(goal.pace)}</strong>
            </div>
          )}
          <div className="sub">
            {goal.soFar >= goal.amount
              ? 'Goal reached. Well done!'
              : goal.perDayNeeded
                ? `${naira(goal.perDayNeeded)} a day for ${goal.daysLeft} more day${goal.daysLeft === 1 ? '' : 's'} reaches it`
                : ''}
          </div>
        </div>
      </div>
      <button className="linkbtn small-link" onClick={() => setEditing(true)}>
        Change goal
      </button>
    </section>
  );
}

// Where the money stands, as a short statement: what orders were placed for, how much of that is in and how much
// is still owed; money in for the period. Money out and what's left only show once the shop has noted some spending
// itself (until then it's one quiet "Track what you spend" link), so a half-empty "left" never looks like profit.
function MoneyCard({ r, openFull, addOut }) {
  const m = r.money;
  return (
    <section className="card dash-card">
      <div className="row">
        <h2>Where the money stands</h2>
      </div>
      <div className="stmt">
        <div className="stmt-row strong">
          <span>Orders placed</span>
          <span className="num">{naira(m.orderValue)}</span>
        </div>
        <div className="stmt-row indent">
          <span>
            <i className="dot-in" /> Paid
          </span>
          <span className="num">{naira(m.paidOnThese)}</span>
        </div>
        <button className="stmt-row indent tap" onClick={() => openFull('owed')}>
          <span>
            <i className="dot-owed" /> Still owed
          </span>
          <span className="num">{naira(m.owedOnThese)} ›</span>
        </button>
        <div className="split" aria-hidden="true">
          {m.orderValue ? (
            <>
              <i className="part-in" style={{ flexGrow: m.paidOnThese }} />
              {m.owedOnThese > 0 && <i className="part-owed" style={{ flexGrow: m.owedOnThese }} />}
            </>
          ) : (
            <i className="part-empty" style={{ flexGrow: 1 }} />
          )}
        </div>
        <div className="stmt-gap" />
        <div className={'stmt-row' + (m.hasOut ? '' : ' total')}>
          <span>Money in (your sales)</span>
          <span className="num">{naira(m.sales)}</span>
        </div>
        {m.hasOut && (
          <>
            <button className="stmt-row tap" onClick={() => openFull('out')}>
              <span>Money out</span>
              <span className="num">− {naira(m.spent)} ›</span>
            </button>
            <div className="stmt-row total">
              <span>Left</span>
              <span className={'num' + (m.left < 0 ? ' neg' : '')}>{naira(m.left)}</span>
            </div>
          </>
        )}
        <div className="stmt-notes">
          {m.delivery > 0 && <span>Delivery money for riders {naira(m.delivery)} (not yours)</span>}
          {m.discounts > 0 && (
            <span>
              Discounts given {naira(m.discounts)} on {m.saleItems} sale item{m.saleItems === 1 ? '' : 's'}
            </span>
          )}
          {m.cancelled > 0 && (
            <span>
              Cancelled {naira(m.cancelledValue)} · {m.cancelled} order{m.cancelled === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
      {m.hasOut ? (
        <button className="btn small ghost add-out" onClick={addOut}>
          + Add money out
        </button>
      ) : (
        <button className="linkbtn small-link track-out" onClick={addOut}>
          Track what you spend, to see what&apos;s left ›
        </button>
      )}
    </section>
  );
}

const ACTION_ICON = {
  owed: 'M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2 2.6 5 3.2 5 1.4 5 3.3-2.2 3.3-5 3.3-5-1.2-5-3.3',
  stock: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  quiet: 'M4 6h16v10H8l-4 4zM8 10h8M8 13h5',
  post: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
};
function Actions({ actions, onAct }) {
  if (!actions.length) return null;
  return (
    <section className="card dash-card">
      <h2>Do this today</h2>
      <div className="acts">
        {actions.map((a) => (
          <div key={a.kind} className={'act act-' + a.kind}>
            <span className="act-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d={ACTION_ICON[a.kind]} />
              </svg>
            </span>
            <div className="act-text">
              <strong>{a.title}</strong>
              <span>{a.text}</span>
            </div>
            {a.button && (
              <button className="btn small" onClick={() => onAct(a)}>
                {a.button}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// When people order: each day of the week in 3-hour blocks, darker where more orders came in.
function HeatCard({ heat, periodName }) {
  const blocks = heat.map((row) =>
    Array.from({ length: 8 }, (_, b) => row[b * 3] + row[b * 3 + 1] + row[b * 3 + 2]),
  );
  const max = Math.max(1, ...blocks.flat());
  let best = null;
  blocks.forEach((row, d) => row.forEach((v, b) => (!best || v > best.v) && (best = { d, b, v })));
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <section className="card dash-card">
      <h2>When people order</h2>
      {best && best.v > 0 ? (
        <p className="note">
          Busiest {periodName}: <strong>{DAYS[best.d]}</strong>,{' '}
          <strong>
            {hourWord(best.b * 3)}–{hourWord(best.b * 3 + 3)}
          </strong>
          . Post your link just before.
        </p>
      ) : (
        <p className="note">No orders in this period yet.</p>
      )}
      <div className="heat" role="img" aria-label="Orders by day of the week and time of day">
        <span />
        {['12a', '3a', '6a', '9a', '12p', '3p', '6p', '9p'].map((h) => (
          <span key={h} className="heat-h">
            {h}
          </span>
        ))}
        {blocks.map((row, d) => (
          <React.Fragment key={d}>
            <span className="heat-d">{DAYS[d]}</span>
            {row.map((v, b) => (
              <i
                key={b}
                title={`${DAYS[d]} ${hourWord(b * 3)}–${hourWord(b * 3 + 3)}: ${v} order${v === 1 ? '' : 's'}`}
                style={{ '--h': v / max }}
                className={v ? '' : 'none'}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

// Horizontal bars for where orders came from, or where they went
function ShareBars({ items, total }) {
  return (
    <div className="shares">
      {items.map((x) => (
        <div key={x.name} className="share">
          <div className="row">
            <span>
              {x.name}{' '}
              <span className="sub">
                · {x.orders} order{x.orders === 1 ? '' : 's'}
              </span>
            </span>
            <strong className="num">{naira(x.sales)}</strong>
          </div>
          <div className="rank-track">
            <i style={{ width: `${Math.max(3, total ? (x.sales / total) * 100 : 0)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SalesView({
  shop,
  data,
  r,
  picked,
  setPicked,
  view,
  setView,
  say,
  setTab,
  openFull,
  openMonth,
  addOut,
  saveGoal,
}) {
  const { s, period } = r;
  const { key, slots, compare } = period;
  const labels = slots.map(([a], i) =>
    key === 'custom' ? slotLabel('30d', a, i, slots.length) : slotLabel(key, a, i, slots.length),
  );
  const titles = slots.map(([a]) => slotTitle(key === 'custom' ? '30d' : key, a));
  const lastFilled = s.slotIncome.reduce((last, v, i) => (v != null ? i : last), 0);
  const lastWithIncome = s.slotIncome.reduce((last, v, i) => (v > 0 ? i : last), -1);
  const sel = picked == null ? (lastWithIncome >= 0 ? lastWithIncome : lastFilled) : picked;
  const periodName = key === 'custom' ? 'your dates' : PERIODS.find(([k]) => k === key)[1].toLowerCase();
  const sourcesTotal = r.sources.reduce((a, x) => a + x.sales, 0);
  const areasTotal = r.areas.reduce((a, x) => a + x.sales, 0);

  function act(a) {
    if (a.kind === 'owed') openFull('owed');
    if (a.kind === 'stock') setTab('stock');
    if (a.kind === 'quiet') openFull('quiet');
  }

  // A short message about today, to copy into WhatsApp or notes.
  function todayMessage() {
    const owing = data.orders.filter((o) => owedIncome(o) > 0);
    const low = lowStock(data.products);
    const t = r.cashBook.length ? r.cashBook[r.cashBook.length - 1] : null;
    return (
      `${shop.name} today.\nSales so far: ${naira(t ? t.moneyIn : 0)} from ${t ? t.orders : 0} order${t && t.orders === 1 ? '' : 's'}.\n` +
      `Owed to you: ${naira(r.money.owedNow)}${owing.length ? ' (' + owing.map((o) => o.customer_name).join(', ') + ')' : ''}.\n` +
      (low.length
        ? 'Running low: ' + low.map((x) => `${x.name} (${x.stock} left)`).join(', ') + '.'
        : 'Stock is fine.')
    );
  }

  return (
    <>
      <GoalCard goal={r.goal} saveGoal={saveGoal} />

      <section className="card dash-hero">
        <div className="label">Sales · {periodName}</div>
        <div className="huge">{naira(s.income)}</div>
        <Change now={s.income} before={s.prevIncome} compare={compare} />
        {s.perDay != null && (
          <div className="hero-extra">
            <span>
              <strong>{naira(s.perDay)}</strong> a day on average
            </span>
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

      <MoneyCard r={r} openFull={openFull} addOut={addOut} />

      <Actions actions={r.actions} onAct={act} />

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
      </section>

      <section className="card dash-card">
        <div className="row">
          <h2>Best sellers</h2>
          <button className="linkbtn small-link" onClick={() => openFull('products')}>
            All products ›
          </button>
        </div>
        {r.products.some((p) => p.sales > 0) ? (
          <div className="rank">
            {r.products
              .filter((p) => p.sales > 0)
              .slice(0, 5)
              .map((p) => (
                <div key={p.name} className="rank-item">
                  <div className="row">
                    <span>
                      {p.name}
                      <span className="sub"> · {p.qty} sold</span>
                      {p.trend !== null && p.trend !== 0 && (
                        <span className={'trend ' + (p.trend > 0 ? 'up' : 'down')}>
                          {p.trend > 0 ? '▲' : '▼'} {Math.min(999, Math.abs(p.trend))}%
                        </span>
                      )}
                    </span>
                    <strong className="num">{naira(p.sales)}</strong>
                  </div>
                  <div className="rank-track">
                    <i style={{ width: `${Math.max(3, p.share * 100 * 2.2)}%` }} />
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <p className="note">Nothing sold in this period yet.</p>
        )}
        <div className="facts">
          <div className="fact">
            <div className="label">Stock on your shelves</div>
            <div className="mid">{naira(r.shelfValue)}</div>
            <div className="sub">at your selling prices</div>
          </div>
          <div className="fact">
            <div className="label">Not sold in 4 weeks</div>
            <div className="mid">{r.deadStock.length}</div>
            <div className="sub">
              {r.deadStock.length
                ? r.deadStock
                    .slice(0, 2)
                    .map((p) => p.name)
                    .join(', ')
                : 'everything is moving'}
            </div>
          </div>
        </div>
      </section>

      <section className="card dash-card">
        <div className="row">
          <h2>Where orders come from</h2>
          <button className="linkbtn small-link" onClick={() => openFull('sources')}>
            More ›
          </button>
        </div>
        {r.sources.length ? (
          <ShareBars items={r.sources} total={sourcesTotal} />
        ) : (
          <p className="note">No paid orders in this period yet.</p>
        )}
        {r.areas.length > 0 && (
          <>
            <div className="label">Where you deliver</div>
            <ShareBars items={r.areas.slice(0, 5)} total={areasTotal} />
          </>
        )}
      </section>

      <HeatCard heat={r.heat} periodName={periodName} />

      <section className="card dash-card">
        <div className="row">
          <h2>Your customers</h2>
          <button className="linkbtn small-link" onClick={() => openFull('customers')}>
            All customers ›
          </button>
        </div>
        <div className="facts">
          <div className="fact">
            <div className="label">Ordered</div>
            <div className="mid">{r.customerFacts.count}</div>
            <div className="sub">{r.customerFacts.newCount} new</div>
          </div>
          <div className="fact">
            <div className="label">From returning customers</div>
            <div className="mid">{r.customerFacts.returningShare}%</div>
            <div className="sub">of your sales</div>
          </div>
          <div className="fact">
            <div className="label">Your top 10 bring</div>
            <div className="mid">{r.customerFacts.top10Share}%</div>
            <div className="sub">of your sales</div>
          </div>
          <div className="fact">
            <div className="label">Regulars</div>
            <div className="mid">{r.customerFacts.regulars}</div>
            <div className="sub">3 or more orders</div>
          </div>
        </div>
        {r.customers.some((c) => c.periodSpent > 0) && (
          <>
            <div className="label">Top customers</div>
            <RankList
              items={r.customers
                .filter((c) => c.periodSpent > 0)
                .slice(0, 3)
                .map((c) => ({
                  name: c.name,
                  sub: `${c.periodOrders} order${c.periodOrders === 1 ? '' : 's'}${c.regular ? ' · regular' : ''}`,
                  value: c.periodSpent,
                }))}
            />
          </>
        )}
      </section>

      <section className="card dash-card">
        <div>
          <h2>Monthly reports</h2>
          <p className="note">
            Every month ends with a report in ShopDesk. Tap one to open it, or download it for Excel.
          </p>
        </div>
        <ul className="months">
          {r.months
            .slice()
            .reverse()
            .slice(0, 12)
            .map((x, i) => {
              const d = new Date(x.start);
              const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              return (
                <li key={ym}>
                  <button className="month-row" onClick={() => openMonth(ym)}>
                    <span className="month-name">
                      <strong>{d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })}</strong>
                      <span className="sub">
                        {i === 0 ? 'So far · ' : ''}
                        {x.orders} order{x.orders === 1 ? '' : 's'}
                        {r.money.hasOut && x.moneyOut ? ` · ${naira(x.left)} left` : ''}
                      </span>
                    </span>
                    <span className="num">{naira(x.moneyIn)}</span>
                    <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </li>
              );
            })}
        </ul>
      </section>

      {(r.records.bestDay || r.records.bestMonth) && (
        <section className="card dash-card">
          <h2>Your records</h2>
          <div className="facts">
            {r.records.bestDay && (
              <div className="fact">
                <div className="label">Best day {r.records.since}</div>
                <div className="mid">{naira(r.records.bestDay.amount)}</div>
                <div className="sub">{dayOf(r.records.bestDay.day + 'T12:00:00')}</div>
              </div>
            )}
            {r.records.bestMonth && (
              <div className="fact">
                <div className="label">Best month {r.records.since}</div>
                <div className="mid">{naira(r.records.bestMonth.moneyIn)}</div>
                <div className="sub">{r.records.bestMonth.month}</div>
              </div>
            )}
            {s.biggest && (
              <div className="fact">
                <div className="label">Biggest order ({periodName})</div>
                <div className="mid">{naira(s.biggest.items_total)}</div>
                <div className="sub">
                  {s.biggest.customer_name} · {orderCode(shop, s.biggest)}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <div className="stack-sm">
        <button className="btn" onClick={() => openFull('summary')}>
          Full report
        </button>
        <div className="btns two">
          <button className="btn ghost" onClick={() => downloadSalesReport(r, shop, say)}>
            Download for Excel
          </button>
          <button
            className="btn ghost"
            onClick={() => copyText(todayMessage(), say, "Today's summary copied")}
          >
            Copy today's summary
          </button>
        </div>
      </div>
      <p className="note small">
        Sales count when you tap Money in. Updated {dayOf(new Date().toISOString())}{' '}
        {timeOf(new Date().toISOString())}.
      </p>
    </>
  );
}
