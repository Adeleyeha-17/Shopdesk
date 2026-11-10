// /orders: a customer's account. Every order they've placed (updating live, with a dot on orders with news),
// and the name, phone and address they saved.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { dayOf, whenText } from '../lib/dates.js';
import { errText } from '../lib/helpers.js';
import { signOut } from '../lib/alerts.js';
import { useInbox, InboxToast } from './inbox.jsx';
import { Page } from '../shared/Page.jsx';
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

// A customer's account: every order they've placed with ShopDesk shops, and their saved details.
export function MyOrdersPage() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined)
    return (
      <Page title="My orders">
        <p className="note">Loading…</p>
      </Page>
    );
  if (!session)
    return (
      <Page title="My orders">
        <SignIn
          title="Your orders"
          path="/orders"
          note="Sign in to follow your orders."
          footer={
            <p className="note" style={{ fontSize: 12 }}>
              <a href="/privacy">Privacy</a>
            </p>
          }
        />
      </Page>
    );
  return <SignedInOrders email={session.user.email} userId={session.user.id} />;
}

function SignedInOrders({ email, userId }) {
  const [orders, setOrders] = useState(null);
  const [me, setMe] = useState({ name: '', phone: '', address: '' });
  const [had, setHad] = useState(false);
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
      name: me.name.trim().slice(0, 60),
      phone: me.phone.trim().slice(0, 20),
      address: me.address.trim().slice(0, 160),
    };
    const { error } = had
      ? await supabase
          .from('customers')
          .update({ ...row, updated_at: new Date().toISOString() })
          .not('user_id', 'is', null)
      : await supabase.from('customers').insert({ user_id: userId, ...row });
    if (error) setMsg(errText(error));
    else {
      setHad(true);
      setMsg('Saved.');
    }
  }
  async function forget() {
    const { error } = await supabase.from('customers').delete().not('user_id', 'is', null);
    if (error) setMsg(errText(error));
    else {
      setHad(false);
      setMe({ name: '', phone: '', address: '' });
      setMsg('Deleted.');
    }
  }
  if (isShop)
    return (
      <Page
        title="My orders"
        right={
          <button className="linkbtn" onClick={signOut}>
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
            <button className="linkbtn" onClick={signOut}>
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
  return (
    <Page
      title="My orders"
      right={
        <button className="linkbtn" onClick={signOut}>
          Sign out
        </button>
      }
    >
      {msg && <p className="note">{msg}</p>}
      <AlertsPrompt who="customer" userId={userId} />
      {orders === null ? (
        loadErr ? (
          <LoadError error={loadErr} onRetry={load} what="your orders" compact />
        ) : (
          <p className="note">Loading your orders…</p>
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
              {past.map(row)}
            </>
          )}
        </>
      )}
      <section className="card">
        <h2>Your details</h2>
        <p className="note">Filled in for you next time.</p>
        <div className="field">
          <label htmlFor="mName">Name</label>
          <input id="mName" value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="mPhone">Phone number</label>
          <input
            id="mPhone"
            inputMode="tel"
            value={me.phone}
            onChange={(e) => setMe({ ...me, phone: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="mAddr">Delivery address</label>
          <input
            id="mAddr"
            value={me.address}
            onChange={(e) => setMe({ ...me, address: e.target.value })}
            placeholder="Street, area and a landmark"
          />
        </div>
        <div className="btns">
          <button className="btn small" onClick={save}>
            Save my details
          </button>
          {had && (
            <button className="linkbtn" onClick={forget}>
              Delete my saved details
            </button>
          )}
        </div>
      </section>
      <section className="card">
        <EmailSwitch />
      </section>
      <p className="note" style={{ fontSize: 12 }}>
        Signed in as {email}.
      </p>
      <InboxToast inbox={inbox} />
    </Page>
  );
}
