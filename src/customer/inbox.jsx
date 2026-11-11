// New messages reach customers wherever they are in ShopDesk: a red number on the Orders tab, in the tab title and on
// the app icon, and a pop-up the moment a shop writes (Open goes straight to that chat).
import React, { useRef } from 'react';
import { navigate } from '../lib/helpers.js';
import { useCount, useLive, useUnread } from '../lib/alerts.js';
import { Toast, useToast } from '../shared/Toast.jsx';

// onAlert(alert) runs for every alert (alert is null when the app comes back into view).
// quiet(alert) says when not to pop up (the chat it's for is already open on screen).
// open(alert) can handle Open itself (return true), e.g. open the chat on this page.
export function useInbox(uid, { onAlert, quiet, open, title } = {}) {
  const unread = useUnread(uid);
  const [toast, say, close] = useToast();
  const ref = useRef();
  ref.current = { onAlert, quiet, open };
  const last = useRef('');
  useLive(uid, (n) => {
    unread.reload();
    if (ref.current.onAlert) ref.current.onAlert(n);
    // a shop's chat message, or a message a shop sent its customers (shown on the Shops tab)
    if (!n || !['message', 'shop_message'].includes(n.kind) || (ref.current.quiet && ref.current.quiet(n)))
      return;
    // the same alert can come twice (live, and from the phone's alert); show it once
    const key = n.order_id + '|' + n.body;
    if (key === last.current) return;
    last.current = key;
    setTimeout(() => (last.current = ''), 10000);
    say({
      title: n.title,
      text: n.body,
      action: {
        label: 'Open',
        run: () => {
          if (ref.current.open && ref.current.open(n)) return;
          navigate(n.url || '/orders');
        },
      },
    });
  });
  // count: news on their orders (the Orders tab); shopCount: messages from shops (the Shops tab)
  const shopCount = unread.list.filter((n) => n.kind === 'shop_message').length;
  const count = unread.list.length - shopCount;
  useCount(count + shopCount, title || 'ShopDesk');
  return { unread, count, shopCount, toast, closeToast: close };
}

export function InboxToast({ inbox }) {
  return <Toast toast={inbox.toast} onClose={inbox.closeToast} low />;
}
