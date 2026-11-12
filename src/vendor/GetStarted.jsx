// "Get started" for a new shop: a small ring at the top of every tab that opens a checklist of four steps
// (add 3 products, share your link, first order, first payment). Each step ticks itself off from what the shop does.
// It goes away once all four are done, when the shop taps "Hide this", or two months after the shop was set up.
// The checklist sheet is drawn on the page itself (a portal), so it sits above the tab bar.
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { copyText } from '../lib/helpers.js';
import { DAY } from '../lib/dates.js';

const SHARED = (id) => 'shopdesk-shared-' + id;
const HIDDEN = (id) => 'shopdesk-started-hidden-' + id;
const read = (k) => {
  try {
    return localStorage.getItem(k);
  } catch (e) {
    return null;
  }
};
const write = (k) => {
  try {
    localStorage.setItem(k, '1');
  } catch (e) {
    /* private browsing */
  }
  window.dispatchEvent(new Event('shopdesk-started'));
};
// the shop copied or opened its order link (Shop tab, or here)
export const markShared = (shopId) => write(SHARED(shopId));

const TICK = <path d="M5 12.5l4.5 4.5L19 7.5" />;

function Ring({ done }) {
  const c = 2 * Math.PI * 9;
  return (
    <svg className="gs-ring" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" className="gs-ring-bg" />
      <circle cx="12" cy="12" r="9" className="gs-ring-on" strokeDasharray={`${(c * done) / 4} ${c}`} />
    </svg>
  );
}

export function GetStarted({ shop, data, setTab, say }) {
  const [, tick] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const f = () => tick((x) => x + 1);
    window.addEventListener('shopdesk-started', f);
    return () => window.removeEventListener('shopdesk-started', f);
  }, []);
  if (!data.loaded) return null;
  const pending = shop.status !== 'active';
  const products = data.products.filter((p) => p.active !== false).length;
  const orders = data.orders.length;
  const paid = data.orders.some((o) => o.amount_paid > 0) || (data.payments || []).length > 0;
  const shared = !!read(SHARED(shop.id)) || orders > 0;
  const done = [products >= 3, shared, orders > 0, paid];
  const count = done.filter(Boolean).length;
  const old = Date.now() - new Date(shop.created_at).getTime() > 60 * DAY;
  if (count === 4 || old || read(HIDDEN(shop.id))) return null;
  const now = done.indexOf(false);
  const link = `${window.location.origin}/${shop.slug}`;
  const share = () => {
    copyText(
      `Order from ${shop.name} here: ${link}?s=wa\nPick what you want and I see your order straight away.`,
      say,
      'WhatsApp message copied. Post it on your status.',
    );
    markShared(shop.id);
  };
  const go = (t) => {
    setOpen(false);
    setTab(t);
  };
  const steps = [
    [
      'Add 3 products',
      done[0]
        ? `${products} products in your shop`
        : `Photo, price and sizes.${pending ? ' Do it now while ShopDesk checks your shop.' : ''}`,
      ['Add products', () => go('stock')],
    ],
    [
      'Share your link',
      pending
        ? 'Opens once ShopDesk approves you.'
        : done[1]
          ? 'Your link is out there'
          : 'Copy your WhatsApp message and post it.',
      pending ? null : ['Copy message', share],
    ],
    [
      'Get your first order',
      'Post your link on your WhatsApp status and in your Instagram bio.',
      pending ? null : ['Share link', share],
    ],
    [
      'Mark your first payment',
      'When the money lands, tap Money in on the order.',
      ['Open orders', () => go('orders')],
    ],
  ];
  return (
    <>
      <button
        type="button"
        className="gs-btn"
        onClick={() => setOpen(true)}
        aria-label={`Get started: ${count} of 4 done`}
      >
        <Ring done={count} />
        Get started
      </button>
      {open &&
        createPortal(
          <div className="overlay bottom" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
            <div className="modal sheet gs-sheet" role="dialog" aria-modal="true" aria-labelledby="gsTitle">
              <div className="gs-head">
                <h2 id="gsTitle">Get your shop going</h2>
                <span className="gs-count">{count} of 4 done</span>
              </div>
              <div className="gs-bar" aria-hidden="true">
                <i style={{ width: count * 25 + '%' }} />
              </div>
              <ol className="gs-steps">
                {steps.map(([title, text, action], i) => (
                  <li key={title} className={done[i] ? 'done' : i === now ? 'now' : 'later'}>
                    <span className="gs-dot" aria-hidden="true">
                      {done[i] ? <svg viewBox="0 0 24 24">{TICK}</svg> : i + 1}
                    </span>
                    <div>
                      <strong>{title}</strong>
                      <span>{text}</span>
                    </div>
                    {i === now && action ? (
                      <button className="btn small" onClick={action[1]}>
                        {action[0]}
                      </button>
                    ) : (
                      <span />
                    )}
                  </li>
                ))}
              </ol>
              <div className="gs-foot">
                <span className="sub">Ticks itself off as you go.</span>
                <button
                  className="linkbtn"
                  onClick={() => {
                    setOpen(false);
                    write(HIDDEN(shop.id));
                  }}
                >
                  Hide this
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
