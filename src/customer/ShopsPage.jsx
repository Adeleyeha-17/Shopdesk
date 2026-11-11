// /shops: the Shops tab. Every shop the customer has opened on this phone, plus every shop they've ordered from on
// their account (so the list follows them to a new phone), newest first. No more digging through WhatsApp for a link.
// At the top, the shop with something waiting in its cart. Edit takes a shop off the list.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { photoUrl } from '../lib/photos.js';
import { dayOf, DAY, startOfDay } from '../lib/dates.js';
import { useBusy } from '../lib/busy.js';
import { Page } from '../shared/Page.jsx';
import { Toast, useToast } from '../shared/Toast.jsx';
import { CustomerTabs } from './CustomerTabs.jsx';
import { useInbox, InboxToast } from './inbox.jsx';
import { loadCart } from './cart.js';
import { orderLabel } from './MyOrdersPage.jsx';
import { forgetShop, hiddenShops, myShops } from './myShops.js';

const inCart = (slug) => Object.values(loadCart(slug)).reduce((a, q) => a + (q > 0 ? q : 0), 0);
const isLive = (o) =>
  !['delivered', 'cancelled'].includes(o.status) ||
  (o.status === 'delivered' && o.received_by !== 'customer');

// "Opened today", "Opened yesterday", "Opened 3 days ago", "Opened on Sat, 2 Nov"
function openedText(at) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(at)) / DAY);
  if (days <= 0) return 'Opened today';
  if (days === 1) return 'Opened yesterday';
  if (days < 7) return `Opened ${days} days ago`;
  return 'Opened on ' + dayOf(at);
}

// one line on where things stand with a shop: the cart, an order on its way, past orders, or when it was opened
function stateOf(s) {
  if (s.cart > 0) return ['cart', `${s.cart} in your cart${s.cartTotal ? ' · ' + naira(s.cartTotal) : ''}`];
  const live = s.orders.find(isLive);
  if (live) return ['go', `${live.code || '#' + live.order_id} · ${orderLabel(live)[1]}`];
  if (s.orders.length)
    return [
      '',
      `${s.orders.length} order${s.orders.length === 1 ? '' : 's'} · last on ${dayOf(s.orders[0].created_at)}`,
    ];
  return ['', openedText(s.at)];
}

