// The bar at the bottom of the customer's pages, like the shop owner's: their shops, their orders (with a red number
// when a shop has written), the cart (with how many things are in it) and their account.
// Hidden on checkout, so nothing pulls them away from paying. Tabs change at once, without sliding.
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { loadCart } from './cart.js';
import { myShops } from './myShops.js';

const ICON = {
  shops: 'M4 9l1-5h14l1 5M4 9h16v11H4zM9 20v-6h6v6',
  orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  cart: 'M3 4h2.2l2.3 10.6a1.6 1.6 0 0 0 1.6 1.3h8.1a1.6 1.6 0 0 0 1.6-1.2L20.6 8H6',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.4-3.3 4.2-5 7.5-5s6.1 1.7 7.5 5',
};

const countIn = (slug) => Object.values(slug ? loadCart(slug) : {}).reduce((a, q) => a + (q > 0 ? q : 0), 0);

// how many things are in that shop's cart, kept up to date as the cart changes (cart.js tells us)
function useCartCount(slug) {
  const [n, setN] = useState(() => countIn(slug));
  useEffect(() => {
    const f = () => setN(countIn(slug));
    f();
    window.addEventListener('shopdesk-cart', f);
    window.addEventListener('storage', f);
    return () => {
      window.removeEventListener('shopdesk-cart', f);
      window.removeEventListener('storage', f);
    };
  }, [slug]);
  return n;
}

// the signed-in email, for the letter on Account
function useEmail() {
  const [email, setEmail] = useState('');
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail((data.session && data.session.user.email) || ''));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setEmail((s && s.user.email) || ''));
    return () => data.subscription.unsubscribe();
  }, []);
  return email;
}

// active: 'shops', 'orders', 'cart' or 'account'. unread: new messages and updates on their orders.
// shopNews: messages from shops (on the Shops tab).
export function CustomerTabs({ active, unread = 0, shopNews = 0 }) {
  // the Cart tab: the newest shop with something in its cart, or else the shop opened last
  const shops = myShops();
  const cartShop = shops.find((s) => countIn(s.slug) > 0) || shops[0];
  const slug = cartShop && cartShop.slug;
  const inCart = useCartCount(slug);
  const email = useEmail();
  // the cart's number gives a little bump when something is added
  const was = useRef(inCart);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (inCart > was.current) setBump((b) => b + 1);
    was.current = inCart;
  }, [inCart]);

  const tabs = [
    ['shops', 'Shops', '/shops'],
    ['orders', 'Orders', '/orders'],
    slug && ['cart', 'Cart', '/' + slug + '/cart'],
    ['account', 'Account', '/account'],
  ].filter(Boolean);
  const letter = (email.trim()[0] || '').toUpperCase();
  return (
    <nav className="tabs" aria-label="ShopDesk">
      <div className="tabs-in" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map(([k, label, href]) => (
          <a
            key={k}
            className="tab"
            href={href}
            data-move="none"
            aria-current={active === k ? 'page' : undefined}
          >
            {k === 'account' && letter ? (
              <span className="tab-letter" aria-hidden="true">
                <b>{letter}</b>
              </span>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={ICON[k]} />
                {k === 'cart' && (
                  <>
                    <circle cx="9.5" cy="19.6" r="1.2" />
                    <circle cx="17" cy="19.6" r="1.2" />
                  </>
                )}
              </svg>
            )}
            {label}
            {k === 'shops' && shopNews > 0 && (
              <span className="badge" aria-label={shopNews + ' new from shops'}>
                {shopNews > 9 ? '9+' : shopNews}
              </span>
            )}
            {k === 'orders' && unread > 0 && (
              <span className="badge" aria-label={unread + ' new'}>
                {unread > 9 ? '9+' : unread}
              </span>
            )}
            {k === 'cart' && inCart > 0 && (
              <span
                key={bump}
                className={'badge ink' + (bump ? ' bump' : '')}
                aria-label={inCart + ' in the cart'}
              >
                {inCart > 99 ? '99+' : inCart}
              </span>
            )}
          </a>
        ))}
      </div>
    </nav>
  );
}
