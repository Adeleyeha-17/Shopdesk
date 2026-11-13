// A ShopDesk Delivery on its way: the courier, the rider, the latest steps and the courier's tracking page.
// Used on the shop's order card and on the customer's order page.
import React, { useCallback, useState } from 'react';
import { money, shipStatus } from '../lib/moneyApi.js';
import { atText } from '../lib/dates.js';
import { telLink } from '../lib/helpers.js';

// The latest from the courier, for the shop (by order) or the customer (by order link).
export function useShipment({ order, token, initial }) {
  const [sh, setSh] = useState(initial || null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const r = await money('track', order ? { order } : { token });
      if (r.shipment) setSh(r.shipment);
    } catch (e) {
      /* keep what's on screen */
    }
    setBusy(false);
  }, [order, token]);
  return [sh, setSh, refresh, busy];
}

export function ShipmentView({ sh, busy, refresh, who }) {
  if (!sh) return null;
  const steps = (sh.steps || []).slice().reverse();
  const rider = sh.rider && (sh.rider.name || sh.rider.phone) ? sh.rider : null;
  return (
    <div className="ship">
      <div className="row">
        <div>
          <span className="label">ShopDesk Delivery · {sh.courier}</span>
          <strong className="ship-status">{shipStatus(sh.status)}</strong>
        </div>
        <button className={'btn small ghost' + (busy ? ' busy' : '')} onClick={refresh} disabled={busy}>
          {busy ? 'Checking…' : 'Refresh'}
        </button>
      </div>
      {rider && (
        <div className="row">
          <span className="sub">
            Rider: <strong>{rider.name || 'Courier rider'}</strong>
            {rider.phone ? ' · ' + rider.phone : ''}
          </span>
          {rider.phone && (
            <a className="btn small" href={telLink(rider.phone)} style={{ textDecoration: 'none' }}>
              Call
            </a>
          )}
        </div>
      )}
      {steps.length > 0 && (
        <ol className="ship-steps">
          {steps.slice(0, 4).map((s, i) => (
            <li key={i} className={i === 0 ? 'now' : ''}>
              <span>{s.status}</span>
              {s.at && <span className="sub">{atText(s.at)}</span>}
            </li>
          ))}
        </ol>
      )}
      {sh.tracking_url && (
        <a className="linkbtn" href={sh.tracking_url} target="_blank" rel="noopener noreferrer">
          {who === 'customer' ? 'Track it live' : 'Open the courier tracking page'}
        </a>
      )}
      {sh.tracking_code && <span className="sub">Tracking code: {sh.tracking_code}</span>}
    </div>
  );
}
