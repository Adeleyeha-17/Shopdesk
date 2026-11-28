// Sales tab: when this week is well behind last week (from Wednesday on), a discount in one tap. The code and the sale
// banner go on straight away, then the Shop tab opens Announcements ready to tell customers.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { errText } from '../lib/helpers.js';

const PCTS = [5, 10, 15, 20];
const SHUT = 'sd-slow-shut';
export const HANDOFF = 'sd-announce'; // read once by Announcements: { kind, coupon, ends }

const shutToday = () => {
  try {
    return sessionStorage.getItem(SHUT) === new Date().toDateString();
  } catch (e) {
    return false;
  }
};

export function SlowSales({ shop, say, setTab, stamp }) {
  const [pace, setPace] = useState(null);
  const [pct, setPct] = useState(10);
  const [busy, setBusy] = useState(false);
  const [shut, setShut] = useState(shutToday);
  useEffect(() => {
    let on = true;
    supabase.rpc('sales_pace').then(({ data }) => on && setPace(data || null));
    return () => {
      on = false;
    };
  }, [stamp]);
  if (!pace || !pace.slow || pace.sale_on || shut || shop.status !== 'active') return null;

  async function start() {
    setBusy(true);
    const { data, error } = await supabase.rpc('quick_sale', { p_percent: pct });
    setBusy(false);
    if (error) return say(errText(error));
    try {
      sessionStorage.setItem(HANDOFF, JSON.stringify({ kind: 'sale', coupon: data.id, ends: data.ends_on }));
    } catch (e) {
      /* private browsing: Announcements opens as usual */
    }
    say(`${data.code} is on`);
    setPace({ ...pace, sale_on: true });
    setTab('shop');
  }
  function close() {
    setShut(true);
    try {
      sessionStorage.setItem(SHUT, new Date().toDateString());
    } catch (e) {
      /* hidden for now */
    }
  }

  return (
    <section className="card boxed slow-card">
      <div className="slow-head">
        <div>
          <h2>Sales are slower this week</h2>
          <p className="sub">
            {naira(pace.so_far)} so far · {naira(pace.last)} by now last week
          </p>
        </div>
        <button type="button" className="round-x" onClick={close} aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="filters slow-pcts" role="group" aria-label="Discount">
        {PCTS.map((p) => (
          <button key={p} type="button" className="filter" aria-pressed={pct === p} onClick={() => setPct(p)}>
            {p}%
          </button>
        ))}
      </div>
      <button className="btn" onClick={start} disabled={busy}>
        {busy ? 'Starting…' : `Start ${pct}% off`}
      </button>
    </section>
  );
}
