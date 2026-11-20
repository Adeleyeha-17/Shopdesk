// /help: the customer's recent orders with "Something wrong? Report a problem", short answers to what buyers ask most,
// and how to reach ShopDesk.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { atText } from '../lib/dates.js';
import { useBusy } from '../lib/busy.js';
import { Page } from '../shared/Page.jsx';
import { CustomerTabs } from './CustomerTabs.jsx';

// the same rules as docs/rules.md, in buyers' words
const QUESTIONS = [
  [
    'How do I pay for my order?',
    "You pay the shop directly, by transfer to the account shown on your order. Put the order code in the transfer note, then tap \"I've sent the money\". The shop confirms once the money arrives. ShopDesk never holds your money.",
  ],
  [
    "What if I don't pay straight away?",
    'An unpaid order waits for 48 hours, and we remind you before it ends. After that it cancels itself and the items go back on sale. You can also cancel it yourself before you pay.',
  ],
  [
    'How much is delivery, and who pays it?',
    'Each shop decides. Some deliver for free; others add a fee for your area, and you see it on your order before you pay. You can also choose to pick up from the shop.',
  ],
  [
    'Something is wrong with my order. What do I do?',
    'Open the order and tap Report a problem, up to 3 days after it arrives. Add photos for a wrong, damaged or missing item. The shop has 48 hours to refund you, send it again or explain. If it is not sorted, ask ShopDesk to decide, and we decide within 48 hours.',
  ],
  [
    'How do I get a receipt?',
    'Once the shop confirms your payment, tap Receipt at the top of your order. You can save it as a picture or share it.',
  ],
  [
    'Can I talk to the shop?',
    'Yes. Every order has a chat with the shop, from when you order until 7 days after it is done. Never pay to an account number someone sends in a chat if it is different from the one on your order.',
  ],
];

export function HelpPage() {
  const [orders, setOrders] = useState(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return setOrders([]);
      supabase.rpc('my_orders').then(({ data: rows }) => setOrders(rows || []));
    });
  }, []);
  useBusy(orders === null);
  // the last few orders that reached them, newest first
  const recent = (orders || []).filter((o) => o.status === 'delivered' && o.done_at).slice(0, 3);
  return (
    <Page title="Help" back="/account" kind="me" tabs={<CustomerTabs active="account" />}>
      <div className="help-hero">
        <h2>How can we help?</h2>
        <p className="sub">Answers to common questions, and help with your recent orders.</p>
      </div>
      {recent.map((o) => {
        const reportBy = new Date(o.done_at).getTime() + 3 * 864e5;
        const canReport = !o.problem && Date.now() < reportBy;
        return (
          <section key={o.token} className="card boxed help-order">
            <a className="top-part" href={'/o/' + o.token}>
              <span className="dot-line" aria-hidden="true" />
              <div>
                <strong>{o.shop}</strong>
                <span className="sub">
                  {o.mode === 'pickup' ? 'Collected' : 'Delivered'} {atText(o.done_at)}
                </span>
              </div>
              <span className="order-id">{o.code}</span>
            </a>
            {o.problem ? (
              <a className="claim" href={'/o/' + o.token}>
                <span>You reported a problem with this order.</span>
                <strong>See it</strong>
              </a>
            ) : canReport ? (
              <a className="claim" href={'/o/' + o.token + '#report'}>
                <span>Something wrong with your order?</span>
                <strong>Report a problem</strong>
              </a>
            ) : null}
          </section>
        );
      })}
      <section className="card boxed faq">
        <div className="faq-title">Common questions</div>
        {QUESTIONS.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
      <a className="card boxed contact-row" href="mailto:info@shopdesk.com.ng?subject=Help%20with%20ShopDesk">
        <span className="hist-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 6h16v12H4zM4 7l8 6 8-6" />
          </svg>
        </span>
        <div>
          <strong>Still need help?</strong>
          <span className="sub" style={{ display: 'block' }}>
            Email ShopDesk at info@shopdesk.com.ng. Add your order code if it's about an order.
          </span>
        </div>
      </a>
    </Page>
  );
}
