// /<shop-name>: a shop's order page. Customers pick products (and a size, when a product has them), sign in
// (if they aren't already) and place the order.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { photoUrl } from '../lib/photos.js';
import { errText, navigate } from '../lib/helpers.js';
import { kick, signOut } from '../lib/alerts.js';
import { useInbox, InboxToast } from './inbox.jsx';
import { CustomerTabs } from './CustomerTabs.jsx';
import { noteShop, rememberShop } from './myShops.js';
import { Page } from '../shared/Page.jsx';
import { LoadError } from '../shared/LoadError.jsx';
import { SignIn } from '../shared/SignIn.jsx';
import { ReportShopForm } from '../shared/ReportShopForm.jsx';
import { rememberOrder } from './savedOrders.js';
import { loadCart, saveCart, clearCart, fitCart } from './cart.js';
import { onSale, optionWord, options, payPrice, priceFrom } from '../lib/products.js';
import { useBusy } from '../lib/busy.js';
import { Skeleton } from '../shared/Skeleton.jsx';
import { AreaPicker } from './AreaPicker.jsx';
import { areaIn } from './areas.js';
import { noteSource, sourceFor } from './source.js';

// "₦8,000 ₦9,500": the price to pay, with the old one crossed out during a sale
function Price({ x }) {
  return (
    <>
      {naira(payPrice(x))}
      {onSale(x) && (
        <>
          {' '}
          <s className="was">{naira(x.price)}</s>
        </>
      )}
    </>
  );
}

