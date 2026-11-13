// ShopDesk Delivery on a shop's order (only when Admin has switched it on; then every delivery order goes with it and is
// paid online):
//   new order  -> Get courier prices, pick one; the order is confirmed and the customer pays online (the price is added
//                 to their total, or comes out of the payment when the shop covers delivery)
//   paid       -> once every item is packed, book the courier (ShopDesk pays them)
//   on its way -> the courier, the rider, where it is, and the courier's tracking page
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { money } from '../lib/moneyApi.js';
import { naira } from '../lib/money.js';
import { useShipment, ShipmentView } from '../shared/Shipment.jsx';

const FRESH = 6 * 864e5;
const saved = (o) => {
  const q = o.delivery_quotes;
  return q && Array.isArray(q.list) && q.list.length && Date.now() - new Date(q.at).getTime() < FRESH ? q.list : null;
};
const hasPickup = (shop) => (shop.pickup_address || '').trim().length >= 5;

export function CourierPrices({ o, shop, code, run, say, goShop }) {
  const [list, setList] = useState(() => saved(o));
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const covers = o.delivery_paid_by !== 'customer'; // the shop covers delivery: the price comes out of the payment
  if (!hasPickup(shop))
    return (
      <div className="courier">
        <span className="label">ShopDesk Delivery</span>
        <span className="sub">We book a courier and pay them. Add your pickup address first.</span>
        <div className="btns">
          <button className="btn small ghost" onClick={goShop}>
            Add pickup address
          </button>
        </div>
      </div>
    );
  async function get() {
    setBusy(true);
    try {
      const r = await money('quote', { order: o.id });
      setList(r.list);
      setPick(null);
    } catch (e) {
      say(e.message);
    }
    setBusy(false);
  }
  async function use() {
    setBusy(true);
    await run(
      () => money('pick', { order: o.id, courier_id: pick.courier_id, service_code: pick.service_code }),
      null,
      `${code} confirmed with ${pick.name}. The customer can pay online now.`,
    );
    setBusy(false);
  }
  return (
    <div className="courier">
      <span className="label">ShopDesk Delivery</span>
      {!list ? (
        <>
          <span className="sub">
            {covers
              ? `You cover delivery: the price comes out of this order's ${naira(o.items_total)}.`
              : `The customer pays delivery with their order. You still get your full ${naira(o.items_total)}.`}
          </span>
          <div className="btns">
            <button className={'btn small' + (busy ? ' busy' : '')} onClick={get} disabled={busy}>
              {busy ? 'Getting prices…' : 'Get courier prices'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="choices" role="radiogroup" aria-label={'Couriers for order ' + o.id}>
            {list.map((q) => {
              const on = !!pick && pick.courier_id === q.courier_id && pick.service_code === q.service_code;
              return (
                <button
                  key={q.courier_id + q.service_code}
                  className="choice courier-choice"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPick(q)}
                >
                  <strong>
                    {q.name}
                    {q.cheapest && <em className="tag">Cheapest</em>}
                    {q.fastest && !q.cheapest && <em className="tag">Fastest</em>}
                  </strong>
                  <span>{q.eta_text || 'Delivery time on booking'}</span>
                  <b className="num">{naira(q.price)}</b>
                  <i aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <div className="btns">
            <button className="btn small" onClick={use} disabled={!pick || busy}>
              {pick ? `Confirm with ${pick.name} · ${naira(pick.price)}` : 'Pick a courier'}
            </button>
            <button className="linkbtn" onClick={get} disabled={busy}>
              {busy ? 'Getting prices…' : 'New prices'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function CourierBook({ o, code, run, allPacked }) {
  const [busy, setBusy] = useState(false);
  const name = (o.delivery_quote && o.delivery_quote.name) || 'the courier';
  async function book() {
    setBusy(true);
    await run(() => money('book', { order: o.id }), null, `${name} is coming to pick up ${code}.`);
    setBusy(false);
  }
  return (
    <div className="slip">
      <span className="label">Delivery is already paid</span>
      <span className="sub">
        {allPacked
          ? `${name} will pick it up from you.`
          : `Tick every item as you pack, then book ${name} to pick it up.`}
      </span>
      <div className="btns">
        <button className={'btn small' + (busy ? ' busy' : '')} onClick={book} disabled={!allPacked || busy}>
          {busy ? 'Booking…' : 'Book pickup'}
        </button>
      </div>
    </div>
  );
}

export function CourierTrack({ o }) {
  const [sh, setSh, refresh] = useShipment({ order: o.id });
  // the courier's news, now and every minute while it's on its way
  useEffect(() => {
    if (o.status !== 'out') return undefined;
    refresh();
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [o.status, refresh]);
  useEffect(() => {
    let on = true;
    supabase
      .from('shipments')
      .select('courier, status, tracking_url, tracking_code, steps, rider')
      .eq('order_id', o.id)
      .maybeSingle()
      .then(({ data }) => on && data && setSh(data));
    return () => {
      on = false;
    };
  }, [o.id, o.status, setSh]);
  return <ShipmentView sh={sh} />;
}
