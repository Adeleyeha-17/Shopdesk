// The ways to pay online that Admin has switched on: Paystack, Monnify and Flutterwave. Each one pays the shop's share
// straight into the shop's own bank account. With only one way on there's nothing to pick, so nothing shows.
import React from 'react';

export const WAYS = {
  paystack: { name: 'Paystack', what: 'Card, transfer, USSD or Pocket' },
  monnify: { name: 'Monnify', what: 'Card, transfer or USSD' },
  flutterwave: { name: 'Flutterwave', what: 'Card, transfer or USSD' },
};

// the ways this order can be paid, from order_money or get_pay_link (Paystack alone before the database update),
// always in the same order
export const waysOf = (x) => Object.keys(WAYS).filter((w) => ((x && x.gateways) || ['paystack']).includes(w));

// the way this phone used last time, when it's still on
const KEY = 'sd-pay-via';
export function lastWay(ways) {
  try {
    const v = localStorage.getItem(KEY);
    if (ways.includes(v)) return v;
  } catch {
    // private window: start from the first way
  }
  return ways[0];
}
export function keepWay(v) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // nothing to keep it in
  }
}

// Back from a gateway's page: the payment reference it added to the address, and whether the customer stopped.
// Paystack adds reference (and trxref), Monnify paymentReference, Flutterwave tx_ref and status.
export function backFromPay(search) {
  const q = new URLSearchParams(search);
  const ref = q.get('reference') || q.get('trxref') || q.get('paymentReference') || q.get('tx_ref');
  return ref ? { ref, stopped: q.get('status') === 'cancelled' } : null;
}

export function PayWays({ ways, value, onChange, disabled }) {
  if (ways.length < 2) return null;
  return (
    <div className="pay-ways">
      <p className="pay-ways-title" id="payWaysTitle">
        Choose how to pay
      </p>
      <div className="choices" role="radiogroup" aria-labelledby="payWaysTitle">
        {ways.map((w) => (
          <button
            key={w}
            type="button"
            className="choice"
            role="radio"
            aria-checked={value === w}
            onClick={() => onChange(w)}
            disabled={disabled}
          >
            <strong>{WAYS[w].name}</strong>
            <span>{WAYS[w].what}</span>
            <i aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
