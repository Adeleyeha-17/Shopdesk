// Admin > Payments & delivery: switch Pay online (Paystack) and ShopDesk Delivery (Shipbubble) on or off, see whether
// the keys are test or live and what is in the courier wallet, set the delivery margin, and see every delivery, with
// the delivery bills of shops whose customers paid them by transfer.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { money, shipStatus } from '../lib/moneyApi.js';
import { naira, toInt } from '../lib/money.js';
import { dayOf } from '../lib/dates.js';
import { errText } from '../lib/helpers.js';

const keyText = (k) => (!k ? 'Checking…' : !k.set ? 'Not set' : k.mode === 'live' ? 'Live' : 'Test');
const keyTone = (k) => (!k || !k.set ? 'owe' : k.mode === 'live' ? 'paid' : 'warn');

function Switch({ id, on, title, sub, click }) {
  return (
    <div className="switch-row">
      <div className="switch-text">
        <strong id={id}>{title}</strong>
        <span className="sub">{sub}</span>
      </div>
      <span className="inv-state">{on ? 'On' : 'Off'}</span>
      <button type="button" role="switch" className="switch" aria-checked={on} aria-labelledby={id} onClick={click}>
        <span />
      </button>
    </div>
  );
}

export function MoneyPage({ say, go }) {
  const [d, setD] = useState(null);
  const [keys, setKeys] = useState(null);
  const [margin, setMargin] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(
    () =>
      supabase.rpc('admin_money').then(({ data, error }) => {
        if (error) setErr(errText(error));
        else {
          setErr('');
          setD(data);
          setMargin((m) => (m === '' ? String(data.settings.delivery_margin) : m));
        }
      }),
    [],
  );
  useEffect(() => {
    load();
    money('status')
      .then(setKeys)
      .catch((e) => setKeys({ error: e.message }));
  }, [load]);
  async function save(part, done) {
    const { error } = await supabase.rpc('admin_save_settings', { p: part });
    if (error) {
      setErr(errText(error));
      return;
    }
    say(done);
    load();
  }
  async function billPaid(r) {
    const { error } = await supabase.rpc('admin_delivery_paid', { p_shop: r.shop_id });
    if (error) setErr(errText(error));
    else {
      say(`${r.shop}'s delivery bill is marked paid.`);
      load();
    }
  }
  const head = (
    <div className="page-head">
      <h1>Payments &amp; delivery</h1>
      <span className="sub">Customers paying online with Paystack, and ShopDesk Delivery with Shipbubble.</span>
    </div>
  );
  if (!d)
    return (
      <>
        {head}
        {err ? <p className="err">{err}</p> : <p className="note">Loading…</p>}
      </>
    );
  const st = d.settings;
  const ships = d.shipments || [];
  const owed = d.owed || [];
  const owedTotal = owed.reduce((n, r) => n + Number(r.owed), 0);
  const kept = ships.reduce((n, s) => n + (s.price - s.cost), 0);
  const pk = keys && keys.paystack;
  const ck = keys && keys.courier;
  return (
    <>
      {head}
      <section className="panel">
        <Switch
          id="payOn"
          on={st.online_pay_on}
          title="Customers can pay online"
          sub={
            st.online_pay_on
              ? 'On: order pages show "Pay online" for shops banking with OPay, Moniepoint, Kuda or PalmPay.'
              : 'Off: customers pay shops by transfer only.'
          }
          click={() =>
            save({ online_pay_on: !st.online_pay_on }, st.online_pay_on ? 'Pay online is off.' : 'Pay online is on.')
          }
        />
        <Switch
          id="shipOn"
          on={st.delivery_on}
          title="ShopDesk Delivery"
          sub={
            st.delivery_on
              ? 'On: shops can get courier prices, book couriers and follow deliveries.'
              : 'Off: shops use their own riders only.'
          }
          click={() =>
            save(
              { delivery_on: !st.delivery_on },
              st.delivery_on ? 'ShopDesk Delivery is off.' : 'ShopDesk Delivery is on.',
            )
          }
        />
      </section>
      {err && <p className="err">{err}</p>}
      <div className="grid2">
        <section className="panel">
          <div className="panel-head">
            <h3>Accounts</h3>
          </div>
          <div className="list">
            <div className="row">
              <span>Paystack</span>
              <span className={'chip ' + keyTone(pk)}>{keyText(pk)}</span>
            </div>
            <div className="row">
              <span>Shipbubble</span>
              <span className={'chip ' + keyTone(ck)}>{keyText(ck)}</span>
            </div>
            <div className="row">
              <span>Courier wallet</span>
              <span className="num">{ck && ck.balance != null ? naira(ck.balance) : ck && ck.set ? '…' : 'None'}</span>
            </div>
          </div>
          {keys && keys.error && <p className="err">{keys.error}</p>}
          {ck && ck.error && <p className="err">{ck.error}</p>}
          <p className="note">
            Test keys: payments and bookings are pretend, nothing real is charged. Once the accounts are approved, put
            the live keys in Supabase (Edge Functions, Secrets): PAYSTACK_SECRET_KEY and SHIPBUBBLE_API_KEY. Top up the
            courier wallet on Shipbubble before switching delivery on.
          </p>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>Prices and fees</h3>
          </div>
          <div className="form2">
            <div className="field">
              <label htmlFor="margin">Added to each courier price (₦)</label>
              <input
                id="margin"
                inputMode="numeric"
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
                placeholder="e.g. 200"
              />
            </div>
            <div className="field">
              <label htmlFor="feeBy">Paystack&apos;s fee is paid by</label>
              <select
                id="feeBy"
                value={st.paystack_fee_by}
                onChange={(e) => save({ paystack_fee_by: e.target.value }, 'Saved.')}
              >
                <option value="customer">The customer, added when they pay online</option>
                <option value="shop">The shop</option>
                <option value="shopdesk">ShopDesk, when delivery is in it</option>
              </select>
            </div>
          </div>
          <p className="note">
            The customer pays the courier&apos;s price plus this, rounded up to the next ₦50. The difference is
            ShopDesk&apos;s.
          </p>
          <div className="btns">
            <button
              className="btn small"
              onClick={() => {
                const n = toInt(margin);
                if (n == null || n < 0 || n > 20000) {
                  setErr('Enter an amount from 0 to 20,000.');
                  return;
                }
                save({ delivery_margin: n }, 'Margin saved.');
              }}
            >
              Save margin
            </button>
          </div>
        </section>
      </div>
      <div className="tiles">
        <div className="tile">
          <span className="label">Paid online</span>
          <span className="big num">{naira(d.online.amount)}</span>
          <span className="sub">
            {d.online.count} payments{d.online.fees > 0 ? ` · ${naira(d.online.fees)} card fees paid by customers` : ''}
          </span>
        </div>
        <div className="tile">
          <span className="label">Delivery money in online</span>
          <span className="big num">{naira(d.online.delivery)}</span>
        </div>
        <div className="tile">
          <span className="label">Kept after couriers</span>
          <span className="big num">{naira(kept)}</span>
          <span className="sub">last {ships.length} deliveries</span>
        </div>
        <div className="tile">
          <span className="label">Shops owe for delivery</span>
          <span className="big num">{naira(owedTotal)}</span>
        </div>
      </div>
      <section className="panel flush">
        <div className="panel-head pad">
          <h3>Delivery bills</h3>
          <span className="sub">
            Deliveries whose customers paid the shop by transfer, so the shop has the delivery fee.
          </span>
        </div>
        {owed.length === 0 ? (
          <p className="note" style={{ padding: '0 20px 20px' }}>
            No shop owes anything for delivery.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Shop</th>
                  <th className="r">Deliveries</th>
                  <th className="r">Owes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {owed.map((r) => (
                  <tr key={r.shop_id}>
                    <td className="name">
                      <button className="linkbtn" onClick={() => go('shop/' + r.shop_id)}>
                        {r.shop}
                      </button>
                    </td>
                    <td className="r num">{r.deliveries}</td>
                    <td className="r num">{naira(r.owed)}</td>
                    <td className="r">
                      <button className="btn small ghost" onClick={() => billPaid(r)}>
                        Mark paid
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel flush">
        <div className="panel-head pad">
          <h3>Deliveries</h3>
        </div>
        {ships.length === 0 ? (
          <p className="note" style={{ padding: '0 20px 20px' }}>
            No ShopDesk Delivery bookings yet.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Shop</th>
                  <th>Courier</th>
                  <th>Where it is</th>
                  <th>Paid</th>
                  <th className="r">Customer paid</th>
                  <th className="r">Courier cost</th>
                  <th>Booked</th>
                </tr>
              </thead>
              <tbody>
                {ships.map((s) => (
                  <tr key={s.order_id}>
                    <td className="ocode">
                      {s.tracking_url ? (
                        <a href={s.tracking_url} target="_blank" rel="noopener noreferrer">
                          {s.code}
                        </a>
                      ) : (
                        s.code
                      )}
                    </td>
                    <td className="name">{s.shop}</td>
                    <td>{s.courier}</td>
                    <td>
                      <span
                        className={
                          'chip ' +
                          (/complet|deliver/.test(s.status) ? 'paid' : /cancel/.test(s.status) ? 'owe' : 'new')
                        }
                      >
                        {shipStatus(s.status)}
                      </span>
                    </td>
                    <td className="sub">{s.paid_online ? 'Online' : s.billed_at ? 'Bill paid' : 'On bill'}</td>
                    <td className="r num">{naira(s.price)}</td>
                    <td className="r num">{naira(s.cost)}</td>
                    <td>{dayOf(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
