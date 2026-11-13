// Where the shop's own rider is right now, while the order is on its way: for the customer (by order link) and the shop
// (by order). The rider shares it from their own page (rider/RiderPage.jsx).
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { LiveMap, kmBetween } from './LiveMap.jsx';

export function useLiveRider({ token, order, on }) {
  const [live, setLive] = useState(null);
  const load = useCallback(
    () =>
      supabase
        .rpc('order_live', token ? { p_token: token } : { p_token: null, p_order: order })
        .then(({ data, error }) => !error && setLive(data || null)),
    [token, order],
  );
  useEffect(() => {
    if (!on) {
      setLive(null);
      return undefined;
    }
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [on, load]);
  return [live, load];
}

export const agoText = (at) => {
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  return m === 1 ? '1 min ago' : `${m} min ago`;
};

const farText = (km) => (km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1)} km`);

// The customer's map: the rider, and the customer too if they tap "Show me".
export function LiveRiderCard({ live, name }) {
  const [me, setMe] = useState(null);
  const [asking, setAsking] = useState(false);
  if (!live || !live.sharing) return null;
  function showMe() {
    if (!navigator.geolocation) return;
    setAsking(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setMe({ lat: p.coords.latitude, lng: p.coords.longitude });
        setAsking(false);
      },
      () => setAsking(false),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  }
  const rider = { lat: live.lat, lng: live.lng, kind: 'rider', label: name || 'Rider' };
  return (
    <div className="live">
      <LiveMap points={me ? [rider, { ...me, kind: 'me', label: 'You' }] : [rider]} />
      <div className="row">
        <span className="live-line">
          <span className="live-dot" aria-hidden="true" />
          {me ? `${name || 'Your rider'} is ${farText(kmBetween(rider, me))} away` : 'Live location'} ·{' '}
          {agoText(live.at)}
        </span>
        {!me && navigator.geolocation && (
          <button className="linkbtn" onClick={showMe} disabled={asking}>
            {asking ? 'Finding you…' : 'How far?'}
          </button>
        )}
      </div>
    </div>
  );
}
