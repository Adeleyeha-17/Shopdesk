// The shop's chat with ShopDesk: a sheet over the app, opened from the Shop tab, a ShopDesk banner, an alert, or
// /?shopdesk=1 (where an alert about a ShopDesk message leads).
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ShopDeskThread } from '../shared/ShopDeskThread.jsx';

export function shopDeskFromUrl() {
  const q = new URLSearchParams(window.location.search);
  if (!q.has('shopdesk')) return false;
  window.history.replaceState(null, '', '/#shop');
  return true;
}

export function ShopDeskSheet({ shop, close, onRead }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [close]);
  return createPortal(
    <div className="overlay bottom" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal sheet desk-sheet" role="dialog" aria-modal="true" aria-labelledby="deskTitle">
        <div className="desk-head">
          <span className="desk-mark" aria-hidden="true" />
          <div>
            <h2 id="deskTitle" className="sheet-title">
              ShopDesk
            </h2>
            <span className="sub">We reply here</span>
          </div>
          <button className="linkbtn" onClick={close}>
            Close
          </button>
        </div>
        <ShopDeskThread
          me="shop"
          shopId={shop.id}
          onRead={onRead}
          empty="Questions, problems or ideas? Write to us here."
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
