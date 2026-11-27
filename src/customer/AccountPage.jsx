// /account: the buyer's account as a short menu, each row opening its own page:
//   /account/details      name and phone (shops see them on orders), the sign-in email, Sign out, Delete my saved details
//   /account/addresses    delivery addresses: add, edit, remove
//   /account/preferences  alerts and appearance
// plus Order history (/orders/history) and Legal (/legal).
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { errText, navigate } from '../lib/helpers.js';
import { signOut } from '../lib/alerts.js';
import { useBusy } from '../lib/busy.js';
import { Page } from '../shared/Page.jsx';
import { Skeleton } from '../shared/Skeleton.jsx';
import { SignIn } from '../shared/SignIn.jsx';
import { EmailSwitch } from '../shared/EmailSwitch.jsx';
import { ThemePicker } from '../shared/ThemePicker.jsx';
import { CustomerTabs } from './CustomerTabs.jsx';
import { useInbox, InboxToast } from './inbox.jsx';
import { AccountAddresses, loadAddresses } from './Addresses.jsx';
import { isLive } from './MyOrdersPage.jsx';

const TITLES = { menu: 'Account', details: 'Profile details', addresses: 'Addresses', preferences: 'Preferences' };

// the small line icons on the menu rows
const ICONS = {
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.4-3.3 4.2-5 7.5-5s6.1 1.7 7.5 5" />,
  pin: <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z" />,
  clock: <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4M12 7.5V12l3 2" />,
  sliders: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4.5v5M6 14.5v5" />,
  doc: <path d="M7 3.5h7l4 4v13H7zM14 3.5v4h4M10 12h5M10 16h5" />,
  out: <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" />,
  bin: <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />,
};

export function MenuRow({ href, onClick, icon, label, sub, count, bad }) {
  const inside = (
    <>
      <svg className="mi" viewBox="0 0 24 24" aria-hidden="true">
        {ICONS[icon]}
      </svg>
      <span className="ml">
        <strong>{label}</strong>
        {sub && <span className="sub">{sub}</span>}
      </span>
      {count > 0 && <span className="mc">{count}</span>}
      {href && (
        <span className="chev" aria-hidden="true">
          ›
        </span>
      )}
    </>
  );
  const cls = 'menu-row' + (bad ? ' bad' : '');
  return href ? (
    <a className={cls} href={href}>
      {inside}
    </a>
  ) : (
    <button className={cls} onClick={onClick}>
      {inside}
    </button>
  );
}

export function AccountPage({ section = 'menu' }) {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useBusy(session === undefined);
  const title = TITLES[section];
  const back = section === 'menu' ? undefined : '/account';
  if (!session)
    return (
      <Page title={title} back={back} kind="me" tabs={<CustomerTabs active="account" />}>
        {session === undefined ? (
          <Skeleton kind="page" />
        ) : (
          <SignIn
            title="Your account"
            path={section === 'menu' ? '/account' : '/account/' + section}
            note="Sign in to see your details and orders."
            footer={
              <p className="note" style={{ fontSize: 12 }}>
                <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
              </p>
            }
          />
        )}
      </Page>
    );
  return <SignedInAccount email={session.user.email} userId={session.user.id} section={section} />;
}

// What the menu showed last time, so coming back to it shows straight away while it refreshes.
// Kept in memory only (gone when the tab closes) and only for the same account.
let last = null;

