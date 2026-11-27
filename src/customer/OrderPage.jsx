// /o/<order link>: one order, as the customer sees it. Where it is, who has it, when it arrives, where to pay
// (with the order code for the transfer note), and the "I've sent the money" and "I got everything" buttons.
// Up to 3 days after delivery (or once the promised time has passed) the customer can report a problem
// (see ProblemBox.jsx). Only the customer who placed the order can do these. The page updates itself the moment
// the shop does anything, and has a chat with the shop (/o/<link>#chat opens it; it also opens by itself when the shop
// has written). An unpaid order can be cancelled by the customer, and cancels itself if it isn't paid in 48 hours.
// When Admin has switched them on: Pay online (Paystack, Monnify or Flutterwave, back on this page with the payment
// reference in the address) and ShopDesk Delivery tracking.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { whenText, atText } from '../lib/dates.js';
import { copyText, errText, telLink } from '../lib/helpers.js';
import { kick } from '../lib/alerts.js';
import { useInbox, InboxToast } from './inbox.jsx';
import { CustomerTabs } from './CustomerTabs.jsx';
import { rememberShop } from './myShops.js';
import { Page } from '../shared/Page.jsx';
import { Skeleton } from '../shared/Skeleton.jsx';
import { useBusy } from '../lib/busy.js';
import { LoadError } from '../shared/LoadError.jsx';
import { SignIn } from '../shared/SignIn.jsx';
import { ReportShopForm } from '../shared/ReportShopForm.jsx';
import { AlertsPrompt } from '../shared/AlertsPrompt.jsx';
import { Chat } from '../shared/Chat.jsx';
import { myTokens } from './savedOrders.js';
import { ReportProblemForm, CustomerProblem } from './ProblemBox.jsx';
import { RateShop } from './RateShop.jsx';
import { money } from '../lib/moneyApi.js';
import { PayWith, howsFor, lastHow, keepHow, backFromPay } from '../shared/PayWays.jsx';
import { useShipment, CourierRider } from '../shared/Shipment.jsx';
import { useLiveRider, LiveRiderCard } from '../shared/LiveRider.jsx';
import { ReceiptSheet, receiptFromOrderPage } from '../shared/Receipt.jsx';

// Why an order was cancelled, in the customer's words.
const CANCELLED = {
  unpaid: 'Not paid within 48 hours.',
  customer: 'You cancelled it.',
  out_of_stock: 'The shop ran out of stock.',
  cant_deliver: "The shop can't deliver there.",
  customer_asked: 'Cancelled because you asked.',
};

// What paying online adds on top (Paystack's card fee and ShopDesk's fee), shown as one service fee.
const serviceFee = (pay) => (pay ? (pay.fee || 0) + (pay.service || 0) : 0);

// The big line at the top of the order page: where the order is right now.
function headlineFor(o, pickup, feeWait) {
  if (o.status === 'cancelled') return 'Cancelled';
  if (o.status === 'delivered') {
    if (o.received_by === 'customer') return pickup ? 'Collected' : 'Delivered';
    return pickup ? 'Marked collected' : 'Marked delivered';
  }
  if (o.status === 'out') {
    return pickup
      ? `Ready to collect from ${whenText(o.deliver_by).replace(' by ', ', ')}`
      : `On its way · arriving ${whenText(o.deliver_by)}`;
  }
  if (o.status === 'paid') return 'Paid · being packed';
  if (!o.confirmed_at) return 'Waiting for the shop to confirm';
  if (feeWait) return 'Waiting for the delivery fee';
  return 'Waiting for your payment';
}

// "Ask someone to pay": a link to send to someone else. It shows them the shop, the items and the amount, never your
// address or phone, and they can pay by transfer or online without an account.
function AskToPay({ o, left, big }) {
  const [done, setDone] = useState('');
  const url = window.location.origin + '/pay/' + o.pay_token;
  const text = `Please help me pay ${naira(left)} for my order from ${o.shop.name}: ${url}`;
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Pay for my order', text });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    copyText(text, setDone, 'Link copied. Send it to whoever is paying.');
  }
  if (big)
    return (
      <>
        <button className="btn" onClick={share}>
          Send pay link
        </button>
        {done && (
          <p className="ok" role="status">
            {done}
          </p>
        )}
      </>
    );
  return (
    <>
      <button className="ask-pay" onClick={share}>
        <svg className="ask-ic" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16 6l-4-4-4 4M12 2v13M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
        </svg>
        <span className="ask-text">
          <strong>Ask someone to pay</strong>
        </span>
        <svg className="ask-go" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {done && (
        <p className="ok" role="status">
          {done}
        </p>
      )}
    </>
  );
}

