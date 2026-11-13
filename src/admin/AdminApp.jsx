// ShopDesk Admin at /admin. Only your one owner account gets in (the database checks it again on every call).
// Wide layout for a laptop: a menu on the left, the chosen page on the right, and one pop-up for every action.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { signOut } from '../lib/alerts.js';
import { errText } from '../lib/helpers.js';
import { SignIn } from '../shared/SignIn.jsx';
import { ThemeButton } from '../shared/ThemePicker.jsx';
import { LoadError } from '../shared/LoadError.jsx';
import { ActionPopup } from './ActionPopup.jsx';
import { MessagePopup } from './MessagePopup.jsx';
import { MessagesPage } from './MessagesPage.jsx';
import { CustomersPage } from './CustomersPage.jsx';
import { OverviewPage } from './OverviewPage.jsx';
import { AttentionPage } from './AttentionPage.jsx';
import { ProblemsPage } from './ProblemsPage.jsx';
import { ApplicationsPage } from './ApplicationsPage.jsx';
import { ShopsPage } from './ShopsPage.jsx';
import { ShopDetailPage } from './ShopDetailPage.jsx';
import { MoneyPage } from './MoneyPage.jsx';
import { AnnouncementsPage } from './AnnouncementsPage.jsx';
import { ReportsPage, LogPage } from './ReportsLogPage.jsx';
import { useLive } from '../lib/alerts.js';
import { RecordsPage } from './RecordsPage.jsx';
import { AlertsPrompt } from '../shared/AlertsPrompt.jsx';

// ShopDesk Admin. Only your one owner account gets past is_admin(); the database checks it again on every call.
export function AdminApp() {
  const [session, setSession] = useState(undefined);
  const [ok, setOk] = useState(undefined);
  const [checkErr, setCheckErr] = useState(null);
  // a failed check (no connection) is not the same as "not an admin": say which it was
  const check = useCallback(async () => {
    const { data, error } = await supabase.rpc('is_admin');
    if (error) setCheckErr(error);
    else {
      setCheckErr(null);
      setOk(!!data);
    }
  }, []);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session) check();
  }, [session, check]);
  useEffect(() => {
    if (session === null) setOk(undefined);
  }, [session]);
  const out = (
    <button className="linkbtn" onClick={signOut}>
      Sign out
    </button>
  );
  if (session === undefined || (session && ok === undefined))
    return (
      <AdminFrame>
        {checkErr ? (
          <LoadError error={checkErr} onRetry={check} what="Admin" />
        ) : (
          <p className="note">Loading…</p>
        )}
      </AdminFrame>
    );
  if (!session)
    return (
      <AdminFrame>
        <SignIn
          owner
          path="/admin"
          title="Admin sign-in"
          note="For the ShopDesk admin only."
        />
      </AdminFrame>
    );
  if (!ok)
    return (
      <AdminFrame right={out}>
        <div className="center">
          <h2>Not an admin account</h2>
          <p className="note">
            {session.user.email} is a shop account. Sign out, then sign in with the admin email.
          </p>
          <a className="btn ghost" href="/" style={{ textAlign: 'center', textDecoration: 'none' }}>
            Go to my shop
          </a>
        </div>
      </AdminFrame>
    );
  return <AdminLayout out={out} email={session.user.email} userId={session.user.id} />;
}

