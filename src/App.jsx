// Which page to show for each web address:
//   /              the vendor's app (sign in, set up your shop, then Sales / Orders / Stock / Shop)
//   /admin         ShopDesk Admin (only your owner account)
//   /privacy       privacy notice and shop rules
//   /shops         a customer's shops (every shop they've opened or ordered from)
//   /orders        a customer's own orders
//   /account       a customer's saved details, email alerts and sign out
//   /o/<link>      one order, as the customer sees it
//   /email-off     "Stop these emails" (the link in every email)
//   /<shop-name>   a shop's order page and cart
//   /<shop-name>/cart       that shop's cart
//   /<shop-name>/checkout   that shop's checkout
import React, { useEffect, useRef, useState } from 'react';
import { configured } from './lib/database.js';
import { flushSync } from 'react-dom';
import { keepLinksInApp } from './lib/helpers.js';
import { currentPath, direction, keepSpot, nowShowing, spotOf, startHistory, takeSlide, transition } from './lib/motion.js';
import { VendorApp } from './vendor/VendorApp.jsx';
import { AdminApp } from './admin/AdminApp.jsx';
import { RatingsPage } from './customer/RatingsPage.jsx';
import { ShopPage } from './customer/ShopPage.jsx';
import { RiderPage } from './rider/RiderPage.jsx';
import { OrderPage } from './customer/OrderPage.jsx';
import { MyOrdersPage } from './customer/MyOrdersPage.jsx';
import { ShopsPage } from './customer/ShopsPage.jsx';
import { PrivacyPage } from './shared/PrivacyPage.jsx';
import { EmailOffPage } from './shared/EmailOffPage.jsx';
import { LoadingBar } from './shared/LoadingBar.jsx';

// The loading bar sits above every page.
export function App() {
  return (
    <>
      <LoadingBar />
      <Pages />
    </>
  );
}

function Pages() {
  const [path, setPath] = useState(currentPath);
  const shown = useRef(path);
  useEffect(() => {
    startHistory();
    const f = (e) => {
      const next = currentPath();
      const prev = shown.current;
      shown.current = next;
      // a link or button in the app: navigate() is already running this as a smooth move
      if (e.fromApp || next === prev) {
        setPath(next);
        return;
      }
      // the back arrow, or the browser's Back or Forward: slide the same way, unless the browser animated it itself
      // (a swipe back), and put the scroll back where it was on that page
      const asked = takeSlide();
      keepSpot();
      nowShowing(e.state && e.state.k);
      const spot = spotOf(e.state);
      const after = () => window.scrollTo(0, spot || 0);
      if (asked || e.hasUAVisualTransition === false) transition(() => setPath(next), asked || direction(prev, next), after);
      else {
        flushSync(() => setPath(next));
        after();
      }
    };
    window.addEventListener('popstate', f);
    const stopLinks = keepLinksInApp();
    return () => {
      window.removeEventListener('popstate', f);
      stopLinks();
    };
  }, []);
  if (!configured) {
    return (
      <div className="app">
        <main>
          <div className="center">
            <h2>Almost there</h2>
            <p className="note">
              This copy of ShopDesk isn't connected to a database yet. Copy <strong>.env.example</strong> to{' '}
              <strong>.env</strong>, fill in your Supabase Project URL and anon key, then restart{' '}
              <code>npm run dev</code>.
            </p>
          </div>
        </main>
      </div>
    );
  }
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/') return <VendorApp />;
  if (p === '/admin') return <AdminApp />;
  if (p === '/privacy') return <PrivacyPage />;
  if (p === '/shops') return <ShopsPage />;
  if (p === '/orders' || p === '/account') return <MyOrdersPage view={p === '/account' ? 'account' : 'orders'} />;
  if (p === '/email-off') return <EmailOffPage />;
  const o = p.match(/^\/o\/([0-9a-f-]{36})$/i);
  if (o) return <OrderPage token={o[1]} />;
  const rider = p.match(/^\/r\/([0-9a-f-]{36})$/i);
  if (rider) return <RiderPage token={rider[1]} />;
  const r = p.match(/^\/([a-z0-9-]{3,30})\/ratings$/i);
  if (r) return <RatingsPage slug={r[1].toLowerCase()} />;
  const s = p.match(/^\/([a-z0-9-]{3,30})(?:\/(cart|checkout))?$/i);
  if (s) return <ShopPage slug={s[1].toLowerCase()} step={s[2] ? s[2].toLowerCase() : 'shop'} />;
  return (
    <div className="app">
      <main>
        <div className="center">
          <h2>Page not found</h2>
          <p className="note">Check the link and try again.</p>
        </div>
      </main>
    </div>
  );
}
