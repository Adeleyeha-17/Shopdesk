// The bar at the bottom of the customer's pages, like the shop owner's: their shops, their orders (with a red number
// when a shop has written), the cart (with how many things are in all their carts), Help and their account. A shop
// owner buying from other shops gets "My shop" instead of Account, to go back to their shop app.
// Hidden on checkout, so nothing pulls them away from paying. Tabs change at once, without sliding.
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { allCarts } from './cart.js';
import { TabIcon } from '../shared/TabIcon.jsx';


// how many things are in all their carts together
const countAll = () => allCarts().reduce((a, c) => a + Object.values(c.items).reduce((b, q) => b + (q > 0 ? q : 0), 0), 0);

// kept up to date as a cart changes (cart.js tells us), here or in another tab
function useCartCount() {
  const [n, setN] = useState(countAll);
  useEffect(() => {
    const f = () => setN(countAll());
    f();
    window.addEventListener('shopdesk-cart', f);
    window.addEventListener('storage', f);
    return () => {
      window.removeEventListener('shopdesk-cart', f);
      window.removeEventListener('storage', f);
    };
  }, []);
  return n;
}

// does this account run a shop? asked once per visit for each signed-in email
const runsShop = {};
function useRunsShop(email) {
  const [v, setV] = useState(() => runsShop[email] || false);
  useEffect(() => {
    if (!email) return setV(false);
    if (email in runsShop) return setV(runsShop[email]);
    let alive = true;
    supabase.rpc('my_account').then(({ data, error }) => {
      if (error) return;
      runsShop[email] = !!(data && data.vendor);
      if (alive) setV(runsShop[email]);
    });
    return () => {
      alive = false;
    };
  }, [email]);
  return v;
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

// active: 'shops', 'orders', 'cart', 'help' or 'account'. unread: new messages and updates on their orders.
// shopNews: messages from shops (on the Shops tab).
export function CustomerTabs({ active, unread = 0, shopNews = 0 }) {
  const inCart = useCartCount();
  const email = useEmail();
  const ownsShop = useRunsShop(email);
  // the cart's number gives a little bump when something is added
  const was = useRef(inCart);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (inCart > was.current) setBump((b) => b + 1);
    was.current = inCart;
  }, [inCart]);
  // the Cart tab: straight to the cart when only one shop has something in it, or else the list of their carts
  const carts = allCarts();

  const tabs = [
    ['shops', 'Shops', '/shops'],
    ['orders', 'Orders', '/orders'],
    ['cart', 'Cart', carts.length === 1 ? '/' + carts[0].slug + '/cart' : '/carts'],
    ['help', 'Help', '/help'],
    ownsShop ? ['myshop', 'My shop', '/'] : ['account', 'Account', '/account'],
  ];
  const letter = (email.trim()[0] || '').toUpperCase();
  return (
    <nav className="tabs" aria-label="ShopDesk">
      <div className="tabs-in five" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
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
              <TabIcon name={k === 'myshop' ? 'shop' : k} on={active === k} />
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
