// Overview: the headline numbers, what needs you, and growth charts.
import React from 'react';
import { naira } from '../lib/money.js';
import { short, k } from './adminHelpers.js';
import { BarChart } from './BarChart.jsx';

// ---------- Overview ----------
export function OverviewPage({ d, go, setModal }) {
  const { o, growth, attention } = d;
  const open = o.shops.filter((s) => s.open).length;
  const weeks = growth.weeks.map((w) => ({ x: w.week, ...w }));
  const tile = (label, value, sub, to, hot) => (
    <a className={'tile' + (hot ? ' hot' : '')} href={to ? '#' + to : undefined}>
      <span className="label">{label}</span>
      <span className="big num">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </a>
  );
  return (
    <>
      <div className="page-head">
        <h1>Overview</h1>
        <span className="sub">
          Updated {new Date().toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>
      <div className="tiles">
        {tile(
          'Needs attention',
          attention.length,
          attention.length ? 'warning signs to check' : 'all clear',
          'attention',
          attention.length > 0,
        )}
        {tile(
          'Waiting for approval',
          o.shops_pending,
          o.shops_pending ? 'applications' : 'none',
          'applications',
        )}
        {tile('Open shops', open, `${o.shops_total} shops in all`, 'shops')}
        {tile('Orders this week', o.orders_7d, `${o.orders_today} today`)}
        {tile('Money confirmed', naira(o.paid_value_7d), 'this week, all shops')}
        {tile('Open reports', o.reports_open, o.reports_open ? 'from customers' : 'none', 'reports')}
      </div>
      <div className="grid2">
        <section className="panel">
          <div className="panel-head">
            <h3>Needs attention</h3>
            <a className="sub" href="#attention">
              See all
            </a>
          </div>
          {attention.length ? (
            <div className="rows">
              {attention.slice(0, 5).map((a, i) => (
                <a key={i} className="arow" href={'#shop/' + a.shop_id}>
                  <span className={'dot' + (a.level === 1 ? ' bad' : ' wait')} />
                  <span>
                    <strong>{a.shop}</strong>
                    <span className="sub"> {a.text}</span>
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="note">Nothing needs you right now.</p>
          )}
        </section>
        <BarChart title="Orders per week" data={weeks.map((w) => ({ x: w.x, v: w.orders }))} />
        <BarChart
          title="Money confirmed per week"
          data={weeks.map((w) => ({ x: w.x, v: w.money }))}
          fmt={(v) => '₦' + k(v)}
        />
        <BarChart title="New shops per week" data={weeks.map((w) => ({ x: w.x, v: w.new_shops }))} />
        <section className="panel">
          <div className="panel-head">
            <h3>Top shops, 30 days</h3>
          </div>
          {growth.top_shops.length ? (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Shop</th>
                    <th className="r">Orders</th>
                    <th className="r">Money</th>
                  </tr>
                </thead>
                <tbody>
                  {growth.top_shops.map((s) => (
                    <tr key={s.id} className="click" onClick={() => go('shop/' + s.id)}>
                      <td className="name">{s.name}</td>
                      <td className="r num">{s.orders}</td>
                      <td className="r num">{naira(s.money)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="note">No confirmed payments in the last 30 days.</p>
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>Approved, but no orders yet</h3>
            <span className="sub">a week or more</span>
          </div>
          {growth.no_orders.length ? (
            <div className="rows">
              {growth.no_orders.map((s) => (
                <div key={s.id} className="arow">
                  <span>
                    <a href={'#shop/' + s.id}>
                      <strong>{s.name}</strong>
                    </a>
                    <span className="sub">
                      {' '}
                      · approved {s.approved_at ? short(s.approved_at) : '—'} · {s.products} products
                    </span>
                  </span>
                  <button
                    className="btn small ghost"
                    onClick={() =>
                      setModal({
                        kind: 'message',
                        shop: { id: s.id, name: s.name, status: 'active' },
                        text: `Hi ${s.name}, we noticed you haven't had an order yet. Can we help you share your link? ${window.location.origin}/${s.slug}`,
                      })
                    }
                  >
                    Follow up
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="note">Every approved shop has had an order.</p>
          )}
        </section>
      </div>
    </>
  );
}
