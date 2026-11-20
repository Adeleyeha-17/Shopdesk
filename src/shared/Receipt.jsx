// A receipt for a paid order, for the customer and for the shop: shown in a sheet, and saved or shared as a picture
// (the picture is always white, like paper). It only exists once the shop has the money.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { naira } from '../lib/money.js';
import { clockOf } from '../lib/dates.js';

const dateOf = (t) =>
  new Date(t).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + clockOf(t);

// The customer's order page data (get_order_public) as a receipt.
export function receiptFromOrderPage(o) {
  if (!o || !o.receipt) return null;
  return {
    shop: o.shop.name,
    location: o.shop.location || '',
    code: o.code,
    at: o.paid_at || o.created_at,
    customer: o.receipt.customer,
    items: (o.items || []).map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
    mode: o.mode,
    fee: o.delivery_fee,
    feeBy: o.delivery_paid_by,
    paid: o.amount_paid,
    online: !!o.receipt.online,
    refund: o.receipt.refund || null,
  };
}

// The shop's own order (with its items), its problem if there is one, and whether any of the money came online.
export function receiptFromShopOrder(o, shop, problem, online) {
  const back = problem && problem.refund_received_at ? (problem.owed_amount ?? problem.refund_amount) : null;
  return {
    shop: shop.name,
    location: shop.location || '',
    code: null, // set by the caller (it knows the shop's order code)
    at: o.paid_at || o.created_at,
    customer: o.customer_name,
    items: (o.order_items || [])
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((i) => ({ name: i.name, qty: i.qty, price: i.price })), // the name includes the size
    mode: o.mode,
    fee: o.delivery_fee,
    feeBy: o.delivery_paid_by,
    paid: o.amount_paid,
    online: !!online,
    refund: back > 0 ? { amount: back, at: problem.refund_received_at } : null,
  };
}

// The lines of a receipt, the same on screen and in the picture.
function linesOf(r) {
  const items = r.items.map((i) => ({
    label: i.name,
    note: i.qty > 1 ? `${i.qty} × ${naira(i.price)}` : '',
    amount: naira(i.qty * i.price),
  }));
  const itemsTotal = r.items.reduce((a, i) => a + i.qty * i.price, 0);
  const extra = [];
  let charged = 0;
  if (r.mode === 'pickup') extra.push({ label: 'Pick-up', amount: 'Free' });
  else if (r.feeBy === 'customer' && r.fee > 0) {
    charged = r.fee;
    extra.push({ label: 'Delivery', amount: naira(r.fee) });
  } else extra.push({ label: 'Delivery', amount: 'Free' });
  const fee = r.paid - itemsTotal - charged;
  if (fee > 0) extra.push({ label: 'Service fee', amount: naira(fee) });
  const how = r.online ? 'Paid online' : `Bank transfer, confirmed by ${r.shop}`;
  const refund = r.refund ? `Refunded ${naira(r.refund.amount)} on ${dateOf(r.refund.at)}` : '';
  return { items, extra, how, refund };
}

// The picture: drawn line by line on a canvas, three times sharper than the screen.
function drawPicture(r) {
  const W = 360,
    PAD = 24,
    S = 3;
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const L = linesOf(r);
  const f = (w, size) => `${w} ${size}px ${font}`;
  // long names wrap onto more lines
  const wrap = (text, width, style) => {
    g.font = style;
    const words = String(text).split(' ');
    const out = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > width && line) {
        out.push(line);
        line = w;
      } else line = t;
    }
    if (line) out.push(line);
    return out;
  };
  const ops = [];
  let y = PAD;
  const text = (t, x, size, weight, colour, align = 'left') => ops.push({ t, x, y, size, weight, colour, align });
  const rule = () => {
    ops.push({ rule: true, y: y + 6 });
    y += 16;
  };
  text('ShopDesk', PAD, 14, 800, '#111');
  y += 30;
  for (const line of wrap(r.shop, W - PAD * 2, f(700, 18))) {
    text(line, PAD, 18, 700, '#111');
    y += 24;
  }
  if (r.location) {
    text(r.location, PAD, 13, 400, '#666');
    y += 20;
  }
  y += 6;
  text(`Receipt ${r.code}`, PAD, 13, 600, '#111');
  y += 19;
  text(dateOf(r.at), PAD, 13, 400, '#666');
  y += 19;
  if (r.customer) {
    text(`For ${r.customer}`, PAD, 13, 400, '#666');
    y += 19;
  }
  rule();
  const amountWidth = 110;
  for (const i of L.items) {
    const rows = wrap(i.label, W - PAD * 2 - amountWidth, f(500, 14));
    text(i.amount, W - PAD, 14, 600, '#111', 'right');
    rows.forEach((line) => {
      text(line, PAD, 14, 500, '#111');
      y += 19;
    });
    if (i.note) {
      text(i.note, PAD, 12, 400, '#666');
      y += 17;
    }
    y += 6;
  }
  for (const e of L.extra) {
    text(e.label, PAD, 14, 400, '#444');
    text(e.amount, W - PAD, 14, 500, '#111', 'right');
    y += 24;
  }
  rule();
  text('Total paid', PAD, 16, 700, '#111');
  text(naira(r.paid), W - PAD, 16, 800, '#111', 'right');
  y += 26;
  for (const line of wrap(L.how, W - PAD * 2, f(400, 12))) {
    text(line, PAD, 12, 400, '#666');
    y += 17;
  }
  if (L.refund) {
    y += 4;
    for (const line of wrap(L.refund, W - PAD * 2, f(600, 13))) {
      text(line, PAD, 13, 600, '#b42318');
      y += 18;
    }
  }
  y += PAD - 6;
  c.width = W * S;
  c.height = Math.ceil(y * S);
  g.scale(S, S);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, y);
  g.textBaseline = 'top';
  for (const o of ops) {
    if (o.rule) {
      g.strokeStyle = '#d0d0d0';
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(PAD, o.y + 0.5);
      g.lineTo(W - PAD, o.y + 0.5);
      g.stroke();
      continue;
    }
    g.font = f(o.weight, o.size);
    g.fillStyle = o.colour;
    g.textAlign = o.align;
    g.fillText(o.t, o.x, o.y);
  }
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('no picture'))), 'image/png'));
}

