// When a page can't load: what happened, in plain words, and a "Try again" button.
// Used instead of an empty screen, so nobody thinks their orders or shop are gone when it's only the connection.
import React, { useState } from 'react';
import { errInfo } from '../lib/errors.js';

const HEADINGS = {
  offline: "You're offline",
  network: 'Connection problem',
  timeout: 'This is taking too long',
  session: 'Please sign in again',
  outdated: 'ShopDesk was updated',
  busy: 'ShopDesk is busy',
  server: 'Something went wrong',
  permission: "You can't open this",
};

export function LoadError({ error, onRetry, what = 'this page', compact = false }) {
  const [busy, setBusy] = useState(false);
  const i = errInfo(error);
  const outdated = i.kind === 'outdated';
  async function again() {
    if (outdated) return window.location.reload();
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={compact ? 'card boxed load-error' : 'center load-error'} role="alert">
      <h2>{HEADINGS[i.kind] || `Couldn't load ${what}`}</h2>
      <p className="note">{i.text}</p>
      {(onRetry || outdated) && (
        <button className="btn small" onClick={again} disabled={busy}>
          {busy ? 'Trying…' : outdated ? 'Refresh' : 'Try again'}
        </button>
      )}
    </section>
  );
}
