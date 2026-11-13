// One order on the Orders tab, with the next step for the vendor:
//   new order    -> Confirm order (and type the delivery fee, only if the customer pays delivery)
//   not paid     -> Money in (after checking the bank app), or copy a message for the customer, or cancel (with a
//                   reason the customer sees; not within a day of the customer saying they've paid)
//   paid         -> tick each item as you pack it (with an optional packing photo), then
//                   Hand to rider (name, phone, delivery time), or Ready for pick-up
//   ShopDesk Delivery (when switched on): courier prices on a new order, book the courier once paid and packed,
//                   and follow the delivery (see Courier.jsx)
//   with rider   -> Mark delivered, or change the rider or time
//   delivered    -> shows whether the customer confirmed they got it
//   problem      -> the customer reported one: answer within 48 hours (see ProblemPanel)
//   chat         -> messages with the customer, inside the order (see shared/Chat.jsx)
// Every order shows its code (BB-1043), which customers put in their transfer note, and a photo of each item.
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { photoUrl, uploadOrderPhoto } from '../lib/photos.js';
import { PhotoStrip } from '../shared/OrderPhotos.jsx';
import { Chat } from '../shared/Chat.jsx';
import { isActive } from '../lib/problems.js';
import { ProblemPanel } from './ProblemPanel.jsx';
import { naira, toInt, toPay, owes, needsFee } from '../lib/money.js';
import {
  dayOf,
  timeOf,
  whenText,
  atText,
  SLOTS,
  localDate,
  firstSlot,
  slotTime,
  slotLabel,
  DAY,
} from '../lib/dates.js';
import { copyText, telLink, errText, orderCode, ngMobile } from '../lib/helpers.js';
import { payMessage, payOnlineMessage } from './orderText.js';
import { hasPin, mapLink } from '../lib/products.js';
import { useMoneySwitches } from '../lib/moneyApi.js';
import { CourierPrices, CourierBook, CourierTrack } from './Courier.jsx';
import { RiderLive } from './RiderLive.jsx';

// Why a shop cancels. The customer sees it on their order.
const CANCEL_REASONS = [
  ['out_of_stock', 'Out of stock'],
  ['cant_deliver', "Can't deliver there"],
  ['customer_asked', 'Customer asked'],
  ['other', 'Other'],
];
// The customer said they've paid less than a day ago: check the bank, don't cancel.
const saysPaidToday = (o) =>
  o.customer_says_paid &&
  o.customer_says_paid_at &&
  new Date(o.customer_says_paid_at) > new Date(Date.now() - DAY);

// The label at the top right of an order: [colour, words]. Colours: warn = needs you, owe = not paid,
// paid = money in, new = on its way, done = finished.
function statusChip(o, due, pickup, pickCourier) {
  if (o.status === 'awaiting') {
    if (pickCourier) return ['warn', 'New · pick a courier'];
    if (needsFee(o)) return ['warn', 'New · set delivery fee'];
    if (!o.confirmed_at) return ['warn', 'New · confirm it'];
    if (o.customer_says_paid) return ['warn', 'Says paid · no money yet'];
    return ['owe', 'Not paid'];
  }
  if (o.status === 'part') return ['warn', 'Owes ' + naira(due)];
  const courier = !pickup && o.delivery_by === 'shopdesk';
  if (o.status === 'paid')
    return ['paid', pickup ? 'Paid · get it ready' : courier ? 'Paid · pack and book' : 'Paid · hand to rider'];
  if (o.status === 'out')
    return ['new', (pickup ? 'Ready · ' : courier ? 'With courier · due ' : 'With rider · due ') + whenText(o.deliver_by)];
  if (o.status === 'cancelled')
    return [
      'done',
      o.cancel_reason === 'unpaid'
        ? 'Cancelled · not paid'
        : o.cancel_reason === 'customer'
          ? 'Cancelled by customer'
          : 'Cancelled',
    ];
  if (o.received_by === 'customer') return ['paid', 'Customer got it'];
  return ['done', 'Delivered'];
}

