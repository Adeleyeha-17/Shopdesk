// /orders: Ongoing (orders on their way, updating live, with a dot on orders with news) and Carts (every shop with
// something in its cart), with Order history and Help one tap away. /orders/carts opens on Carts.
// /account: the name and phone they saved, their delivery addresses, Help, email alerts and signing out.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { dayOf, whenText } from '../lib/dates.js';
import { errText, navigate, setAddress } from '../lib/helpers.js';
import { signOut } from '../lib/alerts.js';
import { useInbox, InboxToast } from './inbox.jsx';
import { Page } from '../shared/Page.jsx';
import { Skeleton } from '../shared/Skeleton.jsx';
import { useBusy } from '../lib/busy.js';
import { LoadError } from '../shared/LoadError.jsx';
import { EmailSwitch } from '../shared/EmailSwitch.jsx';
import { ThemePicker } from '../shared/ThemePicker.jsx';
import { SignIn } from '../shared/SignIn.jsx';
import { AlertsPrompt } from '../shared/AlertsPrompt.jsx';
import { myTokens } from './savedOrders.js';
import { CustomerTabs } from './CustomerTabs.jsx';
import { lastShop, rememberShop } from './myShops.js';
import { Carts, useCarts } from './Carts.jsx';
import { Empty } from '../shared/Empty.jsx';
import { AccountAddresses } from './Addresses.jsx';

// The label on each order in the list: [colour, words]. (The Shops tab uses it too.)
export function orderLabel(o) {
  // a problem the customer reported comes first while it's open
  if (o.problem === 'open') return ['warn', 'Problem · waiting for the shop'];
  if (o.problem === 'answered') return ['new', 'Problem · the shop answered'];
  if (o.problem === 'with_shopdesk') return ['warn', 'Problem · with ShopDesk'];
  if (o.status === 'cancelled') return ['done', 'Cancelled'];
  if (o.status === 'delivered') {
    if (o.received_by !== 'customer') return ['paid', 'Delivered · please confirm'];
    return ['paid', o.mode === 'pickup' ? 'Collected' : 'Delivered'];
  }
  if (o.status === 'out')
    return ['new', o.mode === 'pickup' ? 'Ready to collect' : 'Arriving ' + whenText(o.deliver_by)];
  if (o.status === 'paid') return ['paid', 'Paid · being packed'];
  return ['owe', 'Waiting for payment'];
}

// One order in a list (Ongoing, Order history): the shop, where it stands, what was in it, its code, day and total.
export function OrderRow({ o, unread }) {
  const [tone, label] = orderLabel(o);
  return (
    <a className="card boxed orow" href={'/o/' + o.token}>
      <div className="row">
        <strong>
          {o.shop}
          {unread.byOrder[o.order_id] > 0 && (
            <span className="newdot" aria-label={unread.chats[o.order_id] ? 'New message' : 'New update'} />
          )}
        </strong>
        <span className={'chip ' + tone}>{label}</span>
      </div>
      {unread.chats[o.order_id] > 0 && <div className="sub newmsg">New message</div>}
      <div className="items">{o.items}</div>
      <div className="row">
        <span className="order-id">
          {o.code || '#' + o.order_id} · {dayOf(o.created_at)}
        </span>
        <span className="num">{naira(o.to_pay)}</span>
      </div>
    </a>
  );
}

// still on its way, or still needs the customer (confirm delivery, an open problem)
export const isLive = (o) =>
  !['delivered', 'cancelled'].includes(o.status) ||
  (o.status === 'delivered' && o.received_by !== 'customer') ||
  ['open', 'answered', 'with_shopdesk'].includes(o.problem);

// A customer's orders with ShopDesk shops (view 'orders' or 'carts') or their account (view 'account').
export function MyOrdersPage({ view = 'orders' }) {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const title = view === 'account' ? 'Account' : 'My orders';
  const tabs = <CustomerTabs active={view === 'account' ? 'account' : 'orders'} />;
  const back = view === 'account' ? '/account' : view === 'carts' ? '/orders/carts' : '/orders';
  useBusy(session === undefined);
  if (session === undefined)
    return (
      <Page title={title} kind="me" tabs={tabs}>
        <Skeleton kind={view === 'account' ? 'page' : 'list'} />
      </Page>
    );
  if (!session)
    return (
      <Page title={title} kind="me" tabs={tabs}>
        <SignIn
          title={view === 'account' ? 'Your account' : 'Your orders'}
          path={back}
          note={view === 'account' ? 'Sign in to see your details and orders.' : 'Sign in to follow your orders.'}
          footer={
            <p className="note" style={{ fontSize: 12 }}>
              <a href="/privacy">Privacy</a>
            </p>
          }
        />
      </Page>
    );
  return <SignedInOrders email={session.user.email} userId={session.user.id} view={view} />;
}

