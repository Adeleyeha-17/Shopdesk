// The vendor's app at "/". Signs the vendor in, sends new vendors to "Set up your shop",
// then shows the four tabs at the bottom: Sales, Orders, Stock and Shop.
// Everything updates by itself: a new order, money in or a message arrives the moment it happens (live alerts),
// and the app opens straight on an order or its chat when a phone alert is tapped (/?order=12 or /?chat=12).
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { DAY } from '../lib/dates.js';
import { errText, errInfo } from '../lib/helpers.js';
import { problemState } from '../lib/problems.js';
import { withOptions } from '../lib/products.js';
import { kick, useCount, useLive, useUnread } from '../lib/alerts.js';
import { SignIn } from '../shared/SignIn.jsx';
import { LoadError } from '../shared/LoadError.jsx';
import { AlertsPrompt } from '../shared/AlertsPrompt.jsx';
import { Toast, useToast } from '../shared/Toast.jsx';
import { VendorFrame } from './VendorFrame.jsx';
import { SetUpShop } from './SetUpShop.jsx';
import { StatusBanner, PlanBanner, ShopDeskNotices, RefundBanner } from './Banners.jsx';
import { SalesTab } from './SalesTab.jsx';
import { OrdersTab } from './OrdersTab.jsx';
import { StockTab } from './StockTab.jsx';
import { ShopTab } from './ShopTab.jsx';

export function VendorApp() {
  const [session, setSession] = useState(undefined);
  const [shop, setShop] = useState(undefined);
  const [shopErr, setShopErr] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  // A bad connection must never look like "you have no shop": on an error the app keeps what it had and says why.
  const loadShop = useCallback(async () => {
    const { data, error } = await supabase.from('shops').select('*').maybeSingle();
    if (error) {
      setShopErr(error);
      return;
    }
    setShopErr(null);
    setShop(data);
  }, []);
  useEffect(() => {
    if (session) loadShop();
    else if (session === null) setShop(undefined);
  }, [session, loadShop]);
  useEffect(() => {
    if (session) supabase.rpc('is_admin').then(({ data }) => setIsOwner(!!data));
    else setIsOwner(false);
  }, [session]);

  if (session === undefined)
    return (
      <VendorFrame>
        <p className="note">Loading…</p>
      </VendorFrame>
    );
  if (!session) return <VendorSignIn />;
  if (shop === undefined)
    return (
      <VendorFrame>
        {shopErr ? (
          <LoadError error={shopErr} onRetry={loadShop} what="your shop" />
        ) : (
          <p className="note">Loading your shop…</p>
        )}
      </VendorFrame>
    );
  if (!shop)
    return (
      <SetUpShop userId={session.user.id} email={session.user.email} onDone={loadShop} isOwner={isOwner} />
    );
  return (
    <VendorTabs
      shop={shop}
      reloadShop={loadShop}
      email={session.user.email}
      userId={session.user.id}
      isOwner={isOwner}
    />
  );
}

function VendorSignIn() {
  return (
    <VendorFrame>
      <SignIn
        title="Sign in to your shop"
        note="No password needed."
        path="/"
        footer={
          <div className="signin-foot">
            <p>
              <strong>New here?</strong> The same code also opens your shop.
            </p>
            <p className="fine">
              By signing in you agree to the <a href="/privacy">shop rules</a>.
            </p>
          </div>
        }
      />
    </VendorFrame>
  );
}

