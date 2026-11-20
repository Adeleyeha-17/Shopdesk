// /orders/history: Buy again (what they bought before, by shop, at today's prices, with + to put it back in the cart)
// and Past orders (finished orders, with filters by shop, time and status).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { photoUrl } from '../lib/photos.js';
import { navigate } from '../lib/helpers.js';
import { onSale, payPrice } from '../lib/products.js';
import { useBusy } from '../lib/busy.js';
import { Page } from '../shared/Page.jsx';
import { Skeleton } from '../shared/Skeleton.jsx';
import { LoadError } from '../shared/LoadError.jsx';
import { SignIn } from '../shared/SignIn.jsx';
import { Empty } from '../shared/Empty.jsx';
import { Toast, useToast } from '../shared/Toast.jsx';
import { CustomerTabs } from './CustomerTabs.jsx';
import { useInbox } from './inbox.jsx';
import { OrderRow, isLive } from './MyOrdersPage.jsx';
import { addOne, loadCart } from './cart.js';
import { useCarts } from './Carts.jsx';
import { rememberShop } from './myShops.js';

const STEP = 10; // past orders shown at first, and how many more each "Show older orders" adds
const WHEN = [
  ['any', 'Any time'],
  ['30', 'Last 30 days'],
  ['90', 'Last 3 months'],
  ['year', 'This year'],
];
const STATUS = [
  ['all', 'Any status'],
  ['done', 'Delivered or collected'],
  ['cancelled', 'Cancelled'],
  ['problem', 'Had a problem'],
];

export function OrderHistoryPage() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useBusy(session === undefined);
  if (!session)
    return (
      <Page title="Order history" back="/orders" kind="me" tabs={<CustomerTabs active="orders" />}>
        {session === undefined ? (
          <Skeleton kind="list" />
        ) : (
          <SignIn title="Your orders" path="/orders/history" note="Sign in to see what you ordered before." />
        )}
      </Page>
    );
  return <History userId={session.user.id} />;
}