// What was on screen last time, so coming back from an order shows the list straight away while it refreshes.
// Kept in memory only (gone when the tab closes) and only for the same account.
let last = null;

function SignedInOrders({ email, userId, view }) {
  const seen = last && last.userId === userId ? last : null;
  const [orders, setOrders] = useState(seen ? seen.orders : null);
  // saved details are shown as text; Edit opens a copy in the form, so the minute refresh never overwrites typing
  const [me, setMe] = useState(seen ? seen.me : { name: '', phone: '', address: '' });
  const carts = useCarts();
  const [seg, setSeg] = useState(view === 'carts' ? 'carts' : null); // null: Ongoing, or Carts when nothing is on its way
  const [draft, setDraft] = useState(null); // null: not editing
  const [confirmForget, setConfirmForget] = useState(false);
  const [had, setHad] = useState(seen ? seen.had : false);
  useEffect(() => {
    last = { userId, orders, me, had };
  }, [userId, orders, me, had]);
  async function leave() {
    last = null;
    await signOut();
    navigate('/orders', { replace: true });
  }
  const [msg, setMsg] = useState('');
  const [loadErr, setLoadErr] = useState(null);
  const load = useCallback(async () => {
    await supabase.rpc('claim_orders', { p_tokens: myTokens() });
    const [{ data, error }, c] = await Promise.all([
      supabase.rpc('my_orders'),
      supabase.from('customers').select('name, phone, address').maybeSingle(),
    ]);
    // a failed refresh keeps the list on screen; a failed first load shows "Try again"
    if (error) setLoadErr(error);
    else {
      setLoadErr(null);
      setOrders(data || []);
      // first time here without visiting a shop: the Shop tab goes to the shop of their latest order
      if (!lastShop() && data && data[0] && data[0].slug) rememberShop(data[0].slug, data[0].shop);
    }
    if (c.data) {
      setMe(c.data);
      setHad(true);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);
  // live: an order moves or a shop writes; a pop-up opens that chat
  const inbox = useInbox(userId, { onAlert: () => load(), title: 'My orders' });
  const unread = inbox.unread;
  async function save() {
    const row = {
      name: draft.name.trim().slice(0, 60),
      phone: draft.phone.trim().slice(0, 20),
      address: draft.address.trim().slice(0, 160),
    };
    const { error } = had
      ? await supabase
          .from('customers')
          .update({ ...row, updated_at: new Date().toISOString() })
          .not('user_id', 'is', null)
      : await supabase.from('customers').insert({ user_id: userId, ...row });
    if (error) setMsg(errText(error));
    else {
      setMe(row);
      setHad(true);
      setDraft(null);
      setMsg('');
    }
  }
  async function forget() {
    await supabase.from('customer_addresses').delete().not('user_id', 'is', null);
    const { error } = await supabase.from('customers').delete().not('user_id', 'is', null);
    if (error) setMsg(errText(error));
    else {
      setHad(false);
      setMe({ name: '', phone: '', address: '' });
      setDraft(null);
      setConfirmForget(false);
      setMsg('');
    }
  }
  useBusy(orders === null && !loadErr);
  const live = (orders || []).filter(isLive);
  const pastCount = (orders || []).length - live.length;
  const shown = seg || (live.length || !carts.length ? 'ongoing' : 'carts');
  function pick(k) {
    setSeg(k);
    setAddress(k === 'carts' ? '/orders/carts' : '/orders');
  }
  // the round letter on the Account page: the first letter of their email
  const initial = ((email || '').trim()[0] || '?').toUpperCase();
  if (view === 'account')
    return (
      <Page title="Account" kind="me" tabs={<CustomerTabs active="account" unread={inbox.count} shopNews={inbox.shopCount} />}>
        <section className="card boxed profile">
          <span className="avatar big" aria-hidden="true">
            {initial}
          </span>
          <div>
            <span className="sub">Signed in as</span>
            <strong>{email}</strong>
          </div>
        </section>
        {msg && <p className="note">{msg}</p>}
        <section className="card">
          <div className="row">
            <h2>Your details</h2>
            {!draft && (
              <button
                className="btn small ghost"
                onClick={() => {
                  setDraft({ ...me });
                  setConfirmForget(false);
                }}
              >
                {had ? 'Edit' : 'Add'}
              </button>
            )}
          </div>
          {!draft ? (
            had && (
              <div className="saved-details">
                {me.name && <strong>{me.name}</strong>}
                {me.phone && <span>{me.phone}</span>}
              </div>
            )
          ) : (
            <div className="stack-sm">
              <div className="field">
                <label htmlFor="mName">Name</label>
                <input
                  id="mName"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  autoComplete="name"
                />
              </div>
              <div className="field">
                <label htmlFor="mPhone">Phone number</label>
                <input
                  id="mPhone"
                  inputMode="tel"
                  autoComplete="tel"
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                />
              </div>
              <div className="btns">
                <button className="btn small" onClick={save}>
                  Save
                </button>
                <button className="linkbtn" onClick={() => setDraft(null)}>
                  Cancel
                </button>
              </div>
              {had &&
                (confirmForget ? (
                  <div className="confirm-del" role="alert">
                    <span>Delete your saved name, phone number and addresses?</span>
                    <div className="btns">
                      <button className="btn small bad" onClick={forget}>
                        Delete
                      </button>
                      <button className="linkbtn" onClick={() => setConfirmForget(false)}>
                        Keep them
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="danger-row" onClick={() => setConfirmForget(true)}>
                    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                      <path
                        d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Delete my saved details
                  </button>
                ))}
            </div>
          )}
        </section>
        <AccountAddresses userId={userId} />
        <a className="card boxed hist-row" href="/help">
          <span className="hist-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01" />
            </svg>
          </span>
          <strong>Help</strong>
          <span className="sub" aria-hidden="true">›</span>
        </a>
        <ThemePicker />
        <section className="card">
          <EmailSwitch />
        </section>
        <button className="btn ghost" onClick={leave}>
          Sign out
        </button>
      </Page>
    );
  return (
    <Page title="My orders" kind="me" tabs={<CustomerTabs active="orders" unread={inbox.count} shopNews={inbox.shopCount} />}>
      {msg && <p className="note">{msg}</p>}
      <AlertsPrompt who="customer" userId={userId} />
      <div className="seg wide" role="group" aria-label="Orders">
        <button aria-pressed={shown === 'ongoing'} onClick={() => pick('ongoing')}>
          Ongoing{live.length > 0 && <span className="count">{live.length}</span>}
        </button>
        <button aria-pressed={shown === 'carts'} onClick={() => pick('carts')}>
          Carts{carts.length > 0 && <span className="count">{carts.length}</span>}
        </button>
      </div>
      <a className="card boxed hist-row" href="/orders/history">
        <span className="hist-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4M12 7.5V12l3 2" />
          </svg>
        </span>
        <strong>Order history</strong>
        {pastCount > 0 && <span className="sub">{pastCount}</span>}
        <span className="sub" aria-hidden="true">›</span>
      </a>
      {shown === 'carts' ? (
        <Carts carts={carts} />
      ) : orders === null ? (
        loadErr ? (
          <LoadError error={loadErr} onRetry={load} what="your orders" compact />
        ) : (
          <Skeleton kind="list" />
        )
      ) : live.length ? (
        live.map((o) => <OrderRow key={o.token} o={o} unread={unread} />)
      ) : (
        <Empty
          kind="scooter"
          title="Nothing on the way"
          text={orders.length ? 'Orders you place show here until they reach you.' : 'Your orders will show here once you place one.'}
          action={['Find shops', '/shops']}
        />
      )}
      <a className="help-link" href="/help">
        Need help with an order? <strong>Get help</strong>
      </a>
      <InboxToast inbox={inbox} />
    </Page>
  );
}
