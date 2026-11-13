// On an order that's with the shop's own rider: send the rider their tracking link, then see where they are.
import React, { useState } from 'react';
import { supabase } from '../lib/database.js';
import { copyText, waLink, errText } from '../lib/helpers.js';
import { useLiveRider, agoText } from '../shared/LiveRider.jsx';
import { LiveMap } from '../shared/LiveMap.jsx';

const demoOpen = null; // the demo opens the rider page here instead of WhatsApp

export function RiderLive({ o, shop, code, say }) {
  const [live] = useLiveRider({ order: o.id, on: o.status === 'out' });
  const [map, setMap] = useState(false);
  const [busy, setBusy] = useState(false);
  const rider = o.rider_name || 'your rider';
  const first = o.customer_name.split(' ')[0];
  async function link() {
    const { data, error } = await supabase.rpc('rider_link', { p_order: o.id });
    if (error) {
      say(errText(error));
      return null;
    }
    return `${window.location.origin}/r/${data}`;
  }
  async function send(how) {
    setBusy(true);
    const l = await link();
    setBusy(false);
    if (!l) return;
    if (how === 'demo') return demoOpen(l);
    const text = `Hi ${rider}, this is ${shop.name}. Order ${code} for ${first}: open this link and tap "Share my location" so ${first} can follow you. ${l}`;
    if (how === 'copy') copyText(text, say, 'Copied. Paste it to your rider.');
    else window.open(waLink(o.rider_phone, text), '_blank', 'noopener');
  }
  if (live && live.sharing)
    return (
      <div className="rider-live">
        <div className="row">
          <span className="live-line">
            <span className="live-dot" aria-hidden="true" />
            Live · {agoText(live.at)}
          </span>
          <button className="linkbtn" onClick={() => setMap((m) => !m)}>
            {map ? 'Hide map' : 'See map'}
          </button>
        </div>
        {map && <LiveMap points={[{ lat: live.lat, lng: live.lng, kind: 'rider', label: rider }]} height={200} />}
      </div>
    );
  return (
    <div className="rider-live">
      <span className="sub">
        {live && live.link
          ? `${rider} hasn't shared their location yet. Send the link again?`
          : `Send ${rider} a tracking link so ${first} can follow them on a map.`}
      </span>
      <div className="btns">
        <button className="btn small ghost" onClick={() => send('wa')} disabled={busy}>
          Send on WhatsApp
        </button>
        <button className="linkbtn" onClick={() => send('copy')} disabled={busy}>
          Copy link
        </button>
        {demoOpen && (
          <button className="linkbtn" onClick={() => send('demo')} disabled={busy}>
            Open rider page
          </button>
        )}
      </div>
    </div>
  );
}