// a filter pill: a native picker that looks like the others, dark while it's filtering
function Pick({ label, value, all, options, onChange }) {
  return (
    <label className={'pick' + (value !== all ? ' on' : '')}>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}

function History({ userId }) {
  const [tab, setTab] = useState(null); // 'again' or 'past'; null until we know what they have
  const [orders, setOrders] = useState(null);
  const [again, setAgain] = useState(null);
  const [err, setErr] = useState(null);
  const [shop, setShop] = useState('all');
  const [when, setWhen] = useState('any');
  const [status, setStatus] = useState('all');
  const [shown, setShown] = useState(STEP);
  const [toast, say, closeToast] = useToast();
  useCarts(); // redraw when a cart changes, so each + shows how many are in it
  const load = useCallback(async () => {
    const [o, a] = await Promise.all([supabase.rpc('my_orders'), supabase.rpc('my_past_items')]);
    if (o.error || a.error) return setErr(o.error || a.error);
    setErr(null);
    setOrders((o.data || []).filter((x) => !isLive(x)));
    setAgain(a.data || []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const inbox = useInbox(userId, { onAlert: () => load(), title: 'Order history' });
  const view = tab || (again && !again.length && orders && orders.length ? 'past' : 'again');
  const shops = useMemo(() => [...new Set([...(orders || []).map((o) => o.shop), ...(again || []).map((g) => g.shop)])].sort(), [orders, again]);
  const past = useMemo(() => {
    const from =
      when === 'any'
        ? 0
        : when === 'year'
          ? new Date(new Date().getFullYear(), 0, 1).getTime()
          : Date.now() - Number(when) * 864e5;
    return (orders || []).filter(
      (o) =>
        (shop === 'all' || o.shop === shop) &&
        new Date(o.created_at).getTime() >= from &&
        (status === 'all' ||
          (status === 'done' && o.status === 'delivered') ||
          (status === 'cancelled' && o.status === 'cancelled') ||
          (status === 'problem' && !!o.problem)),
    );
  }, [orders, shop, when, status]);
  const groups = (again || []).filter((g) => shop === 'all' || g.shop === shop);
  function add(g, it) {
    const key = it.option_id ? it.product_id + ':' + it.option_id : it.product_id;
    const n = addOne(g.slug, key, it.stock);
    rememberShop(g.slug, g.shop);
    say({
      text: `${n} × ${it.name}${it.option ? ' · ' + it.option : ''} in your cart at ${g.shop}`,
      action: { label: 'View cart', run: () => navigate('/' + g.slug + '/cart') },
    });
  }
  const filtering = shop !== 'all' || when !== 'any' || status !== 'all';
  return (
    <Page title="Order history" back="/orders" kind="me" tabs={<CustomerTabs active="orders" unread={inbox.count} shopNews={inbox.shopCount} />}>
      <div className="seg wide" role="group" aria-label="Order history">
        <button aria-pressed={view === 'again'} onClick={() => setTab('again')}>
          Buy again
        </button>
        <button aria-pressed={view === 'past'} onClick={() => setTab('past')}>
          Past orders
        </button>
      </div>
      {orders === null ? (
        err ? (
          <LoadError error={err} onRetry={load} what="your orders" compact />
        ) : (
          <Skeleton kind="list" />
        )
      ) : (
        <>
          {shops.length > 1 || (view === 'past' && orders.length > 0) ? (
            <div className="picks">
              {shops.length > 1 && (
                <Pick label="Shop" value={shop} all="all" options={[['all', 'All shops'], ...shops.map((s) => [s, s])]} onChange={setShop} />
              )}
              {view === 'past' && (
                <>
                  <Pick label="When" value={when} all="any" options={WHEN} onChange={setWhen} />
                  <Pick label="Status" value={status} all="all" options={STATUS} onChange={setStatus} />
                </>
              )}
            </div>
          ) : null}
          {view === 'again' ? (
            groups.length ? (
              groups.map((g) => (
                <section key={g.slug} className="again" aria-label={g.shop}>
                  <a className="again-head" href={'/' + g.slug}>
                    <span className="avatar" aria-hidden="true">
                      {(g.shop.trim()[0] || '?').toUpperCase()}
                    </span>
                    <div>
                      <strong>{g.shop}</strong>
                      <span className={'dot-line' + (g.open ? '' : ' off')}>{g.open ? 'Taking orders' : 'Not taking orders now'}</span>
                    </div>
                    <span className="arrow" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </span>
                  </a>
                  <div className="again-items">
                    {g.items.map((it) => {
                      const key = it.option_id ? it.product_id + ':' + it.option_id : it.product_id;
                      const inCart = loadCart(g.slug)[key] || 0;
                      const name = it.name + (it.option ? ' · ' + it.option : '');
                      const out = it.stock <= 0;
                      return (
                        <div key={key} className="again-item">
                          <div className="pimg">
                            <img src={photoUrl(it.photo_path)} alt={name} loading="lazy" />
                            <button
                              className={'add' + (inCart ? ' in' : '')}
                              disabled={!g.open || out || inCart >= it.stock}
                              onClick={() => add(g, it)}
                              aria-label={inCart ? `Add one more ${name} (${inCart} in your cart)` : 'Add ' + name + ' to your cart'}
                            >
                              {inCart ? inCart : '+'}
                            </button>
                          </div>
                          <span className="name">{name}</span>
                          <span className="num">
                            {out ? (
                              <span className="sub">Sold out</span>
                            ) : (
                              <>
                                {naira(payPrice(it))}
                                {onSale(it) && (
                                  <>
                                    {' '}
                                    <s className="was">{naira(it.price)}</s>
                                  </>
                                )}
                              </>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))
            ) : (
              <Empty
                kind="bag"
                title="Nothing to buy again yet"
                text="Things you buy show here, so you can get them again in one tap."
                action={['Find shops', '/shops']}
              />
            )
          ) : past.length ? (
            <>
              {past.slice(0, shown).map((o) => (
                <OrderRow key={o.token} o={o} unread={inbox.unread} />
              ))}
              {past.length > shown && (
                <button className="btn ghost" onClick={() => setShown(shown + STEP)}>
                  Show older orders
                </button>
              )}
            </>
          ) : filtering ? (
            <Empty
              kind="receipt"
              title="No orders match"
              text="Try another shop, time or status."
              action={['Show all orders']}
              onAction={() => {
                setShop('all');
                setWhen('any');
                setStatus('all');
              }}
            />
          ) : (
            <Empty
              kind="receipt"
              title="No past orders yet"
              text="Orders show here once they're delivered, collected or cancelled."
              action={['Find shops', '/shops']}
            />
          )}
        </>
      )}
      <Toast toast={toast || inbox.toast} onClose={toast ? closeToast : inbox.closeToast} low />
    </Page>
  );
}
