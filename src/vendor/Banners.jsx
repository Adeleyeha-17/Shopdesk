// Messages at the top of the vendor's app: waiting for approval / not approved / suspended,
// a refund ShopDesk ordered, "time to renew your plan", and announcements from ShopDesk.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { DAY, dayOf, atText } from '../lib/dates.js';
import { RefundSent, refundLine } from './RefundSent.jsx';
import { waLink, orderCode } from '../lib/helpers.js';

export function StatusBanner({ shop, reloadShop }) {
  if (shop.status === 'active') return null;
  if (shop.status === 'pending')
    return (
      <div className="banner">
        <strong>Waiting for approval</strong>
        <span>ShopDesk is checking your shop. Add your products meanwhile.</span>
        <button className="linkbtn" onClick={reloadShop}>
          Check again
        </button>
      </div>
    );
  if (shop.status === 'rejected')
    return (
      <div className="banner bad">
        <strong>Not approved</strong>
        <span>{shop.review_note || 'ShopDesk will tell you why.'} Fix it in the Shop tab, then message ShopDesk.</span>
      </div>
    );
  if (shop.status === 'banned')
    return (
      <div className="banner bad">
        <strong>Shop closed by ShopDesk</strong>
        <span>Contact ShopDesk if this is a mistake.</span>
      </div>
    );
  return (
    <div className="banner bad">
      <strong>Shop suspended</strong>
      <span>Your page is closed for now. Contact ShopDesk.</span>
    </div>
  );
}

// Your plan with ShopDesk: quiet during the trial, a reminder in the last week, and a clear message if the order page closed.
// On the free plan (once the plan or trial has run out): quiet until most of this month's free orders are used, then a note,
// then "pay by" once the shop passes them, and "closed" after the grace days. The free orders come back on the 1st.
export function PlanBanner({ shop }) {
  const [p, setP] = useState(null);
  useEffect(() => {
    if (shop.status === 'active') supabase.rpc('my_plan').then(({ data }) => setP(data || null));
  }, [shop.status, shop.id]);
  if (!p || !p.monthly_price || !p.paid_until || shop.status !== 'active') return null;
  const end = new Date(p.paid_until).getTime();
  const days = Math.ceil((end - Date.now()) / DAY);
  const free = p.free_orders || 0;
  const where = p.pay_account_number ? ` to ${p.pay_bank} ${p.pay_account_number} (${p.pay_account_name})` : '';
  const proof =
    p.admin_whatsapp &&
    waLink(p.admin_whatsapp, `Hi ShopDesk, I've paid ${naira(p.monthly_price)} for ${shop.name}. Here is my proof:`);
  const proofLink = proof && (
    <a className="linkbtn" href={proof} target="_blank" rel="noopener">
      Send proof on WhatsApp
    </a>
  );
  if (free > 0) {
    if (days > 7) return null;
    if (days >= 0)
      return (
        <div className="banner notice">
          <strong>Your plan ends {days === 0 ? 'today' : days === 1 ? 'tomorrow' : dayOf(end)}</strong>
          <span>
            After that you get {free} free orders a month. Pay {naira(p.monthly_price)}
            {where} only in months you pass them.
          </span>
        </div>
      );
    const n = p.month_orders || 0;
    const next = new Date();
    next.setMonth(next.getMonth() + 1, 1);
    if (n <= free) {
      if (n < Math.ceil(free * 0.8)) return null;
      return (
        <div className="banner notice">
          <strong>
            {n} of {free} free orders this month
          </strong>
          <span>
            Busy month! After {free} orders it&apos;s {naira(p.monthly_price)} for the month{where}. Your free orders
            come back on {dayOf(next)}.
          </span>
        </div>
      );
    }
    const closes = new Date(new Date(p.passed_at).getTime() + p.grace_days * DAY);
    return (
      <div className="banner bad">
        <strong>{p.open ? `You passed ${free} orders this month` : 'Shop closed'}</strong>
        <span>
          {p.open
            ? `Pay ${naira(p.monthly_price)}${where} by ${dayOf(closes)} to keep taking orders.`
            : `You passed ${free} orders this month. Pay ${naira(p.monthly_price)}${where} to reopen, or wait for your free orders on ${dayOf(next)}.`}
        </span>
        {proofLink}
      </div>
    );
  }
  if (days > 7) return null;
  const closes = new Date(end + p.grace_days * DAY);
  const text =
    days >= 0
      ? `Plan ends ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : dayOf(end)}. Pay ${naira(p.monthly_price)}${where}.`
      : p.open
        ? `Your page closes ${dayOf(closes)} unless you pay ${naira(p.monthly_price)}${where}.`
        : `Pay ${naira(p.monthly_price)}${where} to reopen.`;
  return (
    <div className={'banner' + (days < 0 ? ' bad' : '')}>
      <strong>{days < 0 ? (p.open ? 'Plan ended' : 'Shop closed') : 'Time to renew'}</strong>
      <span>{text}</span>
      {proofLink}
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
