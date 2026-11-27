// /pay/<pay token>: a customer sent this link to someone so they pay the order. It shows the shop, the items and what's
// left to pay, never the customer's address or phone. The payer can transfer to the shop, or pay online with just their
// email (Paystack sends them the receipt). No ShopDesk account needed.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { copyText, errText } from '../lib/helpers.js';
import { money } from '../lib/moneyApi.js';
import { Page } from '../shared/Page.jsx';
import { Skeleton } from '../shared/Skeleton.jsx';

const EMAIL_OK = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function PayLinkPage({ token }) {
  const [o, setO] = useState(undefined);
  const [email, setEmail] = useState('');
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const [justPaid, setJustPaid] = useState(false);
  const load = useCallback(
    () =>
      supabase.rpc('get_pay_link', { p_pay: token }).then(({ data, error }) => {
        if (error) setErr(errText(error));
        setO(data || null);
      }),
    [token],
  );
  useEffect(() => {
    load();
  }, [load]);
  // back from Paystack
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ref = q.get('reference') || q.get('trxref');
    if (!ref) return;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    money('check', { reference: ref })
      .then((r) => {
        if (r.paid) setJustPaid(true);
        else setErr("We couldn't see that payment yet. If money left your account, it shows here shortly.");
        load();
      })
      .catch((e) => setErr(e.message));
  }, [load]);

  async function payOnline() {
    if (!EMAIL_OK.test(email.trim())) {
      setErr('Enter your email. Paystack sends your receipt there.');
      return;
    }
    setErr('');
    setPaying(true);
    try {
      const r = await money('paylink', { pay: token, email: email.trim() });
      window.location.assign(r.url);
    } catch (e) {
      setErr(e.message);
      setPaying(false);
    }
  }

  if (o === undefined)
    return (
      <Page title="Pay for an order">
        <Skeleton kind="page" />
      </Page>
    );
  if (!o)
    return (
      <Page title="Pay for an order">
        <div className="center">
          <h2>This pay link isn’t right</h2>
          <p className="note">Ask the person who sent it for a new one.</p>
        </div>
      </Page>
    );

  const left = Math.max(0, o.to_pay - o.amount_paid);
  const fee = (o.fee || 0) + (o.service || 0);
  const open = o.status === 'awaiting' || o.status === 'part';
  const items = o.items || [];
  return (
    <Page title={o.shop.name}>
      {justPaid || (!open && o.status !== 'cancelled') ? (
        <section className="card paid-done" role="status">
          <div className="paid-tick" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
          <h2>{justPaid ? 'Payment successful' : 'This order is paid'}</h2>
          <p className="note">
            Order <span className="ocode">{o.code}</span> · {o.shop.name}
          </p>
          <p className="note">
            {justPaid ? 'Thank you. The shop and the person who ordered have been told.' : 'Nothing is left to pay. Thank you.'}
          </p>
        </section>
      ) : o.status === 'cancelled' ? (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>This order was cancelled</h2>
          <p className="note">There’s nothing to pay.</p>
        </section>
      ) : (
        <>
          <section className="card">
            <p className="note" style={{ marginTop: 0 }}>
              Someone asked you to pay for their order from <strong>{o.shop.name}</strong> on ShopDesk.
            </p>
            <span className="order-id">
              Order <span className="ocode">{o.code}</span>
            </span>
            <ul className="paid-items">
              {items.map((i, n) => (
                <li key={n}>
                  <span>
                    {i.qty} × {i.name}
                  </span>
                  <span>{naira(i.qty * i.price)}</span>
                </li>
              ))}
              {o.discount > 0 && (
                <li>
                  <span>Discount{o.coupon ? ' · ' + o.coupon : ''}</span>
                  <span>−{naira(o.discount)}</span>
                </li>
              )}
              {o.delivery_fee > 0 && (
                <li>
                  <span>Delivery</span>
                  <span>{naira(o.delivery_fee)}</span>
                </li>
              )}
            </ul>
            <div className="row co-total">
              <span>{o.amount_paid > 0 ? 'Left to pay' : 'To pay'}</span>
              <strong className="num">{naira(left)}</strong>
            </div>
          </section>
          {o.fee_pending ? (
            <p className="note">The shop is still adding the delivery fee. Open this link again in a little while.</p>
          ) : (
            <section className="card">
              {o.online && (
                <div className="pay-online">
                  <div className="field">
                    <label htmlFor="plEmail">Your email (for the receipt)</label>
                    <input
                      id="plEmail"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </div>
                  <button className={'btn' + (paying ? ' busy' : '')} onClick={payOnline} disabled={paying}>
                    {paying ? 'Opening Paystack…' : `Pay ${naira(left + fee)} online`}
                  </button>
                  {fee > 0 && <span className="sub">Includes {naira(fee)} service fee</span>}
                  {!o.online_only && (
                    <div className="or">
                      <span>or transfer {naira(left)} to the shop</span>
                    </div>
                  )}
                </div>
              )}
              {o.online_only && !o.online && (
                <p className="note">Paying online isn’t available for this order right now. Let the person who sent this link know.</p>
              )}
              {!o.online_only && (
                <>
                  <p className="note">
                    Pay <strong>{naira(left)}</strong> in one transfer to:
                  </p>
                  <div className="slip pay-slip">
                    <div className="pay-line">
                      <div>
                        <div className="label">Account number</div>
                        <span className="acct">{o.shop.account_number}</span>
                      </div>
                      <button className="btn small" onClick={() => copyText(o.shop.account_number, setCopied, 'Account number copied.')}>
                        Copy
                      </button>
                    </div>
                    <div className="pay-line">
                      <div>
                        <div className="label">Transfer note (narration)</div>
                        <span className="acct">{o.code}</span>
                      </div>
                      <button className="btn small" onClick={() => copyText(o.code, setCopied, 'Code copied.')}>
                        Copy
                      </button>
                    </div>
                    <div>
                      <div className="label">Bank and name</div>
                      <span>
                        {o.shop.bank} · {o.shop.account_name}
                      </span>
                    </div>
                  </div>
                  <p className="note">
                    Put <strong>{o.code}</strong> in the transfer note. The shop confirms the order once the money lands.
                  </p>
                </>
              )}
              {copied && (
                <p className="ok" role="status">
                  {copied}
                </p>
              )}
            </section>
          )}
        </>
      )}
      {err && <p className="err">{err}</p>}
      <p className="fine-center">
        Only pay into the account shown here. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
      </p>
    </Page>
  );
}