function AdminFrame({ children, right }) {
  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <div className="brand">
            <i aria-hidden="true" />
            ShopDesk Admin
          </div>
          {right}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

const NAV = [
  ['overview', 'Overview'],
  ['attention', 'Needs attention'],
  ['messages', 'Messages'],
  ['problems', 'Problems'],
  ['applications', 'Applications'],
  ['shops', 'Shops'],
  ['customers', 'Customers'],
  ['money', 'Payments & delivery'],
  ['notices', 'Announcements'],
  ['reports', 'Reports'],
  ['records', 'Records'],
  ['log', 'Log'],
];

function AdminLayout({ out, email, userId }) {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || 'overview');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const go = useCallback((r) => {
    window.location.hash = r;
  }, []);
  useEffect(() => {
    const f = () => {
      setRoute(window.location.hash.slice(1) || 'overview');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const load = useCallback(async () => {
    const names = [
      'admin_overview',
      'admin_attention',
      'admin_growth',
      'admin_reports',
      'admin_audit_log',
      'admin_announcements',
      'admin_problems',
      'admin_shop_threads',
    ];
    const res = await Promise.all(names.map((n) => supabase.rpc(n)));
    const bad = res.find((r) => r.error);
    if (bad) {
      setErr(errText(bad.error));
      return;
    }
    const [o, attention, growth, reports, audit, notices, problems, threads] = res.map((r) => r.data);
    setD({ o, attention, growth, reports, audit, notices, problems, threads });
    setErr('');
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);
  useLive(userId, () => load());
  const say = useCallback((t) => {
    setToast(t);
    clearTimeout(say.t);
    say.t = setTimeout(() => setToast(''), 4000);
  }, []);
  const ctx = { d, load, go, say, setModal };
  const [page, arg] = route.split('/');
  const counts = d
    ? {
        attention: d.attention.length,
        messages: (d.threads || []).reduce((n, t) => n + (t.unread || 0), 0),
        problems: (d.problems || []).filter((p) => p.status === 'with_shopdesk').length,
        applications: d.o.shops_pending,
        reports: d.reports.filter((r) => !r.resolved_at).length,
      }
    : {};
  return (
    <div className="admin">
      <header className="admin-top">
        <div className="brand">
          <i aria-hidden="true" />
          ShopDesk Admin
        </div>
        <div className="admin-me">
          <span className="sub">{email}</span>
          <ThemeButton />
          {out}
        </div>
      </header>
      <div className="admin-body">
        <nav className="admin-nav" aria-label="Admin sections">
          {NAV.map(([key, label]) => (
            <a
              key={key}
              href={'#' + key}
              className={'navlink' + (page === key || (page === 'shop' && key === 'shops') ? ' on' : '')}
            >
              <span>{label}</span>
              {counts[key] ? (
                <em className={['attention', 'messages', 'problems', 'reports'].includes(key) ? 'hot' : ''}>
                  {counts[key]}
                </em>
              ) : null}
            </a>
          ))}
        </nav>
        <main className="admin-main">
          {err && <p className="err">{err}</p>}
          <AlertsPrompt who="admin" userId={userId} />
          {!d ? (
            <p className="note">Loading…</p>
          ) : page === 'attention' ? (
            <AttentionPage {...ctx} />
          ) : page === 'messages' ? (
            <MessagesPage {...ctx} />
          ) : page === 'problems' ? (
            <ProblemsPage {...ctx} />
          ) : page === 'applications' ? (
            <ApplicationsPage {...ctx} />
          ) : page === 'customers' ? (
            <CustomersPage {...ctx} />
          ) : page === 'shops' ? (
            <ShopsPage {...ctx} />
          ) : page === 'shop' ? (
            <ShopDetailPage key={arg} id={arg} {...ctx} />
          ) : page === 'money' ? (
            <MoneyPage {...ctx} />
          ) : page === 'notices' ? (
            <AnnouncementsPage {...ctx} />
          ) : page === 'reports' ? (
            <ReportsPage {...ctx} />
          ) : page === 'records' ? (
            <RecordsPage {...ctx} />
          ) : page === 'log' ? (
            <LogPage {...ctx} />
          ) : (
            <OverviewPage {...ctx} />
          )}
        </main>
      </div>
      {modal && modal.kind === 'message' && (
        <MessagePopup
          m={modal}
          close={() => {
            setModal(null);
            load();
          }}
        />
      )}
      {modal && modal.kind !== 'message' && (
        <ActionPopup
          m={modal}
          close={() => setModal(null)}
          after={(msg, next) => {
            setModal(next || null);
            if (msg) say(msg);
            load();
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
