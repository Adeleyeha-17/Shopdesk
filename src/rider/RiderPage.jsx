// The rider's page (/r/<rider link>): the shop sends it to its rider. It shows where the order is going and who to call,
// and while the rider shares, it sends the phone's location every few seconds so the customer and the shop can follow
// on a map. Phones only share while this page is open, so it keeps the screen on while sharing.
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { telLink } from '../lib/helpers.js';
import { whenText } from '../lib/dates.js';
import { mapLink } from '../lib/products.js';
import { agoText } from '../shared/LiveRider.jsx';

const SEND_EVERY = 8000; // ms between updates at most

export function RiderPage({ token }) {
  const [job, setJob] = useState(undefined);
  const [state, setState] = useState('idle'); // idle | asking | sharing | denied | error
  const [sentAt, setSentAt] = useState(null);
  const [, tick] = useState(0);
  const watch = useRef(null);
  const lock = useRef(null);
  const last = useRef(0);

  const load = () =>
    supabase.rpc('rider_job', { p_token: token }).then(({ data, error }) => setJob(error ? null : data || null));
  useEffect(() => {
    load();
    const t = setInterval(() => {
      load();
      tick((n) => n + 1);
    }, 30000);
    return () => clearInterval(t);
  }, [token]);

  function stop() {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    if (lock.current) lock.current.release().catch(() => {});
    lock.current = null;
    setState('idle');
  }
  useEffect(() => () => stop(), []);
  useEffect(() => {
    if (job && job.done) stop();
  }, [job]);
  // the screen sleeping stops the sharing: ask again for the screen to stay on when the rider comes back to the page
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === 'visible' && watch.current != null && navigator.wakeLock)
        navigator.wakeLock
          .request('screen')
          .then((l) => (lock.current = l))
          .catch(() => {});
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);

  function start() {
    if (!navigator.geolocation) {
      setState('error');
      return;
    }
    setState('asking');
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        setState('sharing');
        if (Date.now() - last.current < SEND_EVERY) return;
        last.current = Date.now();
        supabase
          .rpc('rider_ping', {
            p_token: token,
            p_lat: p.coords.latitude,
            p_lng: p.coords.longitude,
            p_accuracy: p.coords.accuracy,
          })
          .then(({ data }) => {
            if (data === false) load();
            else setSentAt(new Date().toISOString());
          });
      },
      (e) => {
        stop();
        setState(e.code === 1 ? 'denied' : 'error');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
    if (navigator.wakeLock)
      navigator.wakeLock
        .request('screen')
        .then((l) => (lock.current = l))
        .catch(() => {});
  }

  const frame = (body) => (
    <div className="app rider">
      <header className="top cust-top">
        <div className="top-row">
          <div className="brand">
            <i aria-hidden="true" />
            ShopDesk
          </div>
        </div>
      </header>
      <main>{body}</main>
    </div>
  );
  if (job === undefined) return frame(<p className="note">Loading…</p>);
  if (!job)
    return frame(
      <div className="center">
        <h2>Link not found</h2>
        <p className="note">Ask the shop to send it again.</p>
      </div>,
    );
  if (job.done)
    return frame(
      <div className="center">
        <h2>{job.status === 'delivered' ? 'Delivered. Thank you!' : 'This delivery is finished'}</h2>
        <p className="note">You can close this page.</p>
      </div>,
    );
  const sharing = state === 'sharing';
  return frame(
    <>
      <div className="hello">
        <h1>Delivery for {job.shop}</h1>
        <span className="sub">
          Order {job.code}
          {job.deliver_by ? ` · due ${whenText(job.deliver_by)}` : ''}
        </span>
      </div>
      <section className="card boxed">
        <div className="label">Deliver to {job.customer}</div>
        <p className="rider-addr">{job.address}</p>
        <div className="btns">
          <a className="btn small" href={telLink(job.phone)} style={{ textDecoration: 'none' }}>
            Call {job.customer}
          </a>
          <a
            className="btn small ghost"
            href={
              job.lat != null && job.lng != null
                ? mapLink(job.lat, job.lng)
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`
            }
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
          >
            Directions
          </a>
        </div>
      </section>
      <section className={'card boxed share' + (sharing ? ' on' : '')}>
        {sharing ? (
          <>
            <div className="share-state">
              <span className="live-dot" aria-hidden="true" />
              <strong>Sharing your location</strong>
            </div>
            <p className="note">
              {job.customer} can see where you are{sentAt ? ` · sent ${agoText(sentAt)}` : ''}. Keep this page open
              until you deliver.
            </p>
            <button className="btn ghost" onClick={stop}>
              Stop sharing
            </button>
          </>
        ) : (
          <>
            <strong>Let {job.customer} follow you</strong>
            <p className="note">
              {state === 'denied'
                ? 'Location is blocked for this page. Allow it in your browser settings, then try again.'
                : state === 'error'
                  ? "Your phone couldn't find your location. Check that location is on, then try again."
                  : 'Share your location while you deliver. Keep this page open on the way.'}
            </p>
            <button
              className={'btn' + (state === 'asking' ? ' busy' : '')}
              onClick={start}
              disabled={state === 'asking'}
            >
              {state === 'asking' ? 'Finding you…' : 'Share my location'}
            </button>
          </>
        )}
      </section>
    </>,
  );
}