const TABS = [
  ['sales', 'Sales', 'M4 20V10M10 20V4M16 20v-7M22 20H2'],
  ['orders', 'Orders', 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6'],
  ['stock', 'Stock', 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10'],
  ['shop', 'Shop', 'M4 9l1-5h14l1 5M4 9h16v11H4zM9 20v-6h6v6'],
];

// Opened from a phone alert? /?order=12#orders shows that order; /?chat=12#orders opens its chat.
function focusFromUrl() {
  const q = new URLSearchParams(window.location.search);
  const id = Number(q.get('chat') || q.get('order'));
  if (!id) return null;
  window.history.replaceState(null, '', '/#orders');
  return { id, chat: q.has('chat') };
}

function VendorTabs({ shop, reloadShop, email, userId, isOwner }) {
  const [focus, setFocus] = useState(focusFromUrl);
  const [tab, setTab] = useState(() =>
    focus
      ? 'orders'
      : /^#(sales|orders|stock|shop)$/.test(window.location.hash)
        ? window.location.hash.slice(1)
        : 'sales',
  );
  const [data, setData] = useState({ products: [], orders: [], payments: [], problems: [], loaded: false });
  const [loadErr, setLoadErr] = useState(null);
  const [toast, say, closeToast] = useToast(3800);
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 60 * DAY).toISOString();
    const [p, o, pay, pr] = await Promise.all([
      supabase.from('products').select('*, product_options(*)').order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select('*, order_items(*)')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('payments')
        .select('*')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('problems').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    // if anything didn't load, keep what's on screen (never show an empty list by mistake) and say so
    const bad = [p, o, pay, pr].find((r) => r.error);
    if (bad) {
      setLoadErr(bad.error);
      return;
    }
    setLoadErr(null);
    setData({
      products: withOptions(p.data),
      orders: o.data || [],
      payments: pay.data || [],
      problems: pr.data || [],
      loaded: true,
    });
  }, []);
  const unread = useUnread(userId);
  useEffect(() => {
    load();
    supabase.rpc('touch_shop');
    kick();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);
  // Live: the moment a customer orders, pays, writes or reports a problem. A new message pops up with Open,
  // unless that chat is already open on screen.
  const openChat = useCallback((id) => {
    setTab('orders');
    setFocus({ id, chat: true, at: Date.now() });
  }, []);
  useLive(userId, (n) => {
    load();
    unread.reload();
    if (!n) return;
    if (n.kind === 'new_order') say(n.title + ' · ' + n.body);
    else if (n.kind === 'message' && !document.querySelector(`[data-chat-open="${n.order_id}"]`))
      say({ title: n.title, text: n.body, action: { label: 'Open', run: () => openChat(n.order_id) } });
  });
  useEffect(() => {
    window.history.replaceState(null, '', '#' + tab);
    window.scrollTo(0, 0);
  }, [tab]);
  useEffect(() => {
    if (shop.status !== 'pending') return undefined;
    const t = setInterval(reloadShop, 30000);
    return () => clearInterval(t);
  }, [shop.status, reloadShop]);
  const run = useCallback(
    async (fn, args, done) => {
      const { data: out, error } = await supabase.rpc(fn, args);
      if (error) {
        say(errText(error));
        return false;
      }
      if (done) say(typeof done === 'function' ? done(out) : done);
      kick();
      await load();
      return true;
    },
    [load, say],
  );
  // the red number on Orders: unpaid orders, problems waiting for the shop's answer, and chats with new messages
  const unpaid =
    data.orders.filter((o) => o.status === 'awaiting').length +
    data.problems.filter((p) => !p.reply && ['open', 'with_shopdesk'].includes(problemState(p))).length +
    Object.keys(unread.chats).length;
  useCount(unpaid, shop.name);
  const ctx = { shop, data, load, run, say, reloadShop, setTab, unread, focus, setFocus };
  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <div className="brand">
            <i aria-hidden="true" />
            ShopDesk
          </div>
          <div className="shop">
            {isOwner && (
              <a className="linkbtn" href="/admin" style={{ marginRight: 10 }}>
                Admin
              </a>
            )}
            {shop.name}
          </div>
        </div>
      </header>
      <main>
        <StatusBanner shop={shop} reloadShop={reloadShop} />
        <RefundBanner shop={shop} problems={data.problems} orders={data.orders} run={run} say={say} />
        <PlanBanner shop={shop} />
        <ShopDeskNotices />
        <AlertsPrompt who="shop" userId={userId} />
        {loadErr && data.loaded && (
          <div className="card boxed refresh-note" role="status">
            <span className="note">{errInfo(loadErr).text}</span>
            <button className="btn small ghost" onClick={load}>
              Try again
            </button>
          </div>
        )}
        {!data.loaded ? (
          loadErr ? (
            <LoadError error={loadErr} onRetry={load} what="your orders" />
          ) : (
            <p className="note">Loading…</p>
          )
        ) : tab === 'sales' ? (
          <SalesTab {...ctx} />
        ) : tab === 'orders' ? (
          <OrdersTab {...ctx} />
        ) : tab === 'stock' ? (
          <StockTab {...ctx} />
        ) : (
          <ShopTab {...ctx} email={email} />
        )}
      </main>
      <nav className="tabs" aria-label="Sections">
        <div className="tabs-in" role="tablist">
          {TABS.map(([k, label, d]) => (
            <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              <svg viewBox="0 0 24 24">
                <path d={d} />
              </svg>
              {label}
              {k === 'orders' && unpaid > 0 && <span className="badge">{unpaid}</span>}
            </button>
          ))}
        </div>
      </nav>
      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}
