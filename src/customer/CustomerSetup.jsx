// A new customer who joined from shopdesk.com.ng (not from a shop's link) sets up their account first:
// name, phone and area. The area puts the shops near them first on Shops near you.
import React, { useState } from 'react';
import { supabase } from '../lib/database.js';
import { errText } from '../lib/helpers.js';
import { signOut } from '../lib/alerts.js';
import { AreaPicker } from './AreaPicker.jsx';
import { saveArea } from './NearYou.jsx';

export function CustomerSetup({ userId, email, onDone }) {
  const [v, setV] = useState({ name: '', phone: '', area: '' });
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    const row = { name: v.name.trim().slice(0, 60), phone: v.phone.trim().slice(0, 20), area: v.area };
    const bad =
      row.name.length < 2
        ? 'Add your name.'
        : row.phone.replace(/\D/g, '').length < 10
          ? 'Add your phone number.'
          : !row.area
            ? 'Pick your area.'
            : '';
    if (bad) {
      setErr(bad);
      return;
    }
    setBusy(true);
    setErr('');
    let { error } = await supabase.from('customers').insert({ user_id: userId, ...row });
    if (error && /duplicate|customers_pkey/i.test(error.message || ''))
      ({ error } = await supabase
        .from('customers')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('user_id', userId));
    setBusy(false);
    if (error) {
      setErr(errText(error));
      return;
    }
    saveArea(row.area);
    onDone();
  }
  return (
    <div className="app setup-page">
      <header className="top">
        <div className="top-row">
          <div className="brand">
            <i aria-hidden="true" />
            ShopDesk
          </div>
          <button className="linkbtn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main>
        <div className="page-title">
          <h1>Set up your account</h1>
          <p>Shops use this to reach you and deliver your orders.</p>
        </div>
        <section className="card boxed">
          <div className="field">
            <label htmlFor="suName">Your name</label>
            <input
              id="suName"
              autoComplete="name"
              value={v.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
              placeholder="e.g. Chidi Okeke"
            />
          </div>
          <div className="field">
            <label htmlFor="suPhone">Phone number</label>
            <input
              id="suPhone"
              inputMode="tel"
              autoComplete="tel"
              value={v.phone}
              onChange={(e) => setV({ ...v, phone: e.target.value })}
              placeholder="e.g. 0803 123 4567"
            />
          </div>
          <div className="field">
            <span>Your area</span>
            <button type="button" className={'pick-area' + (v.area ? '' : ' empty')} onClick={() => setPicking(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" />
                <circle cx="12" cy="9.5" r="2.5" />
              </svg>
              <span>{v.area || 'Pick your area'}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <span className="field-hint">
              {v.area ? `We show you shops in ${v.area} first.` : 'We show you the shops near you first.'}
            </span>
          </div>
        </section>
        {err && (
          <p className="err" role="alert">
            {err}
          </p>
        )}
        <p className="fine-center">Signed in as {email}</p>
      </main>
      <div className="bottom-bar">
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </div>
      {picking && (
        <AreaPicker value={v.area} onPick={(a) => setV((x) => ({ ...x, area: a }))} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}
