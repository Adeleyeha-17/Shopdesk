// /email-off?t=<secret>: the "Stop these emails" link in every email. Works without signing in, and asks before
// turning emails off (link checkers in mail apps open every link, so opening the page alone changes nothing).
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { errText } from '../lib/helpers.js';
import { Page } from './Page.jsx';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function EmailOffPage() {
  const [token] = useState(() => new URLSearchParams(window.location.search).get('t') || '');
  const [s, setS] = useState(undefined);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!UUID.test(token)) {
      setErr('This link has expired.');
      return;
    }
    supabase.rpc('email_by_token', { p_token: token }).then(({ data, error }) => {
      if (error) setErr(errText(error));
      else setS(data);
    });
  }, [token]);
  async function set(on) {
    setBusy(true);
    const { data, error } = await supabase.rpc('email_by_token', { p_token: token, p_on: on });
    setBusy(false);
    if (error) setErr(errText(error));
    else setS(data);
  }
  return (
    <Page>
      <section className="card">
        {err ? (
          <>
            <h2>Link not working</h2>
            <p className="note">{err} Turn emails off in ShopDesk instead: My orders, or the Shop tab.</p>
          </>
        ) : s === undefined ? (
          <p className="note">Loading…</p>
        ) : s.on ? (
          <>
            <h2>Stop these emails?</h2>
            <p className="note">
              {s.email} won’t get emails about what you missed. The app and phone alerts stay the same.
            </p>
            <button className="btn" onClick={() => set(false)} disabled={busy}>
              Stop these emails
            </button>
          </>
        ) : (
          <>
            <h2>Emails are off</h2>
            <p className="note">{s.email} won’t get these emails.</p>
            <button className="btn ghost" onClick={() => set(true)} disabled={busy}>
              Turn them back on
            </button>
          </>
        )}
      </section>
      <a className="linkbtn" href="/orders" style={{ alignSelf: 'center' }}>
        Open ShopDesk
      </a>
    </Page>
  );
}