// Choosing sizes: every size with its price and stock, and how many of each are in the cart.
function OptionSheet({ p, cart, set, onClose }) {
  const done = useRef(null);
  // closing slides the sheet down first (a fifth of a second), then it goes
  const [closing, setClosing] = useState(false);
  const leaving = useRef(false);
  const close = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    setClosing(true);
    setTimeout(onClose, 200);
  }, [onClose]);
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    if (done.current) done.current.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', key);
  }, [close]);
  const word = optionWord(p);
  return (
    <div
      className={'overlay bottom' + (closing ? ' closing' : '')}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
        <div className="row" style={{ justifyContent: 'flex-start', gap: 12 }}>
          <img className="thumb" src={photoUrl(p.photo_path)} alt="" />
          <div>
            <h2 id="sheetTitle" className="sheet-title">
              {p.name}
            </h2>
            <div className="sub">Choose a {word}</div>
          </div>
        </div>
        <ul className="optpick">
          {options(p).map((o) => {
            const k = p.id + ':' + o.id,
              q = cart[k] || 0;
            return (
              // the whole row is a big tap target: tapping it adds one of that size
              <li
                key={o.id}
                className={o.stock > 0 ? (q > 0 ? 'on' : '') : 'out'}
                onClick={(e) => {
                  if (o.stock > 0 && q < o.stock && !e.target.closest('button')) set(k, q + 1);
                }}
              >
                <div>
                  <strong>{o.name}</strong>
                  <div className="sub num">
                    <Price x={o} />
                    {o.stock > 0 && o.stock <= 3 ? ` · ${o.stock} left` : ''}
                    {o.stock > 0 ? '' : ' · sold out'}
                  </div>
                </div>
                {o.stock > 0 && (
                  <div className="stepper">
                    {q > 0 && (
                      <>
                        <button
                          className="step"
                          onClick={() => set(k, q - 1)}
                          aria-label={`One less ${o.name}`}
                        >
                          −
                        </button>
                        <span className="qty">{q}</span>
                      </>
                    )}
                    <button
                      className="step"
                      data-inc="1"
                      onClick={() => set(k, Math.min(o.stock, q + 1))}
                      disabled={q >= o.stock}
                      aria-label={`Add ${p.name}, ${o.name}`}
                    >
                      +
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <button className="btn" ref={done} onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}

// The search box's hint types out the shop's products one after another, like someone typing, until the customer
// taps the box. Phones set to reduce motion just see "Search <shop>".
function useTypingHint(names, plain, on) {
  const [hint, setHint] = useState(plain);
  const key = names.join('|');
  useEffect(() => {
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setHint(plain);
    if (!on || calm || names.length < 2) return undefined;
    let i = 0;
    let n = 0;
    let back = false;
    let t = setTimeout(function tick() {
      const word = names[i % names.length];
      n += back ? -1 : 1;
      setHint(n > 0 ? `Search “${word.slice(0, n)}${n < word.length || back ? '' : '”'}` : plain);
      let wait = back ? 28 : 70;
      if (!back && n >= word.length) {
        back = true;
        wait = 1600;
      } else if (back && n <= 0) {
        back = false;
        i++;
        wait = 900;
      }
      t = setTimeout(tick, wait);
    }, 1400);
    return () => clearTimeout(t);
    // names are compared by their text (key), so a fresh list of the same products doesn't restart it
  }, [key, plain, on]);
  return hint;
}

// /<shop>: the products; /<shop>/cart: the cart; /<shop>/checkout: who it's for, delivery, and placing the order.
export function ShopPage({ slug, step = 'shop' }) {
  const checkout = step === 'checkout';
  const cartPage = step === 'cart';
  const [state, setState] = useState({ loading: true, shop: null, products: [], error: null });
  const [cart, setCart] = useState({}); // product id, or "product id:size id", -> how many (see cart.js)
  const [cartNote, setCartNote] = useState(''); // what changed in a saved cart since last time
  const restored = useRef(false); // the saved cart is read once, when the shop's products first arrive
  const [ready, setReady] = useState(false); // the saved cart has been read (so an empty cart really is empty)
  const [saved, setSaved] = useState(null); // the customer's saved details, from their last order
  const [editDetails, setEditDetails] = useState(false);
  const [editAddr, setEditAddr] = useState(false);
  const [picking, setPicking] = useState(null); // the product whose sizes are open
  const [find, setFind] = useState(''); // search this shop's products
  const [inSearch, setInSearch] = useState(false); // the search box is being used
  const [form, setForm] = useState({ name: '', phone: '', mode: 'delivery', address: '', area: '' });
  const [areaOpen, setAreaOpen] = useState(false);
  const [areaPicked, setAreaPicked] = useState(false); // they chose the area themselves: typing doesn't change it
  // where this customer came from (Instagram, TikTok, a WhatsApp link...), for the shop's report
  useEffect(() => noteSource(slug), [slug]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [me, setMe] = useState(null);
  const [isShop, setIsShop] = useState(null);
  const [mine, setMine] = useState([]); // this customer's orders with this shop, for Report this shop
  const [uid, setUid] = useState(null);
  // Customers order from their account. Sign-in happens at checkout, so the cart is kept; then their saved details fill in.
  // A shop's account can't order (one email, one role), so it's told that instead of seeing the form.
  useEffect(() => {
    const use = async (session) => {
      if (!session) {
        setIsShop(false);
        setMe('');
        setUid(null);
        return;
      }
      // Ask both questions at once (is this a shop's account? any saved details?), then show the form already filled in.
      const [{ data: a }, { data: c }] = await Promise.all([
        supabase.rpc('my_account'),
        supabase.from('customers').select('name, phone, address, area').maybeSingle(),
      ]);
      const shopAccount = !!(a && a.vendor);
      if (c && !shopAccount) setSaved(c);
      if (c && !shopAccount)
        setForm((f) => ({
          ...f,
          name: f.name || c.name,
          phone: f.phone || c.phone,
          address: f.address || c.address,
          area: f.area || c.area || areaIn(c.address),
        }));
      setIsShop(shopAccount);
      setMe(session.user.email);
      if (!shopAccount) setUid(session.user.id);
      if (!shopAccount)
        supabase.rpc('my_orders').then(({ data }) => setMine((data || []).filter((o) => o.slug === slug)));
    };
    supabase.auth.getSession().then(({ data }) => use(data.session));
    // Supabase calls must not run inside this callback (they can lock up), so run them just after it.
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setTimeout(() => use(session), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [slug]);
  const loadShop = useCallback(
    () =>
      supabase.rpc('get_storefront', { p_slug: slug }).then(({ data, error }) => {
        // a connection problem keeps the page's products if it had them, and says so; it never says the shop is closed
        if (error) setState((s) => ({ ...s, loading: false, error }));
        else
          setState({
            loading: false,
            shop: data && data.shop,
            products: (data && data.products) || [],
            error: null,
          });
      }),
    [slug],
  );
  useEffect(() => {
    loadShop();
  }, [loadShop]);
  // the cart from last time, fitted to what's in stock now; from then on every change is kept in this browser
  useEffect(() => {
    if (restored.current || state.loading || !state.shop) return;
    restored.current = true;
    const fit = fitCart(loadCart(slug), state.products);
    setCart(fit.items);
    setCartNote(fit.note);
    setReady(true);
  }, [state.loading, state.shop, state.products, slug]);
  useEffect(() => {
    if (restored.current) saveCart(slug, cart);
  }, [cart, slug]);
  useBusy(state.loading || busy);
  // the Shops tab keeps this shop, with three of its product photos and a short line on what it sells
  useEffect(() => {
    if (!state.shop) return;
    const ps = state.products;
    const pics = [...ps.filter((p) => p.stock > 0), ...ps.filter((p) => !(p.stock > 0))]
      .map((p) => p.photo_path)
      .filter(Boolean);
    rememberShop(slug, state.shop.name, {
      photos: [...new Set(pics)].slice(0, 3),
      blurb: ps.length ? (ps.length > 1 ? `${ps[0].name} and ${ps.length - 1} more` : ps[0].name) : '',
    });
  }, [state.shop, state.products, slug]);
  // and what's in its cart comes to (shown on the Shops tab)
  const subNow = useRef(0);
  useEffect(() => {
    if (ready) noteShop(slug, { cartTotal: subNow.current });
  }, [cart, ready, slug]);
  const hint = useTypingHint(
    state.products.slice(0, 6).map((p) => p.name),
    'Search ' + (state.shop ? state.shop.name : 'this shop'),
    step === 'shop' && !find && !inSearch,
  );
  // a shop writes about another order while they browse: a pop-up, and the count on My orders
  const inbox = useInbox(uid, { title: state.shop ? state.shop.name : 'ShopDesk' });
  const closeSheet = useCallback(() => setPicking(null), []);
  // the bar at the bottom on the shop and the cart (not on checkout)
  const tabs = checkout ? null : (
    <CustomerTabs
      active={step === 'cart' ? 'cart' : 'shops'}
      unread={inbox.count}
      shopNews={inbox.shopCount}
    />
  );

  if (state.loading)
    return (
      <Page tabs={tabs}>
        <Skeleton kind={step === 'shop' ? 'shop' : 'list'} />
      </Page>
    );
  if (!state.shop && state.error)
    return (
      <Page>
        <LoadError error={state.error} onRetry={loadShop} what="this shop" />
      </Page>
    );
  if (!state.shop)
    return (
      <Page>
        <div className="center">
          <h2>This shop isn't taking orders</h2>
          <p className="note">Check the link with the shop.</p>
        </div>
      </Page>
    );
  const { shop, products } = state;
  // the cart, line by line: a product, or a product in one size
  const lines = [];
  products.forEach((p) => {
    if (options(p).length)
      options(p).forEach((o) => {
        const q = cart[p.id + ':' + o.id] || 0;
        if (q > 0)
          lines.push({ key: p.id + ':' + o.id, p, o, q, price: payPrice(o), name: `${p.name} · ${o.name}` });
      });
    else if (cart[p.id] > 0) lines.push({ key: p.id, p, q: cart[p.id], price: payPrice(p), name: p.name });
  });
  const sub = lines.reduce((a, l) => a + l.q * l.price, 0);
  subNow.current = sub;
  const sheet = picking && products.find((p) => p.id === picking);
  const words = find.trim().toLowerCase();
  const shown = words ? products.filter((p) => p.name.toLowerCase().includes(words)) : products;
  const custPays = shop.delivery_paid_by === 'customer';
  const set = (id, q) => {
    setCart((c) => ({ ...c, [id]: Math.max(0, q) }));
    setCartNote('');
  };
  const count = lines.reduce((a, l) => a + l.q, 0);
  const toShop = () => navigate('/' + slug);
  const toCart = () => navigate('/' + slug + '/cart');
  const toCheckout = () => navigate('/' + slug + '/checkout');
  // the top bar on every page of the shop: the shop's name (back to the shop) and My orders
  const top = { title: shop.name, titleHref: '/' + slug, tabs };
  const foot = (
    <footer className="page-foot">
      <button className="linkbtn" onClick={() => setReporting(!reporting)} aria-expanded={reporting}>
        Report this shop
      </button>
      <span aria-hidden="true">·</span>
      <a href="/privacy">Privacy</a>
    </footer>
  );
  // returning customers see their saved details in one line, with Change; first-timers fill them in
  const detailsForm = editDetails || !(saved && saved.name && saved.phone);
  const addrForm = editAddr || !(saved && saved.address && form.address);

  async function place() {
    const items = lines.map((l) => ({ product_id: l.p.id, ...(l.o ? { option_id: l.o.id } : {}), qty: l.q }));
    if (!items.length) {
      setMsg('Pick at least one item.');
      return;
    }
    if (!form.name.trim()) {
      setEditDetails(true);
      setMsg('Add your name.');
      return;
    }
    if (!/\d{7,}/.test(form.phone.replace(/\D/g, ''))) {
      setEditDetails(true);
      setMsg('Add your phone number.');
      return;
    }
    if (form.mode === 'delivery' && form.address.trim().length < 3) {
      setEditAddr(true);
      setMsg('Add your delivery address, or choose pick-up.');
      return;
    }
    setBusy(true);
    setMsg('');
    const { data, error } = await supabase.rpc('place_order', {
      p_slug: slug,
      p_customer: { ...form, source: sourceFor(slug) },
      p_items: items,
    });
    setBusy(false);
    if (error) {
      setMsg(errText(error));
      // something sold out or changed meanwhile: show today's stock and fit the cart to it
      if (error.code === 'P0001') {
        const fresh = await supabase.rpc('get_storefront', { p_slug: slug });
        if (!fresh.error && fresh.data) {
          setState((st) => ({ ...st, shop: fresh.data.shop, products: fresh.data.products || [] }));
          const fit = fitCart(cart, fresh.data.products || []);
          setCart(fit.items);
          setCartNote(fit.note);
        }
      }
      return;
    }
    rememberOrder(data.token);
    clearCart(slug);
    kick();
    navigate('/o/' + data.token);
  }

  if (step === 'shop')
    return (
      <Page {...top}>
        <div>
          <h2>{shop.name}</h2>
          <p className="note">Pick what you want, then pay in one transfer.</p>
        </div>
        {cartNote && <p className="note cart-note">{cartNote}</p>}
        {products.length > 4 && (
          <div className="search">
            <label htmlFor="shopSearch" className="visually-hidden">
              Search {shop.name}
            </label>
            <input
              id="shopSearch"
              type="search"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onFocus={() => setInSearch(true)}
              onBlur={() => setInSearch(false)}
              placeholder={hint}
              autoComplete="off"
            />
          </div>
        )}
        {words && !shown.length && (
          <p className="note">
            Nothing here matches “{find.trim()}”.{' '}
            <button className="linkbtn" onClick={() => setFind('')}>
              Show everything
            </button>
          </p>
        )}
        {products.length ? (
          <div className="grid">
            {shown.map((p) => {
              const opts = options(p);
              const q = opts.length
                ? opts.reduce((a, o) => a + (cart[p.id + ':' + o.id] || 0), 0)
                : cart[p.id] || 0;
              const pf = priceFrom(p);
              const sale = opts.length ? pf.sale : onSale(p);
              return (
                <div className="pcard" key={p.id}>
                  <div className={'pimg' + (p.stock ? '' : ' out')}>
                    <img src={photoUrl(p.photo_path)} alt={p.name} loading="lazy" />
                    {sale && p.stock > 0 && <span className="saletag">Sale</span>}
                    {p.stock > 0 && opts.length > 0 && (
                      <div className="pill">
                        {q > 0 && <span className="qty">{q}</span>}
                        <button
                          className="step"
                          data-inc="1"
                          onClick={() => setPicking(p.id)}
                          aria-label={`Choose a ${optionWord(p)} of ${p.name}`}
                        >
                          +
                        </button>
                      </div>
                    )}
                    {p.stock > 0 && !opts.length && (
                      <div className="pill">
                        {q > 0 && (
                          <>
                            <button
                              className="step"
                              onClick={() => set(p.id, q - 1)}
                              aria-label={'One less ' + p.name}
                            >
                              −
                            </button>
                            <span className="qty">{q}</span>
                          </>
                        )}
                        <button
                          className="step"
                          data-inc="1"
                          onClick={() => set(p.id, Math.min(p.stock, q + 1))}
                          disabled={q >= p.stock}
                          aria-label={'Add ' + p.name}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="pname">{p.name}</div>
                  <div className="row">
                    <span className="pprice">
                      {opts.length ? (
                        <>
                          {pf.from ? <span className="from">from </span> : null}
                          {naira(pf.price)}
                          {pf.was ? (
                            <>
                              {' '}
                              <s className="was">{naira(pf.was)}</s>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <Price x={p} />
                      )}
                    </span>
                    {!opts.length && p.stock > 0 && p.stock <= 3 && (
                      <span className="sub">{p.stock} left</span>
                    )}
                  </div>
                  {opts.length > 0 && p.stock > 0 && (
                    <button className="linkbtn optnames" onClick={() => setPicking(p.id)}>
                      {opts.map((o) => o.name).join(' · ')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="note">This shop hasn't added products yet.</p>
        )}
        {foot}
        {reporting && (
          <ReportShopForm slug={slug} orders={mine} signedIn={me !== ''} done={() => setReporting(false)} />
        )}
        {sheet && <OptionSheet p={sheet} cart={cart} set={set} onClose={closeSheet} />}
        <InboxToast inbox={inbox} />
      </Page>
    );

  if (!ready)
    return (
      <Page {...top}>
        <Skeleton kind="list" />
      </Page>
    );
  if (!lines.length)
    return (
      <Page {...top}>
        <div className="center empty">
          <span className="empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M3 4h2.2l2.3 10.6a1.6 1.6 0 0 0 1.6 1.3h8.1a1.6 1.6 0 0 0 1.6-1.2L20.6 8H6" />
              <circle cx="9.5" cy="19.6" r="1.3" />
              <circle cx="17" cy="19.6" r="1.3" />
            </svg>
          </span>
          <h2>Your cart is empty</h2>
          {cartNote ? (
            <p className="note cart-note">{cartNote}</p>
          ) : (
            <p className="note">Add something from {shop.name}.</p>
          )}
          <button className="btn" onClick={toShop}>
            Start shopping
          </button>
        </div>
        <InboxToast inbox={inbox} />
      </Page>
    );

  // ---------- the cart: what's in it, how many of each, and on to checkout ----------
  if (cartPage)
    return (
      <Page {...top}>
        <div className="page-head">
          <h2>Your cart</h2>
          <span className="sub">
            {count} item{count === 1 ? '' : 's'}
          </span>
        </div>
        {isShop && (
          <p className="note">
            <strong>This email runs a shop.</strong> {me} can't order.{' '}
            <button className="linkbtn" onClick={signOut}>
              Sign out
            </button>{' '}
            and use another email to order.
          </p>
        )}
        {cartNote && <p className="note cart-note">{cartNote}</p>}
        <section className="card boxed cart" aria-label="Your cart">
          <ul className="oitems">
            {lines.map((l) => {
              const left = l.o ? l.o.stock : l.p.stock;
              return (
                <li key={l.key} className="oitem cart-line">
                  <img className="oitem-img" src={photoUrl(l.p.photo_path)} alt="" />
                  <span className="oitem-name">
                    {l.name}
                    <span className="sub num">
                      {' '}
                      {l.q > 1 ? `${naira(l.price)} each · ` : ''}
                      {naira(l.price * l.q)}
                    </span>
                  </span>
                  <span className="stepper">
                    <button
                      className="step"
                      onClick={() => set(l.key, l.q - 1)}
                      aria-label={l.q === 1 ? `Remove ${l.name}` : `One less ${l.name}`}
                    >
                      {l.q === 1 ? '×' : '−'}
                    </button>
                    <span className="qty">{l.q}</span>
                    <button
                      className="step"
                      onClick={() => set(l.key, Math.min(left, 99, l.q + 1))}
                      disabled={l.q >= Math.min(left, 99)}
                      aria-label={`One more ${l.name}`}
                    >
                      +
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="row">
            <span className="sub">Items</span>
            <span className="num">{naira(sub)}</span>
          </div>
          <div className="row">
            <span className="sub">Delivery</span>
            <span className="sub">{custPays ? 'The shop adds it' : 'Free'}</span>
          </div>
        </section>
        <div className="stack-sm">
          <button className="btn" onClick={toCheckout}>
            Checkout · {naira(sub)}
          </button>
          <button className="btn ghost" onClick={toShop}>
            Continue shopping
          </button>
        </div>
        <InboxToast inbox={inbox} />
      </Page>
    );

  // ---------- checkout: who it's for, how it gets to them, and the order ----------
  const feeText = form.mode === 'pickup' ? 'None (pick-up)' : custPays ? 'The shop adds it' : 'Free';
  return (
    <Page {...top} back={'/' + slug + '/cart'}>
      <div className="checkout-head">
        <h2>Checkout</h2>
      </div>
      {me === null ? (
        <Skeleton kind="list" />
      ) : me === '' ? (
        <section className="card">
          <SignIn compact title="Sign in to order" path={'/' + slug + '/checkout'} note="Your cart stays." />
          <p className="note" style={{ fontSize: 12 }}>
            <a href="/privacy">Privacy</a>
          </p>
        </section>
      ) : isShop ? (
        <section className="card boxed">
          <h2 style={{ fontSize: 16, margin: 0 }}>This email runs a shop</h2>
          <p className="note">{me} runs a shop. Sign out and use another email to order.</p>
          <div className="btns">
            <button className="btn small" onClick={signOut}>
              Sign out
            </button>
            <a className="linkbtn" href="/">
              Go to my shop
            </a>
          </div>
        </section>
      ) : (
        <>
          <section className="card" aria-label="Your details">
            <div className="row">
              <h3 className="co-title">Your details</h3>
              {!detailsForm && (
                <button className="linkbtn" onClick={() => setEditDetails(true)}>
                  Change
                </button>
              )}
            </div>
            {detailsForm ? (
              <>
                <div className="field">
                  <label htmlFor="cName">Your name</label>
                  <input
                    id="cName"
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Funmi"
                  />
                </div>
                <div className="field">
                  <label htmlFor="cPhone">Phone number</label>
                  <input
                    id="cPhone"
                    inputMode="tel"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="e.g. 0809 123 4567"
                  />
                </div>
              </>
            ) : (
              <p className="co-line">
                {form.name} · <span className="num">{form.phone}</span>
              </p>
            )}
          </section>
          <section className="card" aria-label="Delivery">
            <h3 className="co-title">Delivery</h3>
            <div className="choices" role="radiogroup" aria-label="Delivery or pick-up">
              <button
                className="choice"
                role="radio"
                aria-checked={form.mode === 'delivery'}
                onClick={() => setForm({ ...form, mode: 'delivery' })}
              >
                <strong>Deliver to me</strong>
                <span>{custPays ? 'The shop adds the delivery fee' : 'Free delivery'}</span>
                <i aria-hidden="true" />
              </button>
              <button
                className="choice"
                role="radio"
                aria-checked={form.mode === 'pickup'}
                onClick={() => setForm({ ...form, mode: 'pickup' })}
              >
                <strong>I'll pick it up</strong>
                <span>The shop tells you when it's ready</span>
                <i aria-hidden="true" />
              </button>
            </div>
            {form.mode === 'delivery' &&
              (addrForm ? (
                <div className="field">
                  <label htmlFor="cAddr">Delivery address</label>
                  <input
                    id="cAddr"
                    autoComplete="street-address"
                    value={form.address}
                    onChange={(e) => {
                      const address = e.target.value;
                      // the area comes from what they type ("…, Lekki Phase 1"), unless they picked one themselves
                      setForm((f) => ({ ...f, address, area: areaPicked ? f.area : areaIn(address) }));
                    }}
                    placeholder="House number, street and area"
                  />
                  <span className="area-line">
                    {form.area ? (
                      <>
                        Area: <strong>{form.area}</strong>
                      </>
                    ) : (
                      'Add your area so the shop knows where you are.'
                    )}{' '}
                    <button className="linkbtn" onClick={() => setAreaOpen(true)}>
                      {form.area ? 'Change' : 'Pick area'}
                    </button>
                  </span>
                </div>
              ) : (
                <div className="co-addr">
                  <div className="row">
                    <span className="sub">Deliver to</span>
                    <button className="linkbtn" onClick={() => setEditAddr(true)}>
                      Change
                    </button>
                  </div>
                  <p className="co-line">
                    {form.address}
                    {form.area && <span className="area-tag">{form.area}</span>}
                  </p>
                </div>
              ))}
            {areaOpen && (
              <AreaPicker
                value={form.area}
                onPick={(a) => {
                  setAreaPicked(true);
                  setForm((f) => ({ ...f, area: a }));
                }}
                onClose={() => setAreaOpen(false)}
              />
            )}
          </section>
          <section className="card" aria-label="Order summary">
            <div className="row">
              <h3 className="co-title">
                Order summary · {count} item{count === 1 ? '' : 's'}
              </h3>
              <button className="linkbtn" onClick={toCart}>
                Edit cart
              </button>
            </div>
            {cartNote && <p className="note cart-note">{cartNote}</p>}
            <ul className="co-items">
              {lines.map((l) => (
                <li key={l.key}>
                  <span>
                    <strong>{l.q} ×</strong> {l.name}
                  </span>
                  <span className="num">{naira(l.price * l.q)}</span>
                </li>
              ))}
            </ul>
            <div className="row">
              <span className="sub">Items</span>
              <span className="num">{naira(sub)}</span>
            </div>
            <div className="row">
              <span className="sub">Delivery</span>
              <span className="sub">{feeText}</span>
            </div>
            <div className="row co-total">
              <span>Total</span>
              <span className="num">
                {naira(sub)}
                {form.mode === 'delivery' && custPays ? ' + delivery' : ''}
              </span>
            </div>
            <p className="note">
              {shop.allow_part_payment
                ? 'You can pay in parts.'
                : 'Pay in one transfer. It’s packed once it lands.'}
            </p>
            {msg && <p className="err">{msg}</p>}
            <button className="btn" onClick={place} disabled={busy || !sub}>
              {busy ? 'Placing your order…' : 'Place order'}
            </button>
            <p className="note" style={{ fontSize: 12 }}>
              Signed in as {me}. <a href="/privacy">Privacy</a>
            </p>
          </section>
        </>
      )}
      <InboxToast inbox={inbox} />
    </Page>
  );
}