function SignedInAccount({ email, userId, section }) {
  const seen = last && last.userId === userId ? last : null;
  // saved details are shown as text; Edit opens a copy in the form, so a refresh never overwrites typing
  const [me, setMe] = useState(seen ? seen.me : { name: '', phone: '' });
  const [had, setHad] = useState(seen ? seen.had : false);
  const [counts, setCounts] = useState(seen ? seen.counts : { addresses: 0, past: 0 });
  const [draft, setDraft] = useState(null); // null: not editing
  const [confirmForget, setConfirmForget] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    last = { userId, me, had, counts };
  }, [userId, me, had, counts]);
  const load = useCallback(async () => {
    const [c, addrs, o] = await Promise.all([
      supabase.from('customers').select('name, phone').maybeSingle(),
      loadAddresses(),
      supabase.rpc('my_orders'),
    ]);
    if (c.data) {
      setMe({ name: c.data.name || '', phone: c.data.phone || '' });
      setHad(true);
    }
    setCounts({ addresses: addrs.length, past: (o.data || []).filter((x) => !isLive(x)).length });
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const inbox = useInbox(userId, { title: TITLES[section] });
  async function leave() {
    last = null;
    await signOut();
    navigate('/account', { replace: true });
  }
  async function save() {
    const row = { name: draft.name.trim().slice(0, 60), phone: draft.phone.trim().slice(0, 20) };
    const { error } = had
      ? await supabase
          .from('customers')
          .update({ ...row, updated_at: new Date().toISOString() })
          .not('user_id', 'is', null)
      : await supabase.from('customers').insert({ user_id: userId, ...row });
    if (error) return setMsg(errText(error));
    setMe(row);
    setHad(true);
    setDraft(null);
    setMsg('');
  }
  async function forget() {
    await supabase.from('customer_addresses').delete().not('user_id', 'is', null);
    const { error } = await supabase.from('customers').delete().not('user_id', 'is', null);
    if (error) return setMsg(errText(error));
    setHad(false);
    setMe({ name: '', phone: '' });
    setCounts((n) => ({ ...n, addresses: 0 }));
    setDraft(null);
    setConfirmForget(false);
    setMsg('');
  }
  // the round letter: the first letter of their email, like the Account tab
  const initial = ((email || '').trim()[0] || '?').toUpperCase();
  const tabs = <CustomerTabs active="account" unread={inbox.count} shopNews={inbox.shopCount} />;
  const back = section === 'menu' ? undefined : '/account';
  let body;
  if (section === 'details')
    body = (
      <>
        {msg && <p className="note">{msg}</p>}
        <section className="card">
          <div className="row">
            <h2>Your details</h2>
            {!draft && (
              <button
                className="btn small ghost"
                onClick={() => {
                  setDraft({ ...me });
                  setConfirmForget(false);
                }}
              >
                {had ? 'Edit' : 'Add'}
              </button>
            )}
          </div>
          {!draft ? (
            had && (me.name || me.phone) ? (
              <div className="saved-details">
                {me.name && <strong>{me.name}</strong>}
                {me.phone && <span>{me.phone}</span>}
              </div>
            ) : null
          ) : (
            <div className="stack-sm">
              <div className="field">
                <label htmlFor="mName">Name</label>
                <input
                  id="mName"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  autoComplete="name"
                />
              </div>
              <div className="field">
                <label htmlFor="mPhone">Phone number</label>
                <input
                  id="mPhone"
                  inputMode="tel"
                  autoComplete="tel"
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                />
              </div>
              <div className="btns">
                <button className="btn small" onClick={save}>
                  Save
                </button>
                <button className="linkbtn" onClick={() => setDraft(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
        <section className="card boxed signin-email">
          <span className="sub">Email</span>
          <strong>{email}</strong>
          <span className="sub">You sign in with this.</span>
        </section>
        <nav className="card boxed menu" aria-label="Sign out">
          <MenuRow icon="out" label="Sign out" onClick={leave} />
          {(had || counts.addresses > 0) && !confirmForget && (
            <MenuRow icon="bin" label="Delete my saved details" bad onClick={() => setConfirmForget(true)} />
          )}
        </nav>
        {confirmForget && (
          <div className="confirm-del" role="alert">
            <span>Delete your saved name, phone number and addresses? Your orders stay.</span>
            <div className="btns">
              <button className="btn small bad" onClick={forget}>
                Delete
              </button>
              <button className="linkbtn" onClick={() => setConfirmForget(false)}>
                Keep them
              </button>
            </div>
          </div>
        )}
      </>
    );
  else if (section === 'addresses') body = <AccountAddresses userId={userId} />;
  else if (section === 'preferences')
    body = (
      <>
        <section className="card">
          <EmailSwitch />
        </section>
        <ThemePicker />
      </>
    );
  else
    body = (
      <>
        <a className="card boxed profile" href="/account/details">
          <span className="avatar big" aria-hidden="true">
            {initial}
          </span>
          <div>
            <strong>{(had && me.name) || email}</strong>
            <span className="sub">{had && me.name ? email : 'Signed in'}</span>
          </div>
          <span className="chev" aria-hidden="true">
            ›
          </span>
        </a>
        <div className="menu-label">Personal</div>
        <nav className="card boxed menu" aria-label="Personal">
          <MenuRow href="/account/details" icon="user" label="Profile details" />
          <MenuRow href="/account/addresses" icon="pin" label="Addresses" count={counts.addresses} />
          <MenuRow href="/orders/history" icon="clock" label="Order history" count={counts.past} />
        </nav>
        <div className="menu-label">More</div>
        <nav className="card boxed menu" aria-label="More">
          <MenuRow href="/account/preferences" icon="sliders" label="Preferences" sub="Alerts and appearance" />
          <MenuRow href="/legal" icon="doc" label="Legal" sub="Terms, privacy and rules" />
        </nav>
      </>
    );
  return (
    <Page title={TITLES[section]} back={back} kind="me" tabs={tabs}>
      {body}
      <InboxToast inbox={inbox} />
    </Page>
  );
}
