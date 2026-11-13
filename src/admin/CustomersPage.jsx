// Admin > Customers: find any customer by name, email or phone (shop owners never show here), see how they've used
// ShopDesk (orders, problems, problems they lost, messages shops reported), and block or unblock them.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { errText } from '../lib/helpers.js';
import { short } from './adminHelpers.js';
import { BlockCustomer } from './BlockCustomer.jsx';

export function CustomersPage({ say }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const find = (text) =>
    supabase.rpc('admin_find_customers', { p_q: text }).then(({ data, error }) => {
      if (error) setErr(errText(error));
      else {
        setErr('');
        setList(data || []);
      }
    });
  // search as they type, a moment after the last key
  useEffect(() => {
    if (q.trim().length < 2) {
      setList(null);
      return undefined;
    }
    const t = setTimeout(() => find(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      <div className="page-head">
        <h1>Customers</h1>
        <span className="sub">Find a customer by name, email or phone. Blocked customers can't order, write or report.</span>
      </div>
      <section className="panel">
        <div className="search">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, email or phone"
            aria-label="Find a customer"
            autoFocus
          />
        </div>
        {err && <p className="err">{err}</p>}
        {list === null ? (
          <p className="note">Type at least 2 letters or 4 digits.</p>
        ) : list.length === 0 ? (
          <p className="note">No customer matches.</p>
        ) : (
          <div className="rows">
            {list.map((c) => (
              <div key={c.id} className="cust-row">
                <div className="cust-main">
                  <strong>{c.name || c.email}</strong>
                  <span className="sub">{[c.email, c.phone].filter(Boolean).join(' · ')}</span>
                  <span className="sub">
                    {c.orders} order{c.orders === 1 ? '' : 's'}
                    {c.last_order ? ` · last ${short(c.last_order)}` : ''} · {c.problems} problem
                    {c.problems === 1 ? '' : 's'}
                    {c.lost > 0 ? ` (${c.lost} decided against them)` : ''}
                    {c.reported > 0 ? ` · ${c.reported} message${c.reported === 1 ? '' : 's'} reported by shops` : ''}
                  </span>
                  {c.blocked && c.block_reason && <span className="sub">Blocked: {c.block_reason}</span>}
                </div>
                <BlockCustomer
                  id={c.id}
                  name={c.name || c.email}
                  blocked={c.blocked}
                  after={(t) => {
                    say(t);
                    find(q.trim());
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