// "Pick-up", or where it's going and who pays for delivery.
function whereText(o) {
  if (o.mode === 'pickup') return 'Pick-up';
  let delivery;
  const q = o.delivery_by === 'shopdesk' && o.delivery_quote;
  if (q && o.delivery_paid_by !== 'customer') delivery = `free delivery · ${q.name} ${naira(q.price)}, from the payment`;
  else if (q) delivery = `${q.name} ${naira(o.delivery_fee)}`;
  else if (o.delivery_paid_by !== 'customer') delivery = 'free delivery';
  else if (o.delivery_fee == null) delivery = 'fee not set';
  else delivery = `delivery ${naira(o.delivery_fee)}`;
  return `Delivery to ${o.address} · ${delivery}`;
}

// The customer's map pin, when they shared their location: opens in Google Maps, to send to the rider.
function MapPin({ o }) {
  if (!hasPin(o)) return null;
  return (
    <>
      {' · '}
      <a href={mapLink(o.delivery_lat, o.delivery_lng)} target="_blank" rel="noopener noreferrer">
        Open map pin
      </a>
    </>
  );
}

// The items, each with its product photo (the one the customer saw). While packing, each has a tick box.
function ItemList({ o, products, packing, ticks, onTick }) {
  const photo = {};
  (products || []).forEach((p) => (photo[p.id] = p.photo_path));
  return (
    <ul className="oitems">
      {(o.order_items || []).map((i) => {
        const done = ticks[i.id] ?? i.packed;
        return (
          <li key={i.id} className={'oitem' + (packing && done ? ' packed' : '')}>
            {i.photo_path || photo[i.product_id] ? (
              <img className="oitem-img" src={photoUrl(i.photo_path || photo[i.product_id])} alt="" />
            ) : (
              <span className="oitem-img" aria-hidden="true" />
            )}
            <span className="oitem-name">
              <strong>{i.qty} ×</strong> {i.name}
            </span>
            {packing ? (
              <label className="pack">
                <input type="checkbox" checked={!!done} onChange={(e) => onTick(i, e.target.checked)} />
                <span>Packed</span>
              </label>
            ) : (
              <span className="num sub">{naira(i.price * i.qty)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Chat stays open while the order is moving, for 7 days after, and while a problem or refund is open (same rule as the database).
function chatOpen(o, problem) {
  if (!o.customer_id) return false;
  if (['awaiting', 'part', 'paid', 'out'].includes(o.status)) return true;
  if (Date.now() - new Date(o.done_at || o.created_at).getTime() < 7 * 864e5) return true;
  return !!problem && (isActive(problem) || (problem.owed_amount && !problem.owed_paid_at));
}

export function OrderCard({
  o,
  shop,
  run,
  say,
  goShop,
  products,
  problem,
  unreadChat = 0,
  openChat = false,
  focused = false,
  markRead,
}) {
  const [chat, setChat] = useState(openChat);
  useEffect(() => {
    if (openChat) setChat(true);
  }, [openChat]);
  const cardRef = useRef(null);
  useEffect(() => {
    if (focused && cardRef.current) cardRef.current.scrollIntoView({ block: 'start' });
  }, [focused]);
  const [fee, setFee] = useState('');
  const sw = useMoneySwitches();
  const [sure, setSure] = useState(null); // cancelling: { reason, note }
  const [rider, setRider] = useState(null); // the hand-over form: { name, phone, date, hour }
  const [ticks, setTicks] = useState({}); // packing ticks saved a moment ago (shown at once)
  const [snapping, setSnapping] = useState(false);
  const code = orderCode(shop, o);
  const packing = o.status === 'paid';
  const items = o.order_items || [];
  const packedCount = items.filter((i) => ticks[i.id] ?? i.packed).length;
  const allPacked = packedCount === items.length;
  async function tick(i, on) {
    setTicks((t) => ({ ...t, [i.id]: on }));
    const { error } = await supabase.rpc('pack_item', { p_item: i.id, p_packed: on });
    if (error) {
      setTicks((t) => ({ ...t, [i.id]: !on }));
      say(errText(error));
    }
  }
  async function addPackingPhoto(file) {
    if (!file) return;
    setSnapping(true);
    try {
      const path = await uploadOrderPhoto(o.id, 'pack', file);
      await run('set_packing_photo', { p_order: o.id, p_path: path }, `Packing photo saved on ${code}.`);
    } catch (e) {
      say(errText(e));
    }
    setSnapping(false);
  }
  const due = owes(o);
  const waitFee = needsFee(o); // only when the customer pays delivery and the fee isn't set yet
  const pickup = o.mode === 'pickup';
  // booked with ShopDesk Delivery, or set up for it: the customer pays online, and the shop books the courier once paid
  const courier = !pickup && o.delivery_by === 'shopdesk';
  // ShopDesk Delivery is on: a new delivery order needs a courier picked before anything else
  const pickCourier =
    sw.delivery &&
    !pickup &&
    !courier &&
    o.status === 'awaiting' &&
    o.amount_paid === 0 &&
    (needsFee(o) || !o.confirmed_at);
  const chip = statusChip(o, due, pickup, pickCourier);
  const where = whereText(o);
  const openRider = () => {
    const f = firstSlot(pickup ? 1 : 2);
    setRider({
      name: o.rider_name || '',
      phone: o.rider_phone || '',
      date: o.deliver_by
        ? localDate(
            Math.max(
              0,
              Math.round(
                (new Date(o.deliver_by).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5,
              ),
            ),
          )
        : f.date,
      hour: o.deliver_by ? new Date(o.deliver_by).getHours() : f.hour,
    });
  };
  async function handOver() {
    const when = slotTime(rider.date, rider.hour);
    // the customer taps "Call rider", so the number has to be one that rings
    if (!pickup && !ngMobile(rider.phone)) {
      say("Check the rider's number, like 0803 123 4567.");
      return;
    }
    const ok = pickup
      ? await run('mark_ready', { p_order: o.id, p_ready_by: when }, `${code} is ready for pick-up.`)
      : await run(
          'hand_to_rider',
          { p_order: o.id, p_rider_name: rider.name, p_rider_phone: rider.phone, p_deliver_by: when },
          `${code} is with ${rider.name.trim()}.`,
        );
    if (ok) setRider(null);
  }
  return (
    <article className={'card' + (focused ? ' focused' : '')} ref={cardRef}>
      <div className="order-head">
        <div>
          <strong>{o.customer_name}</strong>{' '}
          <span className="order-id">
            <span className="ocode">{code}</span> · {dayOf(o.created_at)} {timeOf(o.created_at)}
          </span>
        </div>
        <span className={'chip ' + chip[0]}>{chip[1]}</span>
      </div>
      <ItemList o={o} products={products} packing={packing} ticks={ticks} onTick={tick} />
      <div className="items">
        {where}
        <MapPin o={o} />
      </div>
      {o.customer_phone && (
        <div className="items">
          Phone: <a href={telLink(o.customer_phone)}>{o.customer_phone}</a>
        </div>
      )}
      <div className="row">
        <span className="sub">{waitFee ? 'Items so far' : 'Customer pays'}</span>
        <span className="num">
          {naira(toPay(o))}
          {o.amount_paid > 0 && due > 0 ? ` · paid ${naira(o.amount_paid)}` : ''}
        </span>
      </div>
      {pickCourier && (
        <div className="slip">
          <CourierPrices o={o} shop={shop} code={code} run={run} say={say} goShop={goShop} />
        </div>
      )}
      {o.status === 'awaiting' && needsFee(o) && !pickCourier && (
        <div className="slip">
          <span className="label">Delivery fee</span>
          <span className="sub">
            Ask your rider the price to {o.address}.
            <MapPin o={o} />
          </span>
          <div className="inline">
            <input
              inputMode="numeric"
              placeholder="e.g. 2500"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              aria-label={'Delivery fee for order ' + o.id}
            />
            <button
              className="btn small"
              onClick={() => {
                const n = toInt(fee);
                if (n == null) {
                  say('Enter the fee, e.g. 2500.');
                  return;
                }
                run(
                  'set_delivery_fee',
                  { p_order: o.id, p_fee: n },
                  `${code} confirmed. The customer sees the total.`,
                );
              }}
            >
              Confirm order
            </button>
          </div>
        </div>
      )}
      {o.status === 'awaiting' && !needsFee(o) && !o.confirmed_at && !pickCourier && (
        <div className="btns">
          <button
            className="btn small"
            onClick={() => run('confirm_order', { p_order: o.id }, `${code} confirmed.`)}
          >
            Confirm order
          </button>
        </div>
      )}
      {due > 0 && courier && (
        <>
          <div className="slip">
            <span className="label">
              {o.customer_name.split(' ')[0]} pays {naira(due)} online
            </span>
            <span className="sub">It shows as paid here the moment they do. Then pack it and book the courier.</span>
          </div>
          <div className="btns">
            <button
              className="btn small ghost"
              onClick={() => copyText(payOnlineMessage(shop, o), say, 'Copied. Paste it to the customer.')}
            >
              Copy pay link
            </button>
          </div>
        </>
      )}
      {due > 0 && !waitFee && !courier && !pickCourier && (
        <>
          <div className="slip">
            <span className="label">
              {o.customer_name.split(' ')[0]} pays {naira(due)} to
            </span>
            <span className="acct">
              {shop.bank} · {shop.account_number}
            </span>
            <span className="sub">{shop.account_name}</span>
            <span className="sub">
              Transfer note: <strong className="ocode">{code}</strong>
            </span>
          </div>
          {o.customer_says_paid && (
            <p className="note">
              <strong>Says they've paid.</strong> Check your {shop.bank} app first. Screenshots aren't proof.
            </p>
          )}
          <div className="btns">
            <button
              className="btn small"
              onClick={() =>
                run(
                  'confirm_payment',
                  { p_order: o.id, p_method: 'tap', p_amount: null },
                  `Paid. Pack ${code}.`,
                )
              }
            >
              Money in: I checked my {shop.bank}
            </button>
            <button
              className="btn small ghost"
              onClick={() => copyText(payMessage(shop, o), say, 'Copied. Paste it to the customer.')}
            >
              Copy pay message
            </button>
          </div>
        </>
      )}
      {o.status === 'awaiting' &&
        o.amount_paid === 0 &&
        !saysPaidToday(o) &&
        (sure ? (
          <div className="slip">
            <span className="label">Why cancel {code}? The customer sees this.</span>
            <div className="filters" role="radiogroup" aria-label="Why cancel">
              {CANCEL_REASONS.map(([k, label]) => (
                <button
                  key={k}
                  className="filter"
                  role="radio"
                  aria-pressed={sure.reason === k}
                  aria-checked={sure.reason === k}
                  onClick={() => setSure({ ...sure, reason: k })}
                >
                  {label}
                </button>
              ))}
            </div>
            {sure.reason === 'other' && (
              <input
                aria-label="Reason for the customer"
                placeholder="Tell the customer why"
                maxLength={200}
                value={sure.note}
                onChange={(e) => setSure({ ...sure, note: e.target.value })}
              />
            )}
            <div className="btns">
              <button
                className="btn small"
                disabled={!sure.reason || (sure.reason === 'other' && sure.note.trim().length < 3)}
                onClick={() =>
                  run(
                    'cancel_order',
                    { p_order: o.id, p_reason: sure.reason, p_note: sure.note },
                    `${code} cancelled. Items are back in stock.`,
                  )
                }
              >
                Cancel {code}
              </button>
              <button className="btn small ghost" onClick={() => setSure(null)}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <div className="btns">
            <button className="linkbtn" onClick={() => setSure({ reason: '', note: '' })}>
              Cancel order
            </button>
          </div>
        ))}
      {courier && (o.status === 'out' || o.status === 'delivered') && <CourierTrack o={o} />}
      {o.status === 'out' && !pickup && !courier && (
        <div className="slip">
          <span className="label">With {o.rider_name}</span>
          <span className="sub">
            <a href={telLink(o.rider_phone)}>{o.rider_phone}</a> · due {whenText(o.deliver_by)}
          </span>
          <RiderLive o={o} shop={shop} code={code} say={say} />
        </div>
      )}
      {packing && (
        <div className="packbar">
          <div className="row">
            <span className="label">
              Packed {packedCount} of {items.length}
            </span>
            <label className={'btn small ghost' + (snapping ? ' busy' : '')} htmlFor={'pp' + o.id}>
              {snapping ? 'Saving…' : o.packing_photo ? 'Retake packing photo' : 'Add packing photo'}
            </label>
            <input
              id={'pp' + o.id}
              type="file"
              accept="image/*"
              capture="environment"
              className="visually-hidden"
              onChange={(e) => {
                addPackingPhoto(e.target.files && e.target.files[0]);
                e.target.value = '';
              }}
            />
          </div>
          {(!allPacked || !o.packing_photo) && (
            <span className="sub">
              {!allPacked ? 'Tick each item as you pack. ' : ''}
              {!o.packing_photo ? 'A packing photo is your proof.' : ''}
            </span>
          )}
        </div>
      )}
      {o.packing_photo && <PhotoStrip paths={[o.packing_photo]} label="Packing photo" />}
      {courier && o.status === 'paid' && <CourierBook o={o} code={code} run={run} allPacked={allPacked} />}
      {(o.status === 'paid' || o.status === 'out') && !rider && !courier && (
        <div className="btns">
          {o.status === 'paid' && (
            <button className="btn small" onClick={openRider} disabled={!allPacked}>
              {pickup ? 'Ready for pick-up' : 'Hand to rider'}
            </button>
          )}
          {o.status === 'out' && (
            <button
              className="btn small"
              onClick={() =>
                run('advance_order', { p_order: o.id }, `${code} ${pickup ? 'collected' : 'delivered'}.`)
              }
            >
              {pickup ? 'Customer collected it' : 'Mark delivered'}
            </button>
          )}
          {o.status === 'out' && (
            <button className="btn small ghost" onClick={openRider}>
              {pickup ? 'Change time' : 'Change rider or time'}
            </button>
          )}
          {o.status === 'paid' && pickup && (
            <button
              className="btn small ghost"
              onClick={() => run('advance_order', { p_order: o.id }, `${code} collected.`)}
              disabled={!allPacked}
            >
              Customer collected it
            </button>
          )}
        </div>
      )}
      {rider && (
        <div className="slip">
          <span className="label">{pickup ? 'When can they collect it?' : 'Hand to rider'}</span>
          {!pickup && (
            <div className="field">
              <label htmlFor={'rn' + o.id}>Rider's name</label>
              <input
                id={'rn' + o.id}
                value={rider.name}
                onChange={(e) => setRider({ ...rider, name: e.target.value })}
                placeholder="e.g. Musa"
              />
            </div>
          )}
          {!pickup && (
            <div className="field">
              <label htmlFor={'rp' + o.id}>Rider's phone number</label>
              <input
                id={'rp' + o.id}
                inputMode="tel"
                value={rider.phone}
                onChange={(e) => setRider({ ...rider, phone: e.target.value })}
                placeholder="e.g. 0803 123 4567"
              />
            </div>
          )}
          <div className="field">
            <label htmlFor={'rd' + o.id}>{pickup ? 'Ready from' : 'Delivered by'}</label>
            <div className="inline">
              <input
                id={'rd' + o.id}
                type="date"
                value={rider.date}
                min={localDate(0)}
                max={localDate(14)}
                onChange={(e) => setRider({ ...rider, date: e.target.value })}
              />
              <select
                value={rider.hour}
                onChange={(e) => setRider({ ...rider, hour: +e.target.value })}
                aria-label="Time"
              >
                {SLOTS.map((h) => (
                  <option key={h} value={h}>
                    {pickup ? 'from' : 'by'} {slotLabel(h)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {o.status === 'out' && (
            <p className="note" style={{ fontSize: 12 }}>
              ShopDesk sees time changes.
            </p>
          )}
          <div className="btns">
            <button className="btn small" onClick={handOver}>
              {pickup ? 'Ready for pick-up' : o.status === 'out' ? 'Save' : 'Hand to rider'}
            </button>
            <button className="btn small ghost" onClick={() => setRider(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {o.status === 'delivered' && (
        <p className="note">
          {o.received_by === 'customer'
            ? `Customer confirmed, ${atText(o.received_at)}.`
            : 'Waiting for the customer to confirm.'}
        </p>
      )}
      {problem && <ProblemPanel o={o} p={problem} code={code} run={run} say={say} />}
      {o.customer_id && (
        <div className="btns">
          <button className={'btn small ghost chat-btn' + (chat ? ' on' : '')} onClick={() => setChat(!chat)}>
            {chat ? 'Close chat' : 'Chat'}
            {!chat && unreadChat > 0 && <span className="badge">{unreadChat}</span>}
          </button>
        </div>
      )}
      {chat && (
        <div data-chat-open={o.id}>
          <Chat
            orderId={o.id}
            me="shop"
            canReport
            open={chatOpen(o, problem)}
            onSeen={() => markRead && markRead(o.id, 'message')}
            autoFocus={openChat}
          />
        </div>
      )}
    </article>
  );
}
