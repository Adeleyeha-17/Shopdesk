// /carts, the Cart tab when more than one shop has something in it: every shop's cart, so nothing added in one shop
// gets forgotten while browsing another. Each shows what's in it as the shop sells it now, with Go to cart and Remove.
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { photoUrl } from '../lib/photos.js';
import { options, payPrice } from '../lib/products.js';
import { allCarts, clearCart, fitCart } from './cart.js';
import { myShops } from './myShops.js';
import { Empty } from '../shared/Empty.jsx';
import { Page } from '../shared/Page.jsx';
import { CustomerTabs } from './CustomerTabs.jsx';
import { useInbox, InboxToast } from './inbox.jsx';

// a cart's lines with today's prices: [{ name, qty, price, photo }]
function linesOf(items, products) {
  return Object.entries(fitCart(items, products).items).map(([k, qty]) => {
    const [pid, oid] = k.split(':');
    const p = products.find((x) => x.id === pid);
    const o = oid ? options(p).find((x) => x.id === oid) : null;
    return { name: o ? `${p.name} · ${o.name}` : p.name, qty, price: payPrice(o || p), photo: p.photo_path };
  });
}

export function useCarts() {
  const [carts, setCarts] = useState(() => allCarts());
  useEffect(() => {
    const f = () => setCarts(allCarts());
    window.addEventListener('shopdesk-cart', f);
    window.addEventListener('storage', f);
    return () => {
      window.removeEventListener('shopdesk-cart', f);
      window.removeEventListener('storage', f);
    };
  }, []);
  return carts;
}

// what each shop sells now: shown at once from the last look, and asked again each time the list opens
const fronts = {};
export function Carts({ carts }) {
  const [, redraw] = useState(0);
  const [removing, setRemoving] = useState(null);
  const asked = useRef(new Set());
  useEffect(() => {
    carts.forEach(({ slug }) => {
      if (asked.current.has(slug)) return;
      asked.current.add(slug);
      supabase.rpc('get_storefront', { p_slug: slug }).then(({ data, error }) => {
        if (error) asked.current.delete(slug); // try again next time the carts change
        else fronts[slug] = data || null; // null: the shop isn't taking orders now
        redraw((n) => n + 1);
      });
    });
  }, [carts]);
  if (!carts.length)
    return (
      <Empty
        kind="basket"
        title="Your cart is empty"
        text="Add things from any shop and they'll wait here, one cart for each shop."
        action={['Find shops', '/shops']}
      />
    );
  return carts.map(({ slug, items }) => {
    const f = fronts[slug];
    const name = (f && f.shop.name) || (myShops().find((s) => s.slug === slug) || {}).name || slug;
    const lines = f ? linesOf(items, f.products) : [];
    const count = lines.reduce((a, l) => a + l.qty, 0);
    const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
    return (
      <section key={slug} className="card boxed cart-card" aria-label={'Cart at ' + name}>
        <div className="row">
          <strong>{name}</strong>
          {f && count > 0 && <span className="num">{naira(total)}</span>}
        </div>
        {f === undefined ? (
          <span className="sub">Loading…</span>
        ) : f === null ? (
          <span className="sub">This shop isn't taking orders right now.</span>
        ) : count === 0 ? (
          <span className="sub">Everything in this cart has sold out or is no longer sold here.</span>
        ) : (
          <>
            <span className="sub">
              {count} item{count === 1 ? '' : 's'} · {lines.map((l) => l.name).join(', ')}
            </span>
            <div className="cart-thumbs" aria-hidden="true">
              {lines.slice(0, 4).map((l, i) => (
                l.photo ? <img key={i} src={photoUrl(l.photo)} alt="" loading="lazy" /> : <span key={i} />
              ))}
              {lines.length > 4 && <span>+{lines.length - 4}</span>}
            </div>
          </>
        )}
        {removing === slug ? (
          <div className="btns" role="alert">
            <span className="sub">Empty this cart?</span>
            <button
              className="btn small bad"
              onClick={() => {
                clearCart(slug);
                setRemoving(null);
              }}
            >
              Empty it
            </button>
            <button className="linkbtn" onClick={() => setRemoving(null)}>
              Keep it
            </button>
          </div>
        ) : (
          <div className="btns">
            {f && count > 0 && (
              <a className="btn small" href={'/' + slug + '/cart'}>
                Go to cart
              </a>
            )}
            <button className="linkbtn" onClick={() => setRemoving(slug)}>
              Remove
            </button>
          </div>
        )}
      </section>
    );
  });
}

export function CartsPage() {
  const carts = useCarts();
  // signed in: the tabs show new messages, and a shop's message pops up here too
  const [uid, setUid] = useState(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUid(data.session ? data.session.user.id : null));
  }, []);
  const inbox = useInbox(uid, { title: 'Your carts' });
  return (
    <Page title="Your carts" kind="me" tabs={<CustomerTabs active="cart" unread={inbox.count} shopNews={inbox.shopCount} />}>
      <Carts carts={carts} />
      <InboxToast inbox={inbox} />
    </Page>
  );
}
