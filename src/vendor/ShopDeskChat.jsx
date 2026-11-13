// The shop's chat with ShopDesk: a sheet over the app, opened from the Shop tab, a ShopDesk banner, an alert, or
// /?shopdesk=1 (where an alert about a ShopDesk message leads).
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ShopDeskThread } from '../shared/ShopDeskThread.jsx';

export function shopDeskFromUrl() {
  const q = new URLSearchParams(window.location.search);
  if (!q.has('shopdesk')) return false;
  window.history.replaceState(null, '', '/#shop');
  return true;
}

const BACK_CLOSES = true; // the demo, shown inside another page, closes it without the browser's history

export function ShopDeskSheet({ shop, close, onRead }) {
  // the phone's back button closes the chat, like leaving a page
  const shut = useRef(close);
  shut.current = close;
  const pushed = useRef(false);
  const leave = () => (pushed.current ? window.history.back() : shut.current());
  useEffect(() => {
    try {
      if (BACK_CLOSES) {
        window.history.pushState({ shopdesk: true }, '');
        pushed.current = true;
      }
    } catch (e) {
      /* this view doesn't allow it: Back closes it instead */
    }
    const back = () => shut.current();
    const esc = (e) => e.key === 'Escape' && (pushed.current ? window.history.back() : shut.current());
    window.addEventListener('popstate', back);
    window.addEventListener('keydown', esc);
    document.body.classList.add('desk-open');
    return () => {
      window.removeEventListener('popstate', back);
      window.removeEventListener('keydown', esc);
      document.body.classList.remove('desk-open');
    };
  }, []);
  return createPortal(
    <div className="overlay desk-overlay" onClick={(e) => e.target === e.currentTarget && leave()}>
      <div className="modal desk-sheet" role="dialog" aria-modal="true" aria-labelledby="deskTitle">
        <div className="desk-head">
          <button className="back-btn" onClick={leave} aria-label="Back">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <span className="desk-mark" aria-hidden="true" />
          <div>
            <h2 id="deskTitle" className="sheet-title">
              ShopDesk
            </h2>
            <span className="sub">We reply here</span>
          </div>
        </div>
        <ShopDeskThread
          me="shop"
          shopId={shop.id}
          onRead={onRead}
          empty="Questions, problems or ideas? Write to us here. You can send photos and videos too."
        />
      </div>
    </div>,
    document.body,
  );
}

// On the Shop tab: the way in to the chat with ShopDesk.
export function ShopDeskCard({ unread, open }) {
  return (
    <section className="card">
      <button className="chat-toggle desk-row" onClick={open}>
        <span className="desk-mark" aria-hidden="true" />
        <strong>Message ShopDesk</strong>
        {unread > 0 && <span className="badge">{unread}</span>}
        <span className="sub" aria-hidden="true">
          ›
        </span>
      </button>
    </section>
  );
}

// At the top of every tab while ShopDesk has written and the shop hasn't read it.
export function ShopDeskBanner({ unread, open }) {
  if (!unread) return null;
  return (
    <div className="banner notice desk-banner">
      <strong>{unread === 1 ? 'New message from ShopDesk' : `${unread} new messages from ShopDesk`}</strong>
      <button className="linkbtn" onClick={open}>
        Open
      </button>
    </div>
  );
}
