// One pop-up for every admin action: approve, don't approve, suspend, close for good, reactivate, delete a shop,
// support view, close a report, hide/show a product. Approving, not approving, suspending, closing and reopening also
// tell the shop in its ShopDesk chat (the database sends that message).
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { dayOf } from '../lib/dates.js';
import { errText } from '../lib/helpers.js';

// ---------- One pop-up for every action ----------
export function ActionPopup({ m, close, after }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState(null);
  const [typed, setTyped] = useState(''); // deleting a shop: its link name, typed to confirm
  useEffect(() => {
    const f = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [close]);
  const s = m.shop;
  const T = {
    approve: [
      `Approve ${s && s.name}`,
      'Their order page opens straight away, and their ShopDesk chat tells them. A note is optional; it goes in the audit log.',
      'Approve and open shop',
    ],
    reject: [
      `Don't approve ${s && s.name}`,
      'Write why. They get it in their ShopDesk chat, so keep it clear and polite.',
      "Don't approve",
    ],
    status: {
      active: [
        `Reactivate ${s && s.name}`,
        'Their order page opens again, and their ShopDesk chat tells them. Write the reason for the audit log.',
        'Reactivate',
      ],
      suspended: [
        `Suspend ${s && s.name}`,
        'Their order page closes at once, until you reactivate it. Their ShopDesk chat tells them; your reason stays in the audit log.',
        'Suspend shop',
      ],
      banned: [
        `Close ${s && s.name} for good`,
        "Their order page closes for good. They can't reopen it, open another shop with this email, or shop with it. Their orders and history stay, and you can still reactivate it if you change your mind. Their ShopDesk chat tells them; your reason stays in the audit log.",
        'Close for good',
      ],
    }[m.status],
    delete: [
      `Delete ${s && s.name}`,
      `This removes the shop, its products, ${m.totals ? m.totals.orders : 0} order${m.totals && m.totals.orders === 1 ? '' : 's'}, payments and reports from the app. Customers' order links stop working. A private copy (orders, chats, receipts, photos) stays in Records.`,
      'Delete shop for good',
    ],
    support: [
      `Support view: ${s && s.name}`,
      "Shows this shop's recent orders with customer names, phone numbers and addresses. Only open it to sort out a problem. Write why; the reason is logged.",
      'Show orders',
    ],
    resolve: ['Close this report', 'Write what you found or did. It goes in the audit log.', 'Close report'],
    hide: [
      `Hide ${m.product && m.product.name}`,
      "It leaves the order page at once. Write why; the vendor sees it and can't show it again.",
      'Hide product',
    ],
    show: [
      `Show ${m.product && m.product.name} again`,
      'It goes back on the order page if the vendor has it switched on.',
      'Show again',
    ],
  }[m.kind];
  async function run() {
    setBusy(true);
    setErr('');
    const n = note.trim();
    let r;
    if (m.kind === 'approve' || m.kind === 'reject')
      r = await supabase.rpc('admin_review_shop', {
        p_shop: s.id,
        p_approve: m.kind === 'approve',
        p_note: n || null,
      });
    else if (m.kind === 'status')
      r = await supabase.rpc('admin_set_shop_status', { p_shop: s.id, p_status: m.status, p_note: n });
    else if (m.kind === 'delete') {
      r = await supabase.rpc('admin_delete_shop', { p_shop: s.id, p_confirm_slug: typed, p_note: n });
      if (!r.error) {
        // the shop is gone; its copy and all its photos stay for Records
        setBusy(false);
        window.location.hash = 'shops';
        after(`${s.name} was deleted. Its copy is in Records.`);
        return;
      }
    } else if (m.kind === 'resolve')
      r = await supabase.rpc('admin_resolve_report', { p_report: m.report.id, p_note: n });
    else if (m.kind === 'hide' || m.kind === 'show')
      r = await supabase.rpc('admin_hide_product', {
        p_product: m.product.id,
        p_hide: m.kind === 'hide',
        p_reason: n || null,
      });
    else if (m.kind === 'support')
      r = await supabase.rpc('admin_support_view', { p_shop: s.id, p_reason: n });
    setBusy(false);
    if (r.error) {
      setErr(errText(r.error));
      return;
    }
    if (m.kind === 'support') {
      setRows(r.data || []);
      after(null, m);
      return;
    }
    if (m.kind === 'approve') after(`${s.name} is open. Their ShopDesk chat told them.`);
    else if (m.kind === 'reject') after(`${s.name} was not approved. Their ShopDesk chat told them why.`);
    else if (m.kind === 'status') after(`Done. Their ShopDesk chat told them.`);
    else after("Done. It's in the audit log.");
  }
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={T[0]}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className={'modal' + (rows ? ' wide' : '')}>
        <div className="panel-head">
          <h3>{T[0]}</h3>
          <button className="linkbtn" onClick={close}>
            Close
          </button>
        </div>
        {rows ? (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>#</th>
                  <th>When</th>
                  <th>Status</th>
                  <th>Customer</th>
                  <th>Ordered</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th className="r">Items</th>
                  <th className="r">Paid</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td>{o.id}</td>
                    <td>{dayOf(o.created_at)}</td>
                    <td>{o.status}</td>
                    <td className="name">{o.customer_name}</td>
                    <td className="wrap">{o.items}</td>
                    <td>{o.customer_phone}</td>
                    <td className="wrap">{o.address}</td>
                    <td className="r num">{naira(o.items_total)}</td>
                    <td className="r num">{naira(o.amount_paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="note">No orders.</p>}
          </div>
        ) : (
          <>
            {T[1] && <p className="note">{T[1]}</p>}
            {m.kind !== 'show' && (
              <div className="field">
                <label htmlFor="mNote">
                  {m.kind === 'approve'
                    ? 'Note (optional)'
                    : m.kind === 'reject' || m.kind === 'hide'
                        ? 'Reason (the shop sees this)'
                        : 'Reason'}
                </label>
                <textarea
                  id="mNote"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  autoFocus
                />
              </div>
            )}
            {m.kind === 'delete' && m.totals && m.totals.paid_open > 0 && (
              <p className="err">
                {m.totals.paid_open} order{m.totals.paid_open === 1 ? ' has' : 's have'} been paid (in full or
                in part) but not delivered. Those customers lose their order page. If there's a dispute, close
                the shop for good instead, so the records stay.
              </p>
            )}
            {m.kind === 'delete' && (
              <div className="field">
                <label htmlFor="mSlug">
                  To confirm, type the shop's link name: <strong>{s.slug}</strong>
                </label>
                <input
                  id="mSlug"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
            )}
            {err && <p className="err">{err}</p>}
            <div className="btns">
              <button
                className={'btn small' + (m.kind === 'delete' ? ' bad' : '')}
                onClick={run}
                disabled={busy || (m.kind === 'delete' && typed.trim().toLowerCase() !== s.slug)}
              >
                {busy ? 'Working…' : T[2]}
              </button>
              <button className="btn small ghost" onClick={close}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