// Straight after paying online: a clear "it worked" screen before the order itself.
function PaidScreen({ o, pickup, onView }) {
  const items = o.items || [];
  return (
    <section className="card paid-done" role="status">
      <div className="paid-tick" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h2>Payment successful</h2>
      <p className="paid-amt">{naira(o.amount_paid || o.to_pay)}</p>
      <p className="note">
        Order <span className="ocode">{o.code || '#' + o.order_id}</span> · {o.shop.name}
      </p>
      {items.length > 0 && (
        <ul className="paid-items">
          {items.map((i, n) => (
            <li key={n}>
              <span>
                {i.qty} × {i.name}
              </span>
              <span>{naira(i.qty * i.price)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="paid-actions">
        <button className="btn" onClick={onView}>
          View order
        </button>
        <a className="btn ghost" href={'/' + o.shop.slug}>
          Keep shopping
        </a>
      </div>
    </section>
  );
}

export function OrderPage({ token }) {
  const [o, setO] = useState(undefined);
  const [copied, setCopied] = useState('');
  const [err, setErr] = useState('');
  const [loadErr, setLoadErr] = useState(null);
  const [msg, setMsg] = useState('');
  const [justPaid, setJustPaid] = useState(false); // back from paying online with the payment through: the success screen
  // how the customer pays: bank app, card, or straight to the shop (picked at checkout, or here)
  const [how, setHow] = useState(() => {
    try {
      return sessionStorage.getItem('sd-how-' + token) || '';
    } catch {
      return '';
    }
  });
  // straight from checkout with "Someone else" paying: the pay link to send comes first
  const [askFirst, setAskFirst] = useState(() => {
    try {
      const k = 'sd-ask-' + token;
      const on = sessionStorage.getItem(k) === '1';
      sessionStorage.removeItem(k);
      return on;
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState(undefined);
  const [uid, setUid] = useState(null);
  const [chat, setChat] = useState(() => window.location.hash === '#chat');
  const chatRef = useRef(null);
  const [reporting, setReporting] = useState(false); // report this shop to ShopDesk
  // report a problem with this order to the shop (Help's "Report a problem" opens the page with #report)
  const [complaining, setComplaining] = useState(() => window.location.hash === '#report');
  const [cancelling, setCancelling] = useState(false); // "Cancel this order?"
  const [showReceipt, setShowReceipt] = useState(false);
  const autoOpened = useRef(false);
  const load = useCallback(
    () =>
      Promise.all([
        supabase.rpc('get_order_public', { p_token: token }),
        supabase.rpc('order_extras', { p_token: token }),
      ]).then(([{ data, error }, x]) => {
        // a refresh that fails keeps the order on screen; only a first load that fails shows "Try again"
        if (error) setLoadErr(error);
        else {
          setLoadErr(null);
          // the note, the discount code and the pay link (for the customer) come separately
          setO(data ? { ...data, ...((x && x.data) || {}) } : data);
        }
      }),
    [token],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);
  // Live: the page changes the moment the shop confirms, gets the money, sends it or writes. A message about this
  // order pops up unless its chat is open; Open opens it right here.
  const orderId = o && o.order_id;
  const openChat = () => {
    setChat(true);
    setTimeout(
      () => chatRef.current && chatRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      50,
    );
  };
  const inbox = useInbox(uid, {
    onAlert: () => load(),
    quiet: (n) => n.order_id === orderId && chat,
    open: (n) => {
      if (n.order_id !== orderId) return false;
      openChat();
      return true;
    },
    title: o && o.shop ? o.shop.name : 'ShopDesk',
  });
  const unread = inbox.unread;
  // the shop wrote while they were away: the chat opens with the page (new messages after that pop up instead)
  const waiting = orderId ? unread.chats[orderId] || 0 : 0;
  useEffect(() => {
    if (!orderId || !unread.loaded || autoOpened.current) return;
    autoOpened.current = true;
    if (waiting > 0) setChat(true);
  }, [orderId, unread.loaded, waiting]);
  const seenKinds = unread.list
    .filter((n) => n.order_id === orderId && n.kind !== 'message')
    .map((n) => n.kind)
    .join(',');
  useEffect(() => {
    if (orderId && seenKinds) [...new Set(seenKinds.split(','))].forEach((k) => unread.markRead(orderId, k));
  }, [orderId, seenKinds]);
  useEffect(() => {
    if (chat && chatRef.current && window.location.hash === '#chat')
      chatRef.current.scrollIntoView({ block: 'start' });
  }, [chat, orderId]);
  // Signed in? Save older orders from this device to the account. Only the account that placed an order can
  // say it's paid or received, so the page follows sign-in and sign-out (Supabase calls run just after the callback).
  useEffect(() => {
    const use = async (session) => {
      setWho(session ? session.user.email : '');
      setUid(session ? session.user.id : null);
      if (session) await supabase.rpc('claim_orders', { p_tokens: [token, ...myTokens()].slice(0, 50) });
      load();
    };
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setTimeout(() => use(session), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [token, load]);
  async function act(fn, done) {
    setBusy(true);
    setErr('');
    const { error } = await supabase.rpc(fn, { p_token: token });
    setBusy(false);
    if (error) setErr(errText(error));
    else {
      setMsg(done);
      kick();
      load();
    }
  }
  // Pay online and ShopDesk Delivery: what this order can do (nothing, until Admin switches them on)
  const [pay, setPay] = useState(null);
  const [paying, setPaying] = useState(false);
  const [sh, setSh, refreshShip] = useShipment({ token });
  const status = o && o.status;
  useEffect(() => {
    if (!status) return;
    supabase.rpc('order_money', { p_token: token }).then(({ data, error }) => {
      if (error || !data) return;
      setPay(data);
      if (data.shipment) setSh(data.shipment);
    });
  }, [token, status, o && o.amount_paid, o && o.delivery_fee, setSh]);
  // the courier's latest, when the delivery is on its way
  const shipping = !!sh && status === 'out';
  const onlineOnly = !!pay && pay.online_only; // a ShopDesk Delivery order: paid online, never by transfer to the shop
  // the shop's own rider sharing their location
  const [live] = useLiveRider({ token, on: status === 'out' && !sh && !!o && o.mode === 'delivery' });
  useEffect(() => {
    if (!shipping) return undefined;
    refreshShip();
    const t = setInterval(refreshShip, 60000);
    return () => clearInterval(t);
  }, [shipping, refreshShip]);
  // back from paying online: check the payment, then tidy the address bar
  useEffect(() => {
    const back = backFromPay(window.location.search);
    if (!back) return;
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash);
    if (back.stopped) {
      setErr("The payment wasn't finished. Nothing was taken. Try again when you're ready.");
      return;
    }
    const ref = back.ref;
    money('check', { reference: ref })
      .then((r) => {
        if (r.paid) {
          setJustPaid(true);
          kick();
        } else setErr("We couldn't see that payment yet. If money left your account, it shows here shortly.");
        load();
      })
      .catch((e) => setErr(e.message));
  }, [load]);
  const hows = howsFor(onlineOnly);
  const chosen = hows.includes(how) ? how : lastHow(hows);
  async function payOnline() {
    setPaying(true);
    setErr('');
    keepHow(chosen);
    try {
      const r = await money('pay', { token, how: chosen });
      window.location.assign(r.url);
    } catch (e) {
      setErr(e.message);
      setPaying(false);
    }
  }
  useBusy(o === undefined && !loadErr);
  // the Shop and Cart tabs go to this order's shop
  const shopOf = o && o.shop;
  useEffect(() => {
    if (shopOf) rememberShop(shopOf.slug, shopOf.name);
  }, [shopOf]);
  const tabs = <CustomerTabs active="orders" unread={inbox.count} shopNews={inbox.shopCount} />;
  if (o === undefined)
    return (
      <Page back="/orders" tabs={tabs}>
        {loadErr ? (
          <LoadError error={loadErr} onRetry={load} what="your order" />
        ) : (
          <Skeleton kind="page" />
        )}
      </Page>
    );
  if (!o)
    return (
      <Page back="/orders" tabs={tabs}>
        <div className="center">
          <h2>Order not found</h2>
          <p className="note">Check the link. If you ordered with another email, sign in with that one.</p>
        </div>
      </Page>
    );

  const pickup = o.mode === 'pickup';
  const items = (o.items || []).map((i) => `${i.qty} × ${i.name}`).join(', ');
  const feeWait = o.mode === 'delivery' && o.delivery_paid_by === 'customer' && o.delivery_fee == null;
  const left = Math.max(0, o.to_pay - o.amount_paid);
  const unpaid = o.status === 'awaiting' || o.status === 'part';
  const late = o.status === 'out' && o.deliver_by && new Date(o.deliver_by) < new Date();
  const canReceive =
    o.status === 'out' ||
    (o.status === 'paid' && pickup) ||
    (o.status === 'delivered' && o.received_by !== 'customer');
  const headline = headlineFor(o, pickup, feeWait);
  const steps = [
    { title: 'Order placed', at: o.created_at },
    { title: `Confirmed by ${o.shop.name}`, at: o.confirmed_at },
    { title: 'Payment confirmed', at: o.paid_at },
    {
      title: pickup ? 'Ready for pick-up' : 'On the way',
      at: o.out_at,
      extra: o.deliver_by
        ? pickup
          ? `from ${whenText(o.deliver_by).replace(' by ', ', ')}`
          : `arriving ${whenText(o.deliver_by)}`
        : '',
    },
    {
      title: pickup ? 'Collected' : 'Delivered',
      at: o.status === 'delivered' ? o.received_at || o.done_at : null,
      extra:
        o.status === 'delivered'
          ? o.received_by === 'customer'
            ? 'you confirmed it'
            : 'the shop marked it; please confirm'
          : '',
    },
  ];
  // ShopDesk Delivery: the courier's own steps take the place of "On the way" and "Delivered"
  if (sh && o.paid_at) {
    const done = o.status === 'delivered';
    const courierSteps = (sh.steps || []).map((s) => ({ title: s.status, at: s.at || o.out_at }));
    steps.splice(3, 2, ...(courierSteps.length ? courierSteps : [{ title: `Booked with ${sh.courier}`, at: o.out_at }]));
    if (!courierSteps.some((s) => /deliver/i.test(s.title)))
      steps.push({
        title: 'Delivered',
        at: done ? o.received_at || o.done_at : null,
        extra: done || !o.deliver_by ? '' : `arriving ${whenText(o.deliver_by)}`,
      });
  }
  const current = o.status === 'cancelled' ? -1 : steps.findIndex((s) => !s.at);
  // Orders from before accounts have no owner; anyone with the link can update those (the database still refuses shop accounts).
  const canAct = o.mine || !o.saved;
  // the transfer details and "I've sent the money" are for paying straight to the shop only
  const payingOnline = onlineOnly || (!!pay && pay.online && canAct && chosen !== 'shop');
  const wantsCustomer =
    o.status !== 'cancelled' && (canReceive || (unpaid && !feeWait && !o.customer_says_paid));
  const gate = wantsCustomer && !canAct && who !== undefined;
  const canComplain = o.can_report && !complaining && !o.report_block;
  // While it's on its way, who is bringing it sits under the latest step; "I got everything" sits under the last step.
  const riderStep = o.status === 'out' && !pickup ? steps.map((s) => !!s.at).lastIndexOf(true) : -1;
  const receiveStep = canReceive && canAct ? steps.length - 1 : -1;
  const riderBox = sh ? (
    <CourierRider sh={sh} />
  ) : (
    <div className="step-box">
      <LiveRiderCard live={live} name={o.rider_name} />
      <div className="row">
        <div className="who">
          <strong>{o.rider_name}</strong>
          <span className="sub">{o.rider_phone}</span>
        </div>
        <a className="btn small" href={telLink(o.rider_phone)} style={{ textDecoration: 'none' }}>
          Call
        </a>
      </div>
    </div>
  );
  const receiveBox = (
    <div className="step-box">
      <span className="ask">
        {o.status === 'delivered' ? 'Got everything?' : pickup ? 'Collected it?' : 'Got it?'}
      </span>
      <button className="btn" onClick={() => act('customer_received', 'Thanks! Enjoy.')} disabled={busy}>
        I got everything
      </button>
      {canComplain && (
        <button className="btn small ghost" onClick={() => setComplaining(true)}>
          {late ? "It didn't arrive" : 'Something wrong?'}
        </button>
      )}
    </div>
  );
  if (justPaid)
    return (
      <Page title={o.shop.name} titleHref={'/' + o.shop.slug} back="/orders" tabs={tabs}>
        <PaidScreen o={o} pickup={pickup} onView={() => setJustPaid(false)} />
      </Page>
    );
  return (
    <Page title={o.shop.name} titleHref={'/' + o.shop.slug} back="/orders" tabs={tabs}>
      {askFirst && o.pay_token && left > 0 && (
        <section className="card ask-first">
          <div className="row">
            <h2>Send the pay link</h2>
            <button className="linkbtn" onClick={() => setAskFirst(false)}>
              Not now
            </button>
          </div>
          <AskToPay o={o} left={left} big />
        </section>
      )}
      <section className="card">
        <div className="row">
          <span className="order-id">
            Order <span className="ocode">{o.code || '#' + o.order_id}</span>
          </span>
          {late && <span className="chip owe">Running late</span>}
          {o.receipt && (
            <button className="linkbtn rc-link" onClick={() => setShowReceipt(true)}>
              Receipt
            </button>
          )}
        </div>
        <h2 style={{ margin: 0 }}>{headline}</h2>
        {o.status === 'cancelled' && (
          <p className="note">
            {CANCELLED[o.cancel_reason] || 'Cancelled by the shop.'}
            {o.cancel_note ? ` “${o.cancel_note}”` : ''}
          </p>
        )}
        <p className="note">{items}</p>
        {(o.discount > 0 || o.note) && (
          <div className="o-extras">
            {o.discount > 0 && (
              <div className="o-off">
                <span>{o.coupon ? 'Code ' + o.coupon : 'Discount'}</span>
                <span className="num">−{naira(o.discount)}</span>
              </div>
            )}
            {o.note && (
              <div className="o-note">
                <span className="label">Your note to the shop</span>
                <span>{o.note}</span>
              </div>
            )}
          </div>
        )}
        {pay && pay.delivery_by === 'shopdesk' && pay.courier && !sh && o.status !== 'cancelled' && (
          <p className="note">Delivered by {pay.courier} with ShopDesk Delivery.</p>
        )}
      </section>

      {gate &&
        (who === '' ? (
          <section className="card boxed">
            <SignIn
              compact
              title="Sign in to update this order"
              path={'/o/' + token}
              note="Use the email you ordered with."
            />
          </section>
        ) : (
          <section className="card boxed">
            <p className="note">{who} didn't place this order.</p>
          </section>
        ))}

      {msg && <p className="ok">{msg}</p>}
      {err && <p className="err">{err}</p>}

      {unpaid &&
        (feeWait || (pay && pay.wait) ? (
          <p className="note">
            {pay && pay.wait
              ? 'The shop is picking your courier.'
              : 'The shop is setting your delivery fee.'}
          </p>
        ) : (
          <section className="card">
            {onlineOnly && !(pay.online && canAct) && (
              <p className="note">
                {canAct
                  ? "Paying online isn't available for this order right now. Message the shop."
                  : 'This order is paid online by the person who placed it.'}
              </p>
            )}
            {pay && pay.online && canAct && (
              <div className="pay-online">
                <PayWith list={hows} value={chosen} onChange={setHow} disabled={paying} />
                {chosen !== 'shop' && (
                  <button className={'btn' + (paying ? ' busy' : '')} onClick={payOnline} disabled={paying}>
                    {paying ? 'Opening payment…' : `Pay ${naira(left + serviceFee(pay))}`}
                  </button>
                )}
              </div>
            )}
            {!payingOnline && (
              <>
                <div className="slip pay-slip">
                  <div className="pay-line">
                    <div>
                      <div className="label">Account number</div>
                      <span className="acct">{o.shop.account_number}</span>
                    </div>
                    <button
                      className="btn small"
                      onClick={() => copyText(o.shop.account_number, setCopied, 'Account number copied.')}
                    >
                      Copy
                    </button>
                  </div>
                  <div className="pay-line">
                    <div>
                      <div className="label">Amount</div>
                      <span className="acct">{naira(left)}</span>
                    </div>
                    <button
                      className="btn small"
                      onClick={() => copyText(String(left), setCopied, 'Amount copied.')}
                    >
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
                {copied && (
                  <p className="ok" role="status">
                    {copied}
                  </p>
                )}
              </>
            )}
            {!payingOnline &&
              (o.customer_says_paid ? (
                <p className="ok">The shop is told. They confirm when it lands.</p>
              ) : (
                canAct && (
                  <button className="btn ghost" onClick={() => act('customer_says_paid', '')} disabled={busy}>
                    I've sent the money
                  </button>
                )
              ))}
            {o.pay_token && <AskToPay o={o} left={left} />}
          </section>
        ))}
      {o.can_cancel &&
        (cancelling ? (
          <section className="card boxed">
            <p className="note">Cancel this order?</p>
            <div className="btns">
              <button
                className="btn small"
                disabled={busy}
                onClick={() => {
                  setCancelling(false);
                  act('customer_cancel', 'Cancelled.');
                }}
              >
                Yes, cancel it
              </button>
              <button className="btn small ghost" onClick={() => setCancelling(false)}>
                No
              </button>
            </div>
          </section>
        ) : (
          <div className="btns">
            <button className="linkbtn" onClick={() => setCancelling(true)}>
              Cancel order
            </button>
          </div>
        ))}

      <section className="card">
        <h2>Progress</h2>
        <ol className="timeline">
          {steps.map((s, i) => (
            <li key={i} className={s.at ? 'done' : i === current ? 'now' : ''}>
              <strong>{s.title}</strong>
              {s.at && <span className="sub">{atText(s.at)}</span>}
              {s.extra && <span className="sub">{s.extra}</span>}
              {i === riderStep && riderBox}
              {i === receiveStep && receiveBox}
            </li>
          ))}
        </ol>
      </section>

      {o.can_report && o.report_block && !o.problem && <p className="note">{o.report_block}</p>}
      {complaining && o.can_report && !o.report_block && (
        <ReportProblemForm
          orderId={o.order_id}
          token={token}
          late={late}
          onCancel={() => setComplaining(false)}
          onDone={() => {
            setComplaining(false);
            setMsg('Sent. The shop has 48 hours to answer.');
            kick();
            load();
          }}
        />
      )}
      {o.problem && <CustomerProblem p={o.problem} token={token} reload={load} setMsg={setMsg} />}
      {o.mine && o.status === 'delivered' && <RateShop token={token} shopName={o.shop.name} slug={o.shop.slug} />}

      {o.mine && uid && <AlertsPrompt who="customer" userId={uid} />}
      {showReceipt && o.receipt && <ReceiptSheet r={receiptFromOrderPage(o)} onClose={() => setShowReceipt(false)} />}

      {o.mine && (o.can_chat || chat) && (
        <section className="card chat-card" ref={chatRef} id="chat">
          <button className="chat-toggle" onClick={() => setChat(!chat)} aria-expanded={chat}>
            <strong>Chat with {o.shop.name}</strong>
            {!chat && unread.chats[o.order_id] > 0 && (
              <span className="badge">{unread.chats[o.order_id]}</span>
            )}
            {chat && <span className="sub">Hide</span>}
          </button>
          {chat && (
            <Chat
              orderId={o.order_id}
              me="customer"
              canReport
              open={o.can_chat}
              payAccount={o.shop.account_number}
              onSeen={() => unread.markRead(o.order_id, 'message')}
            />
          )}
        </section>
      )}

      {!canReceive && canComplain && (
        <section className="card">
          <p className="note">Something wrong? Report it until {atText(o.report_until)}.</p>
          <button className="btn ghost" onClick={() => setComplaining(true)}>
            Report a problem
          </button>
        </section>
      )}

      {!o.mine && who === '' && !gate ? (
        <p className="note" style={{ fontSize: 12 }}>
          <a href="/orders">Sign in</a> to see your orders.
        </p>
      ) : null}

      <a
        className="btn ghost"
        href={'/' + o.shop.slug}
        style={{ textAlign: 'center', textDecoration: 'none' }}
      >
        Order something else
      </a>
      <footer className="page-foot">
        <button className="linkbtn" onClick={() => setReporting(!reporting)} aria-expanded={reporting}>
          Report this shop
        </button>
        <span aria-hidden="true">·</span>
        <a href="/privacy">Privacy</a>
        <span aria-hidden="true">·</span>
        <a href="/terms">Terms</a>
      </footer>
      {reporting && (
        <ReportShopForm
          slug={o.shop.slug}
          token={token}
          code={o.code}
          signedIn={who !== ''}
          path={'/o/' + token}
          done={() => setReporting(false)}
        />
      )}
      <InboxToast inbox={inbox} />
    </Page>
  );
}
