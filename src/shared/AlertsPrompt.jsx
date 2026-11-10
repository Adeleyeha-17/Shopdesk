// A small card: "Add ShopDesk to your home screen" and "Turn on alerts". It stays quiet once alerts are on,
// and "Not now" hides it for 3 days.
import React, { useEffect, useState } from 'react';
import { alertsState, isInstalled, turnOnAlerts, useInstall } from '../lib/alerts.js';
import { errText } from '../lib/helpers.js';

const LATER = 'shopdesk-alerts-later';
const WORDS = {
  shop: 'Get an alert for every new order and message.',
  customer: 'Get an alert when your order moves or the shop messages you.',
  admin: 'Get an alert for problems, reports and new shops.',
};
const saved = new Set(); // accounts already saved on this phone in this visit

export function AlertsPrompt({ who, userId }) {
  const [state, setState] = useState(() => (typeof window === 'undefined' ? 'none' : alertsState()));
  const [canInstall, install] = useInstall();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hidden, setHidden] = useState(() => {
    try {
      return Date.now() - Number(localStorage.getItem(LATER) || 0) < 3 * 864e5;
    } catch (e) {
      return false;
    }
  });
  // Already allowed on this phone: make sure it's saved for this account (no prompt).
  useEffect(() => {
    if (state === 'on' && userId && !saved.has(userId)) {
      saved.add(userId);
      turnOnAlerts(false).catch(() => saved.delete(userId));
    }
  }, [state, userId]);
  const installed = isInstalled();
  const showInstall = !installed && (canInstall || state === 'install');
  if (hidden || (!showInstall && state !== 'off')) return null;
  async function on() {
    setBusy(true);
    setErr('');
    try {
      await turnOnAlerts(true);
      saved.add(userId);
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
    setState(alertsState());
  }
  function later() {
    try {
      localStorage.setItem(LATER, String(Date.now()));
    } catch (e) {
      /* private browsing */
    }
    setHidden(true);
  }
  return (
    <section className="card alerts-card" aria-label="Alerts">
      <div className="alerts-head">
        <span className="alerts-bell" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />
          </svg>
        </span>
        <div>
          <strong>{state === 'install' ? 'Add ShopDesk to your Home Screen' : 'Turn on alerts'}</strong>
          <span className="sub">
            {state === 'install'
              ? 'Tap Share, then Add to Home Screen. Open it from there to get alerts.'
              : WORDS[who] || WORDS.customer}
          </span>
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      <div className="btns">
        {state === 'off' && (
          <button className="btn small" onClick={on} disabled={busy}>
            {busy ? 'Turning on…' : 'Turn on alerts'}
          </button>
        )}
        {canInstall && !installed && (
          <button className={'btn small' + (state === 'off' ? ' ghost' : '')} onClick={install}>
            Add to home screen
          </button>
        )}
        <button className="linkbtn" onClick={later}>
          Not now
        </button>
      </div>
    </section>
  );
}