const Chevron = () => (
  <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export function ShopsPage() {
  const [kept, setKept] = useState(myShops); // shops opened on this phone
  const [orders, setOrders] = useState(null); // their orders on their account (null until known)
  const [uid, setUid] = useState(null);
  const [find, setFind] = useState('');
  const [editing, setEditing] = useState(false);
  const [toast, say, closeToast] = useToast();
  const [notes, setNotes] = useState({}); // the newest message from each shop: { slug: { body, at, unread } }
  const inbox = useInbox(uid, {
    title: 'Shops',
    onAlert: (n) => n && n.kind === 'shop_message' && loadNotes(),
  });
  // messages shops sent this customer ("We have new stock in!"), shown on that shop's row; seeing them here reads them
  async function loadNotes() {
    const { data } = await supabase
      .from('notifications')
      .select('id, url, body, created_at, read_at')
      .eq('kind', 'shop_message')
      .order('id', { ascending: false })
      .limit(100);
    const m = {};
    (data || []).forEach((n) => {
      const slug = String(n.url || '').replace(/^\//, '');
      if (slug && !m[slug]) m[slug] = { body: n.body, at: n.created_at, unread: !n.read_at };
    });
    setNotes(m);
    if ((data || []).some((n) => !n.read_at))
      setTimeout(() => inbox.unread.markRead(null, 'shop_message'), 1500);
  }
  useEffect(() => {
    if (uid) loadNotes();
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const f = () => setKept(myShops());
    window.addEventListener('shopdesk-shops', f);
    window.addEventListener('shopdesk-cart', f);
    window.addEventListener('storage', f);
    return () => {
      window.removeEventListener('shopdesk-shops', f);
      window.removeEventListener('shopdesk-cart', f);
      window.removeEventListener('storage', f);
    };
  }, []);
  // signed in: add the shops they've ordered from, with where each order stands
  useEffect(() => {
    let live = true;
    supabase.auth.getSession().then(async ({ data }) => {
      const s = data.session;
      if (!live) return;
      if (!s) {
        setOrders([]);
        return;
      }
      setUid(s.user.id);
      const { data: rows } = await supabase.rpc('my_orders');
      if (live) setOrders(rows || []);
    });
    return () => {
      live = false;
    };
  }, []);
  useBusy(orders === null);

  // one list: the shops on this phone first, then shops only known from orders; newest activity first
  const hidden = hiddenShops();
  const bySlug = new Map();
  kept.forEach((s) => bySlug.set(s.slug, { ...s, orders: [] }));
  (orders || []).forEach((o) => {
    if (!o.slug) return;
    if (!bySlug.has(o.slug)) {
      if (hidden.includes(o.slug)) return;
      bySlug.set(o.slug, { slug: o.slug, name: o.shop, photos: [], orders: [], at: 0 });
    }
    bySlug.get(o.slug).orders.push(o);
  });
  const shops = [...bySlug.values()]
    .map((s) => {
      const os = s.orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const last = Math.max(s.at || 0, os.length ? new Date(os[0].created_at).getTime() : 0);
      return { ...s, orders: os, last, cart: inCart(s.slug) };
    })
    .sort((a, b) => b.last - a.last);
  const words = find.trim().toLowerCase();
  const shown = words
    ? shops.filter((s) => (s.name + ' ' + (s.blurb || '')).toLowerCase().includes(words))
    : shops;
  // the newest shop with something in its cart
  const resume = !words && !editing ? shops.find((s) => s.cart > 0) : null;

  function remove(s) {
    forgetShop(s.slug);
    setKept(myShops());
    say(`${s.name} is off your list. Opening its link brings it back.`);
  }

  const tabs = <CustomerTabs active="shops" unread={inbox.count} shopNews={inbox.shopCount} />;
  if (!shops.length && orders !== null)
    return (
      <Page title="Your shops" tabs={tabs}>
        <div className="center empty">
          <span className="empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 9l1-5h14l1 5M4 9h16v11H4zM9 20v-6h6v6" />
            </svg>
          </span>
          <h2>No shops yet</h2>
          <p className="note" style={{ maxWidth: 300 }}>
            When a shop sends you its ShopDesk link on WhatsApp or Instagram, open it once. The shop stays
            here, so you never have to dig for the link again.
          </p>
        </div>
        <InboxToast inbox={inbox} />
      </Page>
    );
  return (
    <Page title="Your shops" tabs={tabs}>
      {shops.length >= 4 && (
        <div className="search">
          <label htmlFor="findShop" className="visually-hidden">
            Search your shops
          </label>
          <input
            id="findShop"
            type="search"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Search your shops"
            autoComplete="off"
          />
        </div>
      )}
      {resume && (
        <section className="resume" aria-label="Pick up where you left off">
          {resume.photos && resume.photos.length > 0 && (
            <div
              className="resume-photos"
              style={{ gridTemplateColumns: `repeat(${resume.photos.length}, minmax(0, 1fr))` }}
            >
              {resume.photos.map((p) => (
                <img key={p} src={photoUrl(p)} alt="" />
              ))}
            </div>
          )}
          <div className="resume-body">
            <span className="eyebrow">Pick up where you left off</span>
            <strong className="resume-name">{resume.name}</strong>
            <span className="resume-cart">
              <strong>
                {resume.cart} item{resume.cart === 1 ? '' : 's'}
              </strong>{' '}
              in your cart{resume.cartTotal ? ' · ' + naira(resume.cartTotal) : ''}
            </span>
          </div>
          <div className="btns">
            <a className="btn" href={'/' + resume.slug + '/cart'}>
              View cart
            </a>
            <a className="btn ghost" href={'/' + resume.slug}>
              Visit shop
            </a>
          </div>
        </section>
      )}
      <div className="stack-sm">
        <div className="shops-head">
          <h2>{resume ? 'All your shops' : 'Your shops'}</h2>
          <button className="linkbtn" onClick={() => setEditing(!editing)} aria-pressed={editing}>
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
        <ul className="shoplist">
          {shown.map((s) => {
            const [tone, line] = stateOf(s);
            const pic = s.photos && s.photos[0];
            return (
              <li key={s.slug}>
                <a className="shoprow" href={'/' + s.slug}>
                  <span className={'shop-pic' + (pic ? '' : ' letter')} aria-hidden="true">
                    {pic ? (
                      <img src={photoUrl(pic)} alt="" loading="lazy" />
                    ) : (
                      (s.name.trim()[0] || '?').toUpperCase()
                    )}
                  </span>
                  <span className="shop-info">
                    <strong>{s.name}</strong>
                    {s.blurb && <span className="sub">{s.blurb}</span>}
                    <span className={'shop-state ' + tone}>
                      <i className="dot" />
                      {line}
                    </span>
                    {notes[s.slug] && (
                      <span className={'shop-note' + (notes[s.slug].unread ? ' new' : '')}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M4 6h16v10H8l-4 4z" />
                        </svg>
                        <span>{notes[s.slug].body}</span>
                      </span>
                    )}
                  </span>
                  {!editing && <Chevron />}
                </a>
                {editing && (
                  <button
                    className="shop-x"
                    onClick={() => remove(s)}
                    aria-label={`Take ${s.name} off your list`}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 12h12" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {words && !shown.length && <p className="note">No shop matches “{find.trim()}”.</p>}
      </div>
      <p className="shops-foot">Open a shop&apos;s link once and it stays here.</p>
      <Toast toast={toast} onClose={closeToast} low />
      <InboxToast inbox={inbox} />
    </Page>
  );
}
