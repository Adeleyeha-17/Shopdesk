// Phone alerts and live updates.
//   kick()          asks the push sender to send whatever alerts are waiting (call it after anything happens)
//   alertsState()   what this phone can do: 'on', 'off', 'blocked', 'install' (iPhone: add to Home Screen first) or 'none'
//   turnOnAlerts()  asks the phone for permission and saves it to the signed-in account
//   useLive()       runs a function the moment a new alert arrives for this account (and when the app comes back into view);
//                   it also tells ShopDesk the app is open, so nobody gets an email about something they've already seen
//   useUnread()     unread alerts by order, so screens can show "new message" dots
//   useCount()      shows the unread count in the tab title and on the app icon
//   signOut()       stops this phone's alerts for the account, then signs out
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './database.js';

// ---------- the push sender ----------
let kickTimer = null;
export function kick() {
  if (!supabase || !supabase.functions) return;
  clearTimeout(kickTimer);
  kickTimer = setTimeout(() => {
    supabase.functions.invoke('push', { body: { action: 'flush' } }).catch(() => {});
  }, 250);
}

// ---------- this phone ----------
const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isInstalled = () =>
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  window.navigator.standalone === true;
const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function alertsState() {
  if (!canPush()) return isIos() && !isInstalled() ? 'install' : 'none';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission === 'granted') return 'on';
  return 'off';
}

function keyBytes(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const sameKey = (sub, key) => {
  const a =
    sub.options && sub.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
  const b = keyBytes(key);
  return !!a && a.length === b.length && a.every((x, i) => x === b[i]);
};

let publicKey = null;
async function serverKey() {
  if (publicKey) return publicKey;
  const { data, error } = await supabase.functions.invoke('push', { body: { action: 'key' } });
  if (error || !data || !data.key) throw new Error("Alerts aren't available right now. Try again later.");
  publicKey = data.key;
  return publicKey;
}

// Saves this phone for the signed-in account. ask=false only renews an existing permission (no prompt).
export async function turnOnAlerts(ask = true) {
  if (!canPush()) return false;
  let perm = Notification.permission;
  if (perm === 'default' && ask) perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const key = await serverKey();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub)
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  const j = sub.toJSON();
  const { error } = await supabase.rpc('save_push_sub', {
    p_endpoint: j.endpoint,
    p_p256dh: j.keys.p256dh,
    p_auth: j.keys.auth,
  });
  if (error) throw error;
  return true;
}

export async function signOut() {
  try {
    if (canPush() && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await supabase.rpc('delete_push_sub', { p_endpoint: sub.endpoint });
    }
  } catch (e) {
    /* signing out still works */
  }
  await supabase.auth.signOut();
}

// "Add to home screen" on Android and laptops: the browser's own prompt, kept until we use it.
let installEvent = null;
const installWatchers = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    installWatchers.forEach((f) => f(true));
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    installWatchers.forEach((f) => f(false));
  });
}
export function useInstall() {
  const [can, setCan] = useState(!!installEvent);
  useEffect(() => {
    installWatchers.add(setCan);
    return () => installWatchers.delete(setCan);
  }, []);
  const install = useCallback(async () => {
    if (!installEvent) return false;
    installEvent.prompt();
    const r = await installEvent.userChoice.catch(() => null);
    installEvent = null;
    setCan(false);
    return !!r && r.outcome === 'accepted';
  }, []);
  return [can, install];
}

// ---------- live updates ----------
// Each screen gets its own channel name: two screens listening on one name would close each other.
let seq = 0;
export const channelName = (base) => base + '-' + ++seq + '-' + Math.random().toString(36).slice(2, 7);

// "I'm open": when the app opens, comes back into view, and every few minutes while on screen (at most once a minute).
// The email backup only writes to people who haven't had ShopDesk open since something happened.
let lastSeen = 0;
function seenNow() {
  if (document.visibilityState !== 'visible' || Date.now() - lastSeen < 60000) return;
  lastSeen = Date.now();
  supabase.rpc('seen_app').then(
    () => {},
    () => {},
  );
}

// run(alert) is called for every new alert for this account; run(null) when the app comes back into view.
export function useLive(userId, run) {
  const ref = useRef(run);
  ref.current = run;
  useEffect(() => {
    if (!userId || !supabase) return undefined;
    const ch = supabase
      .channel(channelName('alerts-' + userId))
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + userId },
        (p) => ref.current(p.new),
      )
      .subscribe();
    const back = () => {
      if (document.visibilityState !== 'visible') return;
      seenNow();
      ref.current(null);
    };
    seenNow();
    const beat = setInterval(seenNow, 4 * 60000);
    const fromWorker = (e) => e.data && e.data.type === 'shopdesk-alert' && ref.current(e.data.alert);
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    window.addEventListener('online', back);
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', fromWorker);
    return () => {
      clearInterval(beat);
      supabase.removeChannel(ch);
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
      window.removeEventListener('online', back);
      if (navigator.serviceWorker) navigator.serviceWorker.removeEventListener('message', fromWorker);
    };
  }, [userId]);
}

// Unread alerts for this account: { list, loaded, byOrder: {id: n}, chats: {id: n}, reload, markRead(order, kind) }
export function useUnread(userId) {
  const [list, setList] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('notifications')
      .select('id, order_id, kind')
      .is('read_at', null)
      .order('id', { ascending: false })
      .limit(300);
    setList(data || []);
    setLoaded(true);
  }, [userId]);
  useEffect(() => {
    reload();
  }, [reload]);
  const markRead = useCallback(async (order, kind) => {
    setList((l) =>
      l.filter((n) => !((order == null || n.order_id === order) && (kind == null || n.kind === kind))),
    );
    await supabase.rpc('mark_read', { p_order: order ?? null, p_kind: kind ?? null });
  }, []);
  const byOrder = {},
    chats = {};
  list.forEach((n) => {
    if (!n.order_id) return;
    byOrder[n.order_id] = (byOrder[n.order_id] || 0) + 1;
    if (n.kind === 'message') chats[n.order_id] = (chats[n.order_id] || 0) + 1;
  });
  return { list, loaded, byOrder, chats, reload, markRead };
}

// The unread count in the tab title ("(2) Bimpe's Beauty") and on the app icon, when the phone supports it.
export function useCount(count, base = 'ShopDesk') {
  useEffect(() => {
    const n = count > 9 ? '9+' : String(count);
    document.title = count > 0 ? `(${n}) ${base}` : base;
    try {
      if (count > 0 && navigator.setAppBadge) navigator.setAppBadge(count).catch(() => {});
      else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
    } catch (e) {
      /* no app badge on this phone */
    }
  }, [count, base]);
}
