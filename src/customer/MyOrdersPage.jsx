// /orders: every order a customer has placed (updating live, with a dot on orders with news).
// /account: the name, phone and address they saved, email alerts and signing out.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { dayOf, whenText } from '../lib/dates.js';
import { errText, navigate } from '../lib/helpers.js';
import { signOut } from '../lib/alerts.js';
import { useInbox, InboxToast } from './inbox.jsx';
import { Page } from '../shared/Page.jsx';
import { Skeleton } from '../shared/Skeleton.jsx';
import { useBusy } from '../lib/busy.js';
import { LoadError } from '../shared/LoadError.jsx';
import { EmailSwitch } from '../shared/EmailSwitch.jsx';
import { SignIn } from '../shared/SignIn.jsx';
import { AlertsPrompt } from '../shared/AlertsPrompt.jsx';
import { myTokens } from './savedOrders.js';

// The label on each order in the list: [colour, words].
function orderLabel(o) {
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

// A customer's orders with ShopDesk shops (view 'orders') or their account (view 'account').
export function MyOrdersPage({ view = 'orders' }) {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const title = view === 'account' ? 'Account' : 'My orders';
  useBusy(session === undefined);
  if (session === undefined)
    return (
      <Page title={title} kind="me">
        <Skeleton kind={view === 'account' ? 'page' : 'list'} />
      </Page>
    );
  if (!session)
    return (
      <Page title={title} kind="me">
        <SignIn
          title="Your orders"
          path={view === 'account' ? '/account' : '/orders'}
          note="Sign in to follow your orders."
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

// how many past orders show at first, and how many more each "Show older orders" adds
const PAST_STEP = 10;

// What was on screen last time, so coming back from an order shows the list straight away while it refreshes.
// Kept in memory only (gone when the tab closes) and only for the same account.
let last = null;

function SignedInOrders({ email, userId, view }) {
  const seen = last && last.userId === userId ? last : null;
  const [orders, setOrders] = useState(seen ? seen.orders : null);
  const [pastShown, setPastShown] = useState(seen ? seen.pastShown : PAST_STEP);
  // saved details are shown as text; Edit opens a copy in the form, so the minute refresh never overwrites typing
  const [me, setMe] = useState(seen ? seen.me : { name: '', phone: '', address: '' });
  const [draft, setDraft] = useState(null); // null: not editing
  const [confirmForget, setConfirmForget] = useState(false);
  const [had, setHad] = useState(seen ? seen.had : false);
  useEffect(() => {
    last = { userId, orders, pastShown, me, had };
  }, [userId, orders, pastShown, me, had]);
  async function leave() {
    last = null;
    await signOut();
    navigate('/orders', { replace: true });
  }
  const [msg, setMsg] = useState('');
  const [isShop, setIsShop] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  const load = useCallback(async () => {
    const { data: a } = await supabase.rpc('my_account');
    if (a && a.vendor) {
      setIsShop(true);
      return;
    }
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
  useBusy(orders === null && !loadErr && !isShop);
  if (isShop)
    return (
      <Page
        title="My orders"
        kind="me"
        right={
          <button className="linkbtn" onClick={leave}>
            Sign out
          </button>
        }
      >
        <section className="card">
          <h2>This email runs a shop</h2>
          <p className="note">{email} runs a shop. Use another email to shop.</p>
          <div className="btns">
            <a className="btn small" href="/" style={{ textDecoration: 'none' }}>
              Open my shop
            </a>
            <button className="linkbtn" onClick={leave}>
              Sign out
            </button>
          </div>
        </section>
      </Page>
    );
  const live = (orders || []).filter(
    (o) =>
      !['delivered', 'cancelled'].includes(o.status) ||
      (o.status === 'delivered' && o.received_by !== 'customer') ||
      ['open', 'answered', 'with_shopdesk'].includes(o.problem),
  );
  const past = (orders || []).filter((o) => !live.includes(o));
  const row = (o) => {
    const [tone, label] = orderLabel(o);
    return (
      <a key={o.token} className="card boxed orow" href={'/o/' + o.token}>
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
  };
  // the round badge: the first letter of their email
  const initial = ((email || '').trim()[0] || '?').toUpperCase();
  if (view === 'account')
    return (
      <Page
        title="Account"
        kind="me"
        right={
          <a className="top-link" href="/orders">
            My orders
          </a>
        }
      >
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
                {me.address && <span>{me.address}</span>}
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
              <div className="field">
                <label htmlFor="mAddr">Delivery address</label>
                <input
                  id="mAddr"
                  value={draft.address}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                  placeholder="Street, area and a landmark"
                  autoComplete="street-address"
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
                    <span>Delete your saved name, phone number and address?</span>
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
        <section className="card">
          <EmailSwitch />
        </section>
        <button className="btn ghost" onClick={leave}>
          Sign out
        </button>
      </Page>
    );
  const olderLeft = past.length - pastShown;
  return (
    <Page
      title="My orders"
      kind="me"
      right={
        <a className="avatar" href="/account" aria-label="Account" title="Account">
          {initial}
        </a>
      }
    >
      {msg && <p className="note">{msg}</p>}
      <AlertsPrompt who="customer" userId={userId} />
      {orders === null ? (
        loadErr ? (
          <LoadError error={loadErr} onRetry={load} what="your orders" compact />
        ) : (
          <Skeleton kind="list" />
        )
      ) : !orders.length ? (
        <section className="card">
          <h2>No orders yet</h2>
          <p className="note">Your orders will show here.</p>
        </section>
      ) : (
        <>
          {live.length > 0 && (
            <>
              <h2>In progress</h2>
              {live.map(row)}
            </>
          )}
          {past.length > 0 && (
            <>
              <h2>Past orders</h2>
              {past.slice(0, pastShown).map(row)}
              {olderLeft > 0 && (
                <button className="btn ghost" onClick={() => setPastShown(pastShown + PAST_STEP)}>
                  Show older orders
                </button>
              )}
            </>
          )}
        </>
      )}
      <InboxToast inbox={inbox} />
    </Page>
  );
}
