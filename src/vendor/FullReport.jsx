// The Full report: the Sales tab's numbers as tables, one sheet at a time, the same sheets as the Excel file.
// Every table sorts by tapping a column, has a search box when it's long, and a totals row that adds up what's
// showing (so a search gives the total for just those rows). Tapping an order opens it; customers and people who
// owe have a WhatsApp button.
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { orderCode, errText } from '../lib/helpers.js';
import { kick } from '../lib/alerts.js';
import { ComposeSheet } from './ComposeSheet.jsx';
import { SOURCES, outKind } from './report.js';

export const SHEETS = [
  ['summary', 'Summary'],
  ['daily', 'Daily'],
  ['monthly', 'Monthly'],
  ['orders', 'Orders'],
  ['products', 'Products'],
  ['customers', 'Customers'],
  ['owed', 'Owed'],
  ['out', 'Money out'],
  ['sources', 'Sources'],
  ['areas', 'Areas'],
  ['riders', 'Riders'],
];
const STATUS = {
  awaiting: 'Not paid',
  part: 'Part paid',
  paid: 'Paid',
  out: 'With rider',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
const dShort = (t) =>
  new Date(t).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: '2-digit' });
const pct = (x) => `${Math.round(x * 100)}%`;
const fmt = (t, v) =>
  v == null || v === ''
    ? '—'
    : t === 'money'
      ? naira(v)
      : t === 'pct'
        ? pct(v)
        : t === 'date'
          ? dShort(v)
          : t === 'int'
            ? Number(v).toLocaleString('en-NG')
            : v;

