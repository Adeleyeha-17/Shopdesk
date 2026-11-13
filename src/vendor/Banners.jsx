// Messages at the top of the vendor's app: waiting for approval / not approved / suspended,
// a refund ShopDesk ordered, and announcements from ShopDesk.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { atText } from '../lib/dates.js';
import { RefundSent, refundLine } from './RefundSent.jsx';
import { orderCode } from '../lib/helpers.js';

export function StatusBanner({ shop, reloadShop, openDesk }) {
  if (shop.status === 'active') return null;
  if (shop.status === 'pending')
    return (
      <div className="banner">
        <strong>Waiting for approval</strong>
        <span>ShopDesk is checking your shop. Add your products meanwhile.</span>
        <div className="btns">
          <button className="linkbtn" onClick={reloadShop}>
            Check again
          </button>
          <button className="linkbtn" onClick={openDesk}>
            Message ShopDesk
          </button>
        </div>
      </div>
    );
  if (shop.status === 'rejected')
    return (
      <div className="banner bad">
        <strong>Not approved</strong>
        <span>{shop.review_note || 'ShopDesk will tell you why.'} Fix it in the Shop tab, then message ShopDesk.</span>
        <button className="linkbtn" onClick={openDesk}>
          Message ShopDesk
        </button>
      </div>
    );
  if (shop.status === 'banned')
    return (
      <div className="banner bad">
        <strong>Shop closed by ShopDesk</strong>
        <span>Message ShopDesk if this is a mistake.</span>
        <button className="linkbtn" onClick={openDesk}>
          Message ShopDesk
        </button>
      </div>
    );
  return (
    <div className="banner bad">
      <strong>Shop suspended</strong>
      <span>Your page is closed for now. Message ShopDesk.</span>
      <button className="linkbtn" onClick={openDesk}>
        Message ShopDesk
      </button>
    </div>
  );
}

// A refund ShopDesk ordered after a problem: pay it within 48 hours and add the receipt, or the shop's page pauses.
// Once the receipt is in, the page stays open while the customer checks (if they say it didn't arrive, it pauses again).
export function RefundBanner({ shop, problems, orders, run, say }) {
  const owed = (problems || []).filter((p) => p.owed_amount && !p.owed_paid_at);
  return owed.map((p) => {
    const o = (orders || []).find((x) => x.id === p.order_id);
    const who = o ? o.customer_name.split(' ')[0] : 'the customer';
    const code = orderCode(shop, { id: p.order_id });
    const sent = p.owed_sent_at && !p.owed_disputed_at;
    // paused: past the deadline and not sent yet, or the customer says it didn't arrive
    const late = new Date(p.owed_by) < new Date() && !sent;
    return (
      <div key={p.id} className={'banner ' + (sent ? 'notice' : 'bad')}>
        <strong>
          {late
            ? 'Your shop page is paused'
            : sent
              ? `Refund sent · ${code}`
              : `Refund ${naira(p.owed_amount)} by ${atText(p.owed_by)}`}
        </strong>
        <span>
          {sent
            ? refundLine(p, who)
            : p.owed_disputed_at
              ? `${refundLine(p, who)} Add the receipt again if you have another one.`
              : late
                ? `Refund ${naira(p.owed_amount)} to ${who} (${code}) and add the receipt. Your page reopens then.`
                : `ShopDesk decided ${code} for ${who}. Pay it back and add the receipt, or your page pauses.`}
        </span>
        <RefundSent p={p} who={who} run={run} say={say} link />
      </div>
    );
  });
}

// Notices from ShopDesk. Each one shows until the vendor dismisses it or ShopDesk ends it.
const SEEN = 'shopdesk-notices-seen';

export function ShopDeskNotices() {
  const [list, setList] = useState([]);
  const [seen, setSeen] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SEEN) || '[]');
    } catch (e) {
      return [];
    }
  });
  useEffect(() => {
    supabase.rpc('get_announcements').then(({ data }) => setList(data || []));
  }, []);
  const show = list.filter((n) => !seen.includes(n.id));
  if (!show.length) return null;
  const dismiss = (id) => {
    const next = [...seen, id].slice(-50);
    setSeen(next);
    try {
      localStorage.setItem(SEEN, JSON.stringify(next));
    } catch (e) {
      /* private browsing */
    }
  };
  return show.map((n) => (
    <div key={n.id} className="banner notice">
      <strong>{n.title}</strong>
      {n.body && <span>{n.body}</span>}
      <button className="linkbtn" onClick={() => dismiss(n.id)}>
        Got it
      </button>
    </div>
  ));
}