const canShareFiles = () => {
  try {
    return !!(
      navigator.canShare && navigator.canShare({ files: [new File(['x'], 'r.png', { type: 'image/png' })] })
    );
  } catch {
    return false;
  }
};

export function ReceiptSheet({ r, onClose }) {
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);
  const leaving = useRef(false);
  const first = useRef(null);
  const close = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    setClosing(true);
    setTimeout(onClose, 200);
  }, [onClose]);
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    if (first.current) first.current.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', key);
  }, [close]);
  const L = linesOf(r);
  const name = `Receipt ${r.code}.png`;
  async function save() {
    setWorking(true);
    try {
      const url = URL.createObjectURL(await drawPicture(r));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setNote('Saved.');
    } catch {
      setNote("Couldn't make the picture. Take a screenshot instead.");
    }
    setWorking(false);
  }
  async function share() {
    setWorking(true);
    try {
      const file = new File([await drawPicture(r)], name, { type: 'image/png' });
      await navigator.share({ files: [file], title: `Receipt ${r.code}` });
    } catch (e) {
      if (!e || e.name !== 'AbortError') setNote("Couldn't share it. Save it as a picture instead.");
    }
    setWorking(false);
  }
  return (
    <div
      className={'overlay bottom' + (closing ? ' closing' : '')}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal sheet" role="dialog" aria-modal="true" aria-labelledby="receiptTitle">
        <div className="receipt">
          <span className="rc-brand">ShopDesk</span>
          <div>
            <h2 id="receiptTitle" className="sheet-title">
              {r.shop}
            </h2>
            {r.location && <div className="sub">{r.location}</div>}
          </div>
          <div className="rc-meta">
            <strong>Receipt {r.code}</strong>
            <span className="sub">{dateOf(r.at)}</span>
            {r.customer && <span className="sub">For {r.customer}</span>}
          </div>
          <ul className="rc-lines">
            {L.items.map((i, n) => (
              <li key={n}>
                <span>
                  {i.label}
                  {i.note && <span className="sub">{i.note}</span>}
                </span>
                <span className="num">{i.amount}</span>
              </li>
            ))}
            {L.extra.map((e) => (
              <li key={e.label} className="rc-extra">
                <span>{e.label}</span>
                <span className="num">{e.amount}</span>
              </li>
            ))}
          </ul>
          <div className="rc-total">
            <span>Total paid</span>
            <span className="num">{naira(r.paid)}</span>
          </div>
          <span className="sub">{L.how}</span>
          {L.refund && <span className="rc-refund">{L.refund}</span>}
        </div>
        {note && (
          <p className="note" role="status">
            {note}
          </p>
        )}
        <div className="btns">
          <button className={'btn' + (working ? ' busy' : '')} ref={first} onClick={save} disabled={working}>
            Save as picture
          </button>
          {canShareFiles() && (
            <button className="btn ghost" onClick={share} disabled={working}>
              Share
            </button>
          )}
        </div>
        <button className="linkbtn back" onClick={close}>
          Close
        </button>
      </div>
    </div>
  );
}