// A table that sorts, searches and totals what's showing.
//   cols: [{ k, label, t: 'money' | 'int' | 'pct' | 'date' | 'text', sum, render }]
function Table({ cols, rows, onRow, searchable, sortBy, empty = 'Nothing here for this period.' }) {
  const [sort, setSort] = useState(sortBy || null); // [key, 1 | -1]
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    let list = words
      ? rows.filter((r) =>
          cols.some(
            (c) =>
              (c.t === 'text' || !c.t) &&
              String(r[c.k] ?? '')
                .toLowerCase()
                .includes(words),
          ),
        )
      : rows;
    if (sort) {
      const [k, dir] = sort;
      list = [...list].sort((a, b) => {
        const x = a[k],
          y = b[k];
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
      });
    }
    return list;
  }, [rows, cols, sort, q]);
  const totals = cols.some((c) => c.sum);
  return (
    <>
      {searchable && rows.length > 8 && (
        <div className="search rt-search">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this sheet"
            aria-label="Search this sheet"
          />
        </div>
      )}
      {!rows.length ? (
        <p className="note">{empty}</p>
      ) : (
        <div className="rt-wrap">
          <table className="rt">
            <thead>
              <tr>
                {cols.map((c) => {
                  const on = sort && sort[0] === c.k;
                  return (
                    <th
                      key={c.k}
                      className={c.t && c.t !== 'text' ? 'r' : ''}
                      aria-sort={on ? (sort[1] > 0 ? 'ascending' : 'descending') : 'none'}
                    >
                      <button
                        onClick={() => setSort(on ? [c.k, -sort[1]] : [c.k, c.t && c.t !== 'text' ? -1 : 1])}
                      >
                        {c.label}
                        <span className="rt-arrow" aria-hidden="true">
                          {on ? (sort[1] > 0 ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr
                  key={r.id ?? r.key ?? r.name ?? i}
                  className={onRow ? 'click' : ''}
                  onClick={onRow ? () => onRow(r) : undefined}
                >
                  {cols.map((c) => (
                    <td
                      key={c.k}
                      className={(c.t && c.t !== 'text' ? 'r num' : '') + (c.cls ? ' ' + c.cls(r) : '')}
                    >
                      {c.render ? c.render(r) : fmt(c.t, r[c.k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  {cols.map((c, i) => (
                    <td key={c.k} className={c.t && c.t !== 'text' ? 'r num' : ''}>
                      {i === 0
                        ? `Total · ${shown.length}`
                        : c.sum
                          ? fmt(
                              c.t,
                              shown.reduce((a, r) => a + (Number(r[c.k]) || 0), 0),
                            )
                          : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </>
  );
}

// The small button on a row that writes to that customer inside ShopDesk
const sendButton = (label, onClick, disabled) => (
  <button
    className="send-btn"
    disabled={disabled}
    title={disabled ? 'This customer has no ShopDesk account' : undefined}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
  >
    {label}
  </button>
);

export function FullReport({ r, shop, sheet, setSheet, onClose, addOut, say, reload, download, openOrder }) {
  const m = r.money;
  const s = r.s;
  // Back (the phone's or the arrow) closes the report instead of leaving the shop's app
  useEffect(() => {
    const before = window.scrollY;
    window.scrollTo(0, 0);
    document.body.classList.add('report-open');
    return () => {
      document.body.classList.remove('report-open');
      window.scrollTo(0, before);
    };
  }, []);
  const periodText = `${dShort(r.period.start)} – ${dShort(r.period.key === 'custom' ? r.period.finish - 1 : r.period.end)}`;
  const first = (name) => String(name || '').split(' ')[0];
  const remindText = (o) =>
    `Hi ${first(o.name)}, a reminder that order ${orderCode(shop, o)} still has ${naira(o.owes)} to pay. ` +
    `Please send it to ${shop.bank} ${shop.account_number} (${shop.account_name}) and tap "I've sent the money". Thank you!`;
  const helloText = (c) =>
    `Hi ${first(c.name)}, we miss you at ${shop.name}! New stock just came in. Tap to have a look.`;
  // writing to a customer inside ShopDesk: a reminder goes in the order's chat; a message goes to their Shops tab
  const [compose, setCompose] = useState(null);
  const remind = (o) =>
    setCompose({
      title: 'Remind to pay',
      to: o.name,
      note: `in the chat on ${orderCode(shop, o)}`,
      text: remindText(o),
      send: async (body) => {
        const { error } = await supabase.rpc('send_message', { p_order: o.id, p_body: body });
        if (error) throw error;
        kick();
        say(`Reminder sent to ${first(o.name)} in ShopDesk`);
      },
    });
  const message = (c) =>
    setCompose({
      title: 'Message a customer',
      to: c.name,
      note: 'shows on your shop in their ShopDesk, with a phone alert',
      text: helloText(c),
      send: async (body) => {
        const { error } = await supabase.rpc('message_customer', { p_customer: c.customerId, p_body: body });
        if (error) throw error;
        kick();
        say(`Message sent to ${first(c.name)} in ShopDesk`);
      },
    });

  async function removeOut(x) {
    const { error } = await supabase.from('money_out').delete().eq('id', x.id);
    if (error) say(errText(error));
    else {
      say('Money out removed');
      reload();
    }
  }

  const summaryRows = [
    ['Sales (money in, without delivery fees)', s.income, s.prevIncome, 'money'],
    ['Orders', s.orders, s.prevOrders, 'int'],
    ['Average order', s.avgOrder, s.prevAvgOrder, 'money'],
    ['Items sold', s.itemsSold, s.prevItemsSold, 'int'],
    ['Customers', s.customers, s.prevCustomers, 'int'],
    ['Orders placed (value)', m.orderValue, null, 'money'],
    ['   Paid', m.paidOnThese, null, 'money'],
    ['   Still owed', m.owedOnThese, null, 'money'],
    ['Money out', m.spent, m.spentBefore, 'money'],
    ['Left (money in − money out)', m.left, m.leftBefore, 'money'],
    ['Delivery money for riders', m.delivery, null, 'money'],
    ['Discounts given', m.discounts, null, 'money'],
    ['Cancelled orders (value)', m.cancelledValue, null, 'money'],
  ].map(([label, now, before, t], i) => ({
    key: i,
    label,
    now,
    before,
    t,
    change: before ? (now - before) / before : null,
  }));

  const content = {
    summary: (
      <>
        <div className="rt-wrap">
          <table className="rt summary">
            <thead>
              <tr>
                <th>Measure</th>
                <th className="r">This period</th>
                <th className="r">Before</th>
                <th className="r">Change</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((x) => (
                <tr key={x.key} className={x.label.startsWith('   ') ? 'sub-row' : ''}>
                  <td>{x.label.trim()}</td>
                  <td className="r num">{fmt(x.t, x.now)}</td>
                  <td className="r num">{x.before == null ? '' : fmt(x.t, x.before)}</td>
                  <td className={'r num ' + (x.change > 0 ? 'up' : x.change < 0 ? 'down' : '')}>
                    {x.change == null
                      ? ''
                      : `${x.change > 0 ? '▲' : x.change < 0 ? '▼' : ''} ${Math.abs(Math.round(x.change * 100))}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.goal.amount > 0 && (
          <p className="note">
            {r.goal.month} goal {naira(r.goal.amount)}: {naira(r.goal.soFar)} in (
            {Math.round(r.goal.share * 100)}%)
            {r.goal.pace != null ? `, heading for ${naira(r.goal.pace)}` : ''}.
          </p>
        )}
      </>
    ),
    daily: (
      <Table
        cols={[
          { k: 'day', label: 'Date', t: 'date' },
          { k: 'orders', label: 'Orders', t: 'int', sum: true },
          { k: 'moneyIn', label: 'Money in', t: 'money', sum: true },
          { k: 'delivery', label: 'Delivery money', t: 'money', sum: true },
          { k: 'moneyOut', label: 'Money out', t: 'money', sum: true },
          { k: 'left', label: 'Left', t: 'money', sum: true, cls: (x) => (x.left < 0 ? 'neg' : '') },
          { k: 'balance', label: 'Running total', t: 'money' },
        ]}
        rows={r.cashBook.map((d) => ({ ...d, key: d.day, day: d.day + 'T12:00:00' }))}
        sortBy={['day', -1]}
      />
    ),
    monthly: (
      <Table
        cols={[
          { k: 'month', label: 'Month' },
          { k: 'orders', label: 'Orders', t: 'int', sum: true },
          { k: 'moneyIn', label: 'Money in', t: 'money', sum: true },
          { k: 'moneyOut', label: 'Money out', t: 'money', sum: true },
          { k: 'left', label: 'Left', t: 'money', sum: true, cls: (x) => (x.left < 0 ? 'neg' : '') },
          { k: 'delivery', label: 'Delivery money', t: 'money', sum: true },
        ]}
        rows={r.months.map((x) => ({ ...x, key: x.month }))}
        sortBy={['start', -1]}
      />
    ),
    orders: (
      <Table
        searchable
        cols={[
          { k: 'code', label: 'Order' },
          { k: 'created_at', label: 'Date', t: 'date' },
          { k: 'customer_name', label: 'Customer' },
          { k: 'areaText', label: 'Area' },
          { k: 'sourceText', label: 'Source' },
          { k: 'items_total', label: 'Items', t: 'money', sum: true },
          { k: 'fee', label: 'Delivery', t: 'money', sum: true },
          { k: 'amount_paid', label: 'Paid', t: 'money', sum: true },
          { k: 'owed', label: 'Owes', t: 'money', sum: true },
          { k: 'statusText', label: 'Status' },
        ]}
        rows={r.orders.map((o) => ({
          ...o,
          code: orderCode(shop, o),
          areaText: o.mode === 'pickup' ? 'Pick-up' : o.area || '',
          sourceText: SOURCES[o.source || 'direct'],
          fee: o.delivery_paid_by === 'customer' ? o.delivery_fee : null,
          owed: ['awaiting', 'part'].includes(o.status)
            ? Math.max(
                0,
                o.items_total + (o.delivery_paid_by === 'customer' ? o.delivery_fee || 0 : 0) - o.amount_paid,
              )
            : 0,
          statusText: STATUS[o.status] || o.status,
        }))}
        sortBy={['id', -1]}
        onRow={(o) => openOrder(o.id)}
      />
    ),
    products: (
      <Table
        searchable
        cols={[
          { k: 'name', label: 'Product' },
          { k: 'qty', label: 'Sold', t: 'int', sum: true },
          { k: 'sales', label: 'Sales', t: 'money', sum: true },
          { k: 'share', label: 'Share', t: 'pct' },
          { k: 'qtyBefore', label: 'Sold before', t: 'int', sum: true },
          {
            k: 'trend',
            label: 'Trend',
            t: 'int',
            render: (p) =>
              p.trend == null
                ? p.qty
                  ? 'New'
                  : '—'
                : p.trend === 0
                  ? '0%'
                  : `${p.trend > 0 ? '▲' : '▼'} ${Math.min(999, Math.abs(p.trend))}%`,
            cls: (p) => (p.trend > 0 ? 'up' : p.trend < 0 ? 'down' : ''),
          },
          { k: 'stock', label: 'In stock', t: 'int', sum: true },
          { k: 'stockValue', label: 'Stock value', t: 'money', sum: true },
          { k: 'perWeek', label: 'Sells a week', t: 'int' },
          {
            k: 'runsOut',
            label: 'Runs out in',
            t: 'int',
            render: (p) => (p.runsOut == null ? '—' : `${p.runsOut} days`),
            cls: (p) => (p.runsOut != null && p.runsOut <= 7 ? 'down' : ''),
          },
        ]}
        rows={r.products}
      />
    ),
    customers: (
      <Table
        searchable
        cols={[
          {
            k: 'name',
            label: 'Customer',
            render: (c) => (
              <span className="rt-two">
                {c.name}
                {c.tag && <span className="sub">{c.tag}</span>}
              </span>
            ),
          },
          { k: 'periodSpent', label: 'Spent', t: 'money', sum: true },
          { k: 'msg', label: '', render: (c) => sendButton('Message', () => message(c), !c.customerId) },
          { k: 'periodOrders', label: 'Orders', t: 'int', sum: true },
          { k: 'orders', label: 'All orders', t: 'int' },
          { k: 'spent', label: 'All spent', t: 'money' },
          { k: 'area', label: 'Area' },
          { k: 'last', label: 'Last order', t: 'date' },
        ]}
        rows={r.customers
          .filter((c) => c.periodOrders > 0)
          .map((c) => ({ ...c, tag: c.isNew ? 'New' : c.regular ? 'Regular' : '' }))}
        sortBy={['periodSpent', -1]}
      />
    ),
    owed: (
      <>
        <div className="age-chips">
          {r.ageTotals.map((a) => (
            <div key={a.age} className={'age-chip' + (a.age === 'Over 30 days' && a.count ? ' late' : '')}>
              <span>{a.age}</span>
              <strong className="num">{naira(a.amount)}</strong>
              <span className="sub">
                {a.count} order{a.count === 1 ? '' : 's'}
              </span>
            </div>
          ))}
        </div>
        <Table
          cols={[
            {
              k: 'name',
              label: 'Customer',
              render: (o) => (
                <span className="rt-two">
                  {o.name}
                  <span className="sub">
                    {o.code}
                    {o.says ? ' · says paid' : ''}
                  </span>
                </span>
              ),
            },
            { k: 'owes', label: 'Owes', t: 'money', sum: true },
            { k: 'msg', label: '', render: (o) => sendButton('Remind', () => remind(o)) },
            { k: 'days', label: 'Days', t: 'int', cls: (o) => (o.days > 30 ? 'down' : '') },
          ]}
          rows={r.owed.map((o) => ({ ...o, code: orderCode(shop, o) }))}
          onRow={(o) => openOrder(o.id)}
          empty="Nobody owes you right now."
        />
      </>
    ),
    out: (
      <>
        {m.outByKind.length > 0 && (
          <div className="age-chips">
            {m.outByKind.map((x) => (
              <div key={x.kind} className="age-chip">
                <span>{x.label}</span>
                <strong className="num">{naira(x.amount)}</strong>
              </div>
            ))}
          </div>
        )}
        <Table
          searchable
          cols={[
            { k: 'spent_on', label: 'Date', t: 'date' },
            { k: 'kindText', label: 'What for' },
            { k: 'note', label: 'Note' },
            { k: 'amount', label: 'Amount', t: 'money', sum: true },
            {
              k: 'x',
              label: '',
              render: (x) => (
                <button
                  className="rt-x"
                  aria-label={`Remove ${naira(x.amount)} ${x.kindText}`}
                  onClick={(e) => (e.stopPropagation(), removeOut(x))}
                >
                  ×
                </button>
              ),
            },
          ]}
          rows={r.moneyOut.map((x) => ({
            ...x,
            spent_on: x.spent_on + 'T12:00:00',
            kindText: outKind(x.kind),
          }))}
          sortBy={['spent_on', -1]}
          empty="No money out in this period. Add what you spend on restocking, packaging and transport to see what's left."
        />
        <button className="btn small ghost add-out" onClick={addOut}>
          + Add money out
        </button>
      </>
    ),
    sources: (
      <>
        <p className="note">
          Where customers came from before they ordered. Instagram, TikTok and Facebook are spotted
          automatically; WhatsApp needs the link from Copy WhatsApp message.
        </p>
        <Table
          cols={[
            { k: 'name', label: 'Source' },
            { k: 'orders', label: 'Orders', t: 'int', sum: true },
            { k: 'sales', label: 'Sales', t: 'money', sum: true },
            { k: 'share', label: 'Share', t: 'pct' },
          ]}
          rows={r.sources.map((x) => ({
            ...x,
            share:
              x.sales /
              Math.max(
                1,
                r.sources.reduce((a, y) => a + y.sales, 0),
              ),
          }))}
        />
      </>
    ),
    areas: (
      <Table
        searchable
        cols={[
          { k: 'name', label: 'Area' },
          { k: 'orders', label: 'Orders', t: 'int', sum: true },
          { k: 'sales', label: 'Sales', t: 'money', sum: true },
          { k: 'share', label: 'Share', t: 'pct' },
        ]}
        rows={r.areas.map((x) => ({
          ...x,
          share:
            x.sales /
            Math.max(
              1,
              r.areas.reduce((a, y) => a + y.sales, 0),
            ),
        }))}
        empty="No paid deliveries in this period."
      />
    ),
    riders: (
      <Table
        cols={[
          { k: 'name', label: 'Rider' },
          { k: 'deliveries', label: 'Deliveries', t: 'int', sum: true },
          { k: 'deliveryMoney', label: 'Delivery money', t: 'money', sum: true },
        ]}
        rows={r.riders}
        empty="No deliveries handed to riders in this period."
      />
    ),
    quiet: (
      <>
        <p className="note">
          Regulars (3 or more paid orders) who haven't ordered in over a month. A short hello often brings
          them back.
        </p>
        <Table
          cols={[
            { k: 'name', label: 'Customer' },
            { k: 'spent', label: 'Spent', t: 'money' },
            { k: 'msg', label: '', render: (c) => sendButton('Message', () => message(c), !c.customerId) },
            { k: 'last', label: 'Last order', t: 'date' },
            { k: 'paidOrders', label: 'Orders', t: 'int' },
          ]}
          rows={(r.actions.find((a) => a.kind === 'quiet') || { list: [] }).list}
          empty="All your regulars have ordered recently."
        />
      </>
    ),
  };

  const tabs = sheet === 'quiet' ? [...SHEETS, ['quiet', 'Regulars']] : SHEETS;
  return (
    <div className="report" role="dialog" aria-modal="true" aria-label="Full report">
      <header className="report-top">
        <button className="back-btn" onClick={onClose} aria-label="Back to Sales">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="report-title">
          <strong>Full report</strong>
          <span className="sub">{periodText}</span>
        </div>
        <button className="btn small" onClick={download}>
          Excel
        </button>
      </header>
      <nav className="report-tabs" aria-label="Sheets">
        {tabs.map(([k, l]) => (
          <button key={k} className="filter" aria-pressed={sheet === k} onClick={() => setSheet(k)}>
            {l}
          </button>
        ))}
      </nav>
      <div className="report-body" key={sheet}>
        {content[sheet] || content.summary}
      </div>
      {compose && (
        <ComposeSheet
          title={compose.title}
          to={compose.to}
          note={compose.note}
          text={compose.text}
          onSend={compose.send}
          onClose={() => setCompose(null)}
        />
      )}
    </div>
  );
}
