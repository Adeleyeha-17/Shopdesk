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

const riderOf = (sh) => (sh.rider && (sh.rider.name || sh.rider.phone) ? sh.rider : null);

function TrackRow({ sh }) {
  const rider = riderOf(sh);
  return (
    <>
      {rider && (
        <div className="row">
          <span className="sub">
            <strong>{rider.name || 'Rider'}</strong>
            {rider.phone ? ' · ' + rider.phone : ''}
          </span>
          {rider.phone && (
            <a className="btn small" href={telLink(rider.phone)} style={{ textDecoration: 'none' }}>
              Call
            </a>
          )}
        </div>
      )}
      {sh.tracking_url && (
        <a
          className="btn small ghost"
          href={sh.tracking_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none', alignSelf: 'flex-start' }}
        >
          Track it live
        </a>
      )}
    </>
  );
}

// The customer's order page: who is bringing it, inside the latest step of Progress.
export function CourierRider({ sh }) {
  const rider = riderOf(sh);
  return (
    <div className="step-box">
      <div className="row">
        <div className="who">
          <strong>{rider ? rider.name || 'Your rider' : sh.courier}</strong>
          {rider && <span className="sub">{[sh.courier, rider.phone].filter(Boolean).join(' · ')}</span>}
        </div>
        {rider && rider.phone && (
          <a className="btn small" href={telLink(rider.phone)} style={{ textDecoration: 'none' }}>
            Call
          </a>
        )}
      </div>
      {sh.tracking_url && (
        <a
          className="btn small ghost"
          href={sh.tracking_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none', alignSelf: 'flex-start' }}
        >
          Track it live
        </a>
      )}
    </div>
  );
}

// The shop's order card: where the courier is, updated by itself.
export function ShipmentView({ sh }) {
  if (!sh) return null;
  const waiting = /^(pending|confirmed)$/.test(sh.status || 'pending');
  const last = (sh.steps || []).slice(-1)[0];
  return (
    <div className="ship">
      <strong className="ship-status">
        {waiting ? `${sh.courier} is coming to pick it up` : `${sh.courier} · ${shipStatus(sh.status)}`}
      </strong>
      {!waiting && last && last.at && (
        <span className="sub">
          {last.status} · {atText(last.at)}
        </span>
      )}
      <TrackRow sh={sh} />
    </div>
  );
}
