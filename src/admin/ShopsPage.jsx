// Shops: every shop, with search, filters, sorting and export to a spreadsheet.
import React, { useMemo, useState } from 'react';
import { naira } from '../lib/money.js';
import { STATUS, recent, short, downloadCsv } from './adminHelpers.js';

// ---------- Shops: search, filter, export ----------
export function ShopsPage({ d, go }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('new');
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const r = d.o.shops.filter((s) => {
      const hay = [s.name, s.slug, s.sells, s.location, s.owner_email, s.whatsapp].join(' ').toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
      if (status === 'open') return s.open;
      if (status === 'flagged')
        return s.reports_open > 0 || s.cancelled_30d >= 5 || recent(s.details_changed_at, 14);
      return status === 'all' || s.status === status;
    });
    const by = {
      new: (a, b) => (a.created_at < b.created_at ? 1 : -1),
      money: (a, b) => b.money_30d - a.money_30d,
      active: (a, b) => ((a.last_active_at || '') < (b.last_active_at || '') ? 1 : -1),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...r].sort(by[sort]);
  }, [d.o.shops, q, status, sort]);
  function exportCsv() {
    downloadCsv(
      [
        [
          'Shop',
          'Link',
          'Status',
          'Taking orders',
          'Sells',
          'Based in',
          'WhatsApp',
          'Owner email',
          'Joined',
          'Last active',
          'Orders 7d',
          'Money 30d',
          'Products',
          'Open reports',
        ],
        ...list.map((s) => [
          s.name,
          `${window.location.origin}/${s.slug}`,
          STATUS[s.status] || s.status,
          s.open ? 'yes' : 'no',
          s.sells,
          s.location,
          s.whatsapp,
          s.owner_email,
          s.created_at.slice(0, 10),
          (s.last_active_at || '').slice(0, 10),
          s.orders_7d,
          s.money_30d,
          s.products,
          s.reports_open,
        ]),
      ],
      `shopdesk-shops-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }
  return (
    <>
      <div className="page-head">
        <h1>Shops</h1>
        <span className="sub">
          {list.length} of {d.o.shops.length}
        </span>
      </div>
      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search name, link, what they sell, city, email or WhatsApp"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search shops"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="all">All shops</option>
          <option value="open">Taking orders</option>
          <option value="pending">Waiting for approval</option>
          <option value="flagged">Flagged</option>
          <option value="suspended">Suspended</option>
          <option value="banned">Closed for good</option>
          <option value="rejected">Not approved</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="new">Newest first</option>
          <option value="money">Most money, 30 days</option>
          <option value="active">Recently active</option>
          <option value="name">Name A–Z</option>
        </select>
        <button className="btn small ghost" onClick={exportCsv} disabled={!list.length}>
          Export to spreadsheet
        </button>
      </div>
      <section className="panel flush">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Shop</th>
                <th>Based in</th>
                <th>Owner</th>
                <th>Joined</th>
                <th>Last active</th>
                <th className="r">Orders 7d</th>
                <th className="r">Money 30d</th>
                <th className="r">Products</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const flags = [
                  s.reports_open && `${s.reports_open} report${s.reports_open > 1 ? 's' : ''}`,
                  s.cancelled_30d >= 5 && `${s.cancelled_30d} cancelled`,
                  recent(s.details_changed_at, 14) && 'bank details changed',
                ].filter(Boolean);
                return (
                  <tr key={s.id} className="click" onClick={() => go('shop/' + s.id)}>
                    <td>
                      <strong>{s.name}</strong>
                      <div className="sub">{s.sells || '/' + s.slug}</div>
                      {flags.length > 0 && (
                        <div>
                          <span className="chip flag">{flags.join(' · ')}</span>
                        </div>
                      )}
                    </td>
                    <td className="name">{s.location || '—'}</td>
                    <td className="name">{s.owner_email}</td>
                    <td>{short(s.created_at)}</td>
                    <td>{s.last_active_at ? short(s.last_active_at) : '—'}</td>
                    <td className="r num">{s.orders_7d}</td>
                    <td className="r num">{naira(s.money_30d)}</td>
                    <td className="r num">{s.products}</td>
                    <td>
                      {STATUS[s.status] || s.status}
                      {s.status === 'active' && !s.open ? ' · closed' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!list.length && (
          <p className="note" style={{ padding: 16 }}>
            No shops match.
          </p>
        )}
      </section>
    </>
  );
}
