// Invite a shop, on the Shop tab: the shop's invite link, the reward, and the shops it brought in.
// Only shows once ShopDesk has switched invites on (Admin > Invites), and only for approved shops.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { copyText } from '../lib/helpers.js';
import { dayOf } from '../lib/dates.js';

const free = (n) => (n === 1 ? 'a free month' : `${n} free months`);
const STATE = {
  rewarded: ['paid', 'Paid · reward given'],
  approved: ['warn', 'Not paying yet'],
  pending: ['new', 'Being checked'],
  closed: ['done', 'Closed'],
};

export function InviteCard({ shop, say }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    supabase.rpc('my_invites').then(({ data }) => setD(data || null));
  }, [shop.id]);
  if (!d || !d.on || shop.status !== 'active') return null;
  const link = `${window.location.origin}/?invite=${d.slug}`;
  const message = `I take my shop's orders and payments on ShopDesk. Open your own shop here: ${link}`;
  const earned = d.rewarded * d.months;
  return (
    <section className="card inv-card">
      <div className="inv-head">
        <span className="inv-ic" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-3.5-6-3.5-6-1s3.5 1 6 1zM12 7c1.5-3.5 6-3.5 6-1s-3.5 1-6 1z" />
          </svg>
        </span>
        <div>
          <h2>{d.months > 0 ? `Invite a shop, get ${free(d.months)}` : 'Invite a shop'}</h2>
          <p className="note">
            Know someone selling on WhatsApp or Instagram?
            {d.months > 0 &&
              ` When a shop you invite pays for its first month, you get ${free(d.months)}${d.new_months > 0 ? ` and they get ${free(d.new_months)}` : ''}.`}
          </p>
        </div>
      </div>
      <div className="slip">
        <span className="mono">{link.replace(/^https?:\/\//, '')}</span>
        <span className="sub">Your invite link</span>
      </div>
      <div className="btns">
        <button className="btn small" onClick={() => copyText(message, say, 'Invite message copied')}>
          Copy invite message
        </button>
        <button className="btn small ghost" onClick={() => copyText(link, say, 'Invite link copied')}>
          Copy link
        </button>
      </div>
      {d.shops.length > 0 && (
        <>
          <div className="inv-stats">
            <div>
              <b>{d.shops.length}</b>
              <span>shop{d.shops.length === 1 ? '' : 's'} joined</span>
            </div>
            <div>
              <b>{earned}</b>
              <span>free month{earned === 1 ? '' : 's'} earned</span>
            </div>
          </div>
          <ul className="inv-list">
            {d.shops.map((x, i) => {
              const [tone, words] = STATE[x.state] || STATE.closed;
              return (
                <li key={i} className="row">
                  <div>
                    <strong>{x.name}</strong>
                    <span className="sub">Joined {dayOf(x.joined)}</span>
                  </div>
                  <span className={'chip ' + tone}>{words}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
