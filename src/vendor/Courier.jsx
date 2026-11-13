// ShopDesk Delivery on a shop's order (only when Admin has switched it on):
//   new order  -> Get courier prices, pick one; its price becomes the delivery fee and the order is confirmed
//   paid       -> once every item is packed, book the courier (ShopDesk pays them), or use your own rider instead
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
      `${code} confirmed with ${pick.name}. The customer sees the total.`,
    );
    setBusy(false);
  }
  return (
    <div className="courier">
      <span className="label">ShopDesk Delivery</span>
      {!list ? (
        <>
          <span className="sub">We book the courier and pay them. The customer pays the price you pick.</span>
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
    await run(
      () => money('book', { order: o.id }),
      null,
      `${name} is booked for ${code}. They will come to pick it up.`,
    );
    setBusy(false);
  }
  return (
    <div className="slip">
      <span className="label">ShopDesk Delivery · {name}</span>
      <span className="sub">
        {allPacked
          ? 'Book it and the courier comes to your pickup address. ShopDesk pays them.'
          : 'Tick every item as you pack, then book the courier.'}
      </span>
      <div className="btns">
        <button className={'btn small' + (busy ? ' busy' : '')} onClick={book} disabled={!allPacked || busy}>
          {busy ? 'Booking…' : 'Book ' + name}
        </button>
        <button
          className="linkbtn"
          disabled={busy}
          onClick={() => run('money_own_rider', { p_order: o.id }, `Use your own rider for ${code}.`)}
        >
          Use my own rider
        </button>
      </div>
    </div>
  );
}

export function CourierTrack({ o }) {
  const [sh, setSh, refresh, busy] = useShipment({ order: o.id });
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
  return <ShipmentView sh={sh} busy={busy} refresh={refresh} who="shop" />;
}
