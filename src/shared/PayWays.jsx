// How the customer pays: from their bank app or by card, or straight to the shop's account. Customers never pick a
// payment company: ShopDesk starts the payment with the first one Admin has on (Paystack, Monnify, Flutterwave) and moves
// to the next if one is down. No fee lines anywhere: the pay button shows the one total.
import React from 'react';

// the payment companies, for Admin
export const WAYS = {
  paystack: { name: 'Paystack', what: 'Card, transfer, USSD or Pocket' },
  monnify: { name: 'Monnify', what: 'Card, transfer or USSD' },
  flutterwave: { name: 'Flutterwave', what: 'Card, transfer or USSD' },
};

export const HOW = {
  bank: { name: 'My bank app', what: 'Any bank · confirmed instantly' },
  card: { name: 'Card or USSD', what: 'Visa, Mastercard or Verve' },
  shop: { name: 'Straight to the shop', what: 'To the shop’s account · the shop confirms' },
};
export const howsFor = (onlineOnly) => (onlineOnly ? ['bank', 'card'] : ['bank', 'card', 'shop']);

// the way this phone paid last time, when it's on the list
const KEY = 'sd-pay-how';
export function lastHow(list) {
  try {
    const v = localStorage.getItem(KEY);
    if (list.includes(v)) return v;
  } catch {
    // private window: start from the first
  }
  return list[0];
}
export function keepHow(v) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // nothing to keep it in
  }
}

// What a customer paying online pays in all (the same sums as the database's order_money): ShopDesk's fee, plus the
// card fee when the customer pays it. p: checkout_pay.
export function onlineTotal(due, p) {
  if (!p || due <= 0) return due;
  const base = due + (p.service || 0);
  const fee =
    p.fee_by !== 'customer' ? 0 : Math.ceil(base / 0.985) < 2500 ? Math.ceil(base / 0.985) - base : Math.min(Math.ceil((base + 100) / 0.985) - base, 2000);
  return base + fee;
}

// Back from the payment page: the payment reference it added to the address, and whether the customer stopped.
// Paystack adds reference (and trxref), Monnify paymentReference, Flutterwave tx_ref and status.
export function backFromPay(search) {
  const q = new URLSearchParams(search);
  const ref = q.get('reference') || q.get('trxref') || q.get('paymentReference') || q.get('tx_ref');
  return ref ? { ref, stopped: q.get('status') === 'cancelled' } : null;
}

// big: the checkout card, with a heading like the other checkout cards
export function PayWith({ list, value, onChange, disabled, big }) {
  return (
    <div className="pay-ways">
      {big ? (
        <h2 className="co-title" id="payWithTitle">
          How will you pay?
        </h2>
      ) : (
        <p className="pay-ways-title" id="payWithTitle">
          Pay with
        </p>
      )}
      <div className="choices" role="radiogroup" aria-labelledby="payWithTitle">
        {list.map((h) => (
          <button
            key={h}
            type="button"
            className="choice"
            role="radio"
            aria-checked={value === h}
            onClick={() => onChange(h)}
            disabled={disabled}
          >
            <strong>{HOW[h].name}</strong>
            <span>{HOW[h].what}</span>
            <i aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
