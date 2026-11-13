// One shop in detail: its numbers, details, products (hide/show), reports and history.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { dayOf } from '../lib/dates.js';
import { photoUrl } from '../lib/photos.js';
import { payPrice } from '../lib/products.js';
import { errText, waLink } from '../lib/helpers.js';
import { STATUS, recent, short, k } from './adminHelpers.js';
import { BarChart } from './BarChart.jsx';

// ---------- One shop ----------
export function ShopDetailPage({ id, d, setModal }) {
  const [x, setX] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(
    () =>
      supabase.rpc('admin_shop_detail', { p_shop: id }).then(({ data, error }) => {
        if (error) setErr(errText(error));
        else setX(data);
      }),
    [id],
  );
  useEffect(() => {
    load();
  }, [load, d]);
  if (err)
    return (
      <>
        <a className="back" href="#shops">
          ← All shops
        </a>
        <p className="err">{err}</p>
      </>
    );
  if (!x) return <p className="note">Loading…</p>;
  const s = x.shop;
  const weeks = x.weeks.map((w) => ({ x: w.week, ...w }));
  return (
    <>
      <a className="back" href="#shops">
        ← All shops
      </a>
      <div className="page-head">
        <div>
          <h1>{s.name}</h1>
          <span className="sub">
            {STATUS[s.status]}
            {s.status === 'active' ? ' · taking orders' : ''} · /
            {s.slug}
          </span>
        </div>
        <div className="btns end">
          {s.whatsapp && (
            <a
              className="btn small ghost"
              href={waLink(s.whatsapp, `Hi ${s.name}, this is ShopDesk. `)}
              target="_blank"
              rel="noopener"
            >
              WhatsApp
            </a>
          )}
          <a className="btn small ghost" href={'/' + s.slug} target="_blank" rel="noopener">
            Order page
          </a>
          {(s.status === 'pending' || s.status === 'rejected') && (
            <button className="btn small" onClick={() => setModal({ kind: 'approve', shop: s })}>
              Approve
            </button>
          )}
          {s.status === 'pending' && (
            <button className="btn small ghost" onClick={() => setModal({ kind: 'reject', shop: s })}>
              Don't approve
            </button>
          )}
          {s.status === 'active' && (
            <button
              className="btn small ghost"
              onClick={() => setModal({ kind: 'status', shop: s, status: 'suspended' })}
            >
              Suspend
            </button>
          )}
          {(s.status === 'active' || s.status === 'suspended') && (
            <button
              className="btn small ghost"
              onClick={() => setModal({ kind: 'status', shop: s, status: 'banned' })}
            >
              Close for good
            </button>
          )}
          {(s.status === 'suspended' || s.status === 'banned') && (
            <button
              className="btn small ghost"
              onClick={() => setModal({ kind: 'status', shop: s, status: 'active' })}
            >
              Reactivate
            </button>
          )}
          <button className="btn small ghost" onClick={() => setModal({ kind: 'support', shop: s })}>
            Support view
          </button>
        </div>
      </div>
      <div className="tiles">
        <div className="tile">
          <span className="label">Orders, all time</span>
          <span className="big num">{x.totals.orders}</span>
          <span className="sub">
            {x.totals.delivered} delivered · {x.totals.cancelled} cancelled
          </span>
        </div>
        <div className="tile">
          <span className="label">Open orders</span>
          <span className="big num">{x.totals.open_orders}</span>
          <span className="sub">not yet delivered</span>
        </div>
        <div className="tile">
          <span className="label">Money confirmed</span>
          <span className="big num">{naira(x.totals.money)}</span>
          <span className="sub">all time</span>
        </div>
      </div>
      <div className="grid2">
        <section className="panel">
          <div className="panel-head">
            <h3>Details</h3>
            {recent(s.details_changed_at, 14) && (
              <span className="chip flag">Bank details changed {short(s.details_changed_at)}</span>
            )}
          </div>
          <dl className="kv">
            <dt>Sells</dt>
            <dd>{s.sells || '—'}</dd>
            <dt>Based in</dt>
            <dd>{s.location || '—'}</dd>
            <dt>Instagram/TikTok</dt>
            <dd>{s.social || '—'}</dd>
            <dt>WhatsApp</dt>
            <dd>{s.whatsapp || '—'}</dd>
            <dt>Owner email</dt>
            <dd>{s.owner_email}</dd>
            <dt>Paid into</dt>
            <dd>
              {s.bank} · {s.account_number} · {s.account_name}
            </dd>
            <dt>Rules</dt>
            <dd>
              {s.delivery_paid_by === 'vendor' ? 'Shop covers delivery' : 'Customer pays delivery'}
            </dd>
            <dt>Joined</dt>
            <dd>{dayOf(s.created_at)}</dd>
            <dt>Approved</dt>
            <dd>
              {s.reviewed_at ? dayOf(s.reviewed_at) : '—'}
              {s.review_note ? ` · ${s.review_note}` : ''}
            </dd>
            <dt>Last active</dt>
            <dd>{s.last_active_at ? dayOf(s.last_active_at) : '—'}</dd>
          </dl>
        </section>
        <div className="stack">
          <BarChart title="Orders per week" data={weeks.map((w) => ({ x: w.x, v: w.orders }))} />
          <BarChart
            title="Money confirmed per week"
            data={weeks.map((w) => ({ x: w.x, v: w.money }))}
            fmt={(v) => '₦' + k(v)}
          />
        </div>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>Products</h3>
          <span className="sub">
            {x.products.length} · hide anything that breaks the rules; the vendor sees why and can't show it
            again
          </span>
        </div>
        {x.products.length ? (
          <div className="pgrid">
            {x.products.map((pr) => (
              <div key={pr.id} className={'pitem' + (pr.hidden_by_admin ? ' hidden' : '')}>
                <img src={photoUrl(pr.photo_path)} alt="" loading="lazy" />
                <div className="pmeta">
                  <strong>{pr.name}</strong>
                  <span className="sub num">
                    {pr.options && pr.options.length
                      ? `${pr.options.length} × ${(pr.option_label || 'size').toLowerCase()} (${pr.options
                          .map((o) => `${o.name} ${naira(payPrice(o))}`)
                          .join(', ')})`
                      : naira(payPrice(pr)) +
                        (pr.sale_price != null ? ` (sale, was ${naira(pr.price)})` : '')}{' '}
                    · {pr.stock} in stock
                    {!pr.active && !pr.hidden_by_admin ? ' · hidden by shop' : ''}
                  </span>
                  {pr.hidden_by_admin && <span className="chip flag">Hidden by you: {pr.hidden_reason}</span>}
                </div>
                {pr.hidden_by_admin ? (
                  <button className="btn small ghost" onClick={() => setModal({ kind: 'show', product: pr })}>
                    Show again
                  </button>
                ) : (
                  <button className="btn small ghost" onClick={() => setModal({ kind: 'hide', product: pr })}>
                    Hide
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="note">No products yet.</p>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Reports</h3>
        </div>
        {x.reports.length ? (
          <div className="rows">
            {x.reports.map((r) => (
              <div key={r.id} className="arow">
                <span>
                  <span className="sub">
                    {short(r.created_at)} · {r.resolved_at ? 'closed' : 'open'}
                  </span>
                  <div>{r.reason}</div>
                  {r.resolved_note && <div className="sub">Closed: {r.resolved_note}</div>}
                </span>
                {!r.resolved_at && (
                  <button
                    className="btn small ghost"
                    onClick={() => setModal({ kind: 'resolve', report: r })}
                  >
                    Close
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="note">No reports.</p>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>History</h3>
          <span className="sub">every decision, and every change to name, link or bank details</span>
        </div>
        {x.log.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {x.log.map((a, i) => (
                  <tr key={i}>
                    <td>{dayOf(a.at)}</td>
                    <td className="name">{a.who || 'system'}</td>
                    <td>{a.action}</td>
                    <td className="wrap">{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="note">Nothing yet.</p>
        )}
      </section>

      <section className="panel danger">
        <div>
          <h3>Delete this shop</h3>
          <p className="note">
            Removes the shop with its {x.products.length} product{x.products.length === 1 ? '' : 's'}, photos,{' '}
            {x.totals.orders} order{x.totals.orders === 1 ? '' : 's'}, payments and reports. It can't be
            undone. To stop a vendor but keep their history, use Suspend or Close for good instead.
          </p>
        </div>
        <button
          className="btn small bad"
          onClick={() => setModal({ kind: 'delete', shop: s, totals: x.totals })}
        >
          Delete shop
        </button>
      </section>
    </>
  );
}
