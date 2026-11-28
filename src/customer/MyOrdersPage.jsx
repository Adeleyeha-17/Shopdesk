// /orders: orders on their way (updating live, with a dot on orders with news), with Order history one tap away.
// Carts are on the Cart tab, Help and Account have their own tabs.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { dayOf, whenText } from '../lib/dates.js';
import { useInbox, InboxToast } from './inbox.jsx';
import { Page } from '../shared/Page.jsx';
import { Skeleton } from '../shared/Skeleton.jsx';
import { useBusy } from '../lib/busy.js';
import { LoadError } from '../shared/LoadError.jsx';
import { SignIn } from '../shared/SignIn.jsx';
import { AlertsPrompt } from '../shared/AlertsPrompt.jsx';
import { myTokens } from './savedOrders.js';
import { CustomerTabs } from './CustomerTabs.jsx';
import { lastShop, rememberShop } from './myShops.js';
import { Empty } from '../shared/Empty.jsx';

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

// A customer's orders with ShopDesk shops.
export function MyOrdersPage() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const tabs = <CustomerTabs active="orders" />;
  useBusy(session === undefined);
  if (session === undefined)
    return (
      <Page title="My orders" kind="me" tabs={tabs}>
        <Skeleton kind="list" />
      </Page>
    );
  if (!session)
    return (
      <Page title="My orders" kind="me" tabs={tabs}>
        <SignIn
          title="Your orders"
          path="/orders"
          note="Sign in to follow your orders."
          footer={
            <p className="note" style={{ fontSize: 12 }}>
              <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
            </p>
          }
        />
      </Page>
    );
  return <SignedInOrders userId={session.user.id} />;
}

// What was on screen last time, so coming back from an order shows the list straight away while it refreshes.
// Kept in memory only (gone when the tab closes) and only for the same account.
let last = null;

function SignedInOrders({ userId }) {
  const seen = last && last.userId === userId ? last : null;
  const [orders, setOrders] = useState(seen ? seen.orders : null);
  useEffect(() => {
    last = { userId, orders };
  }, [userId, orders]);
  const [loadErr, setLoadErr] = useState(null);
  const load = useCallback(async () => {
    await supabase.rpc('claim_orders', { p_tokens: myTokens() });
    const { data, error } = await supabase.rpc('my_orders');
    // a failed refresh keeps the list on screen; a failed first load shows "Try again"
    if (error) setLoadErr(error);
    else {
      setLoadErr(null);
      setOrders(data || []);
      // first time here without visiting a shop: the Shop tab goes to the shop of their latest order
      if (!lastShop() && data && data[0] && data[0].slug) rememberShop(data[0].slug, data[0].shop);
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
  useBusy(orders === null && !loadErr);
  const live = (orders || []).filter(isLive);
  const pastCount = (orders || []).length - live.length;
  return (
    <Page title="My orders" kind="me" tabs={<CustomerTabs active="orders" unread={inbox.count} shopNews={inbox.shopCount} />}>
      <AlertsPrompt who="customer" userId={userId} />
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
      {orders === null ? (
        loadErr ? (
          <LoadError error={loadErr} onRetry={load} what="your orders" compact />
        ) : (
          <Skeleton kind="list" />
        )
      ) : live.length ? (
        <div className="wide-grid orders-grid">
          {live.map((o) => (
            <OrderRow key={o.token} o={o} unread={unread} />
          ))}
        </div>
      ) : (
        <Empty
          kind="scooter"
          title="Nothing on the way"
          text={orders.length ? 'Orders you place show here until they reach you.' : 'Your orders will show here once you place one.'}
          action={['Find shops', '/shops']}
        />
      )}
      <InboxToast inbox={inbox} />
    </Page>
  );
}
