// "Report this shop": a customer tells ShopDesk something went wrong. Reports show up in your admin.
// From an order page the report names that order; on a shop page a signed-in customer can pick one of their orders,
// so you see what was ordered and when. Reports need an account (so nobody can flood a shop with fake ones):
// one open report per shop, and a few a day.
import React, { useState } from 'react';
import { supabase, privacyEmail } from '../lib/database.js';
import { errText } from '../lib/helpers.js';
import { kick } from '../lib/alerts.js';
import { dayOf } from '../lib/dates.js';
import { SignIn } from './SignIn.jsx';

export function ReportShopForm({
  slug,
  done,
  token = null,
  code = '',
  orders = [],
  signedIn = true,
  path = '',
}) {
  const [reason, setReason] = useState('');
  const [contact, setContact] = useState('');
  const [pick, setPick] = useState(token || (orders[0] && orders[0].token) || '');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    const { error } = await supabase.rpc('report_shop', {
      p_slug: slug,
      p_reason: reason,
      p_contact: contact,
      p_token: pick || null,
    });
    setBusy(false);
    setOut(error ? errText(error) : 'Thanks. ShopDesk will look into it.');
    if (!error) {
      kick();
      setTimeout(done, 2000);
    }
  }
  if (!signedIn)
    return (
      <section className="card boxed">
        <SignIn compact title="Sign in to report this shop" path={path || '/' + slug} />
        <div className="btns">
          <button className="btn small ghost" onClick={done}>
            Close
          </button>
        </div>
      </section>
    );
  return (
    <section className="card boxed">
      <h2>Report this shop</h2>
      {token && code ? (
        <p className="sub">About order {code}</p>
      ) : orders.length ? (
        <div className="field">
          <label htmlFor="rOrder">Which order?</label>
          <select id="rOrder" value={pick} onChange={(e) => setPick(e.target.value)}>
            {orders.map((o) => (
              <option key={o.token} value={o.token}>
                {o.code} · {dayOf(o.created_at)}
              </option>
            ))}
            <option value="">Not about an order</option>
          </select>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="rWhy">What went wrong?</label>
        <textarea
          id="rWhy"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. I paid on Monday and nothing came"
        />
      </div>
      <div className="field">
        <label htmlFor="rWho">Phone (optional)</label>
        <input id="rWho" value={contact} onChange={(e) => setContact(e.target.value)} />
      </div>
      {out && <p className="note">{out}</p>}
      <p className="note" style={{ fontSize: 12 }}>
        Be honest. False reports can get an account blocked.
      </p>
      <div className="btns">
        <button className="btn small" onClick={send} disabled={busy}>
          Send report
        </button>
        <button className="btn small ghost" onClick={done}>
          Close
        </button>
      </div>
      {privacyEmail && (
        <p className="note" style={{ fontSize: 12 }}>
          Or write to {privacyEmail}.
        </p>
      )}
    </section>
  );
}
