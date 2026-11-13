// Admin: the ShopDesk chat with one shop, in a pop-up. Every Message button in Admin opens it, sometimes with a ready
// message to edit before sending. The shop sees it as "ShopDesk", never who wrote it.
import React, { useEffect } from 'react';
import { ShopDeskThread } from '../shared/ShopDeskThread.jsx';

// Ready messages for checking a shop before approving it.
const CHECKS = [
  ['Ask for photos', 'Please send 3 clear photos of the products you sell.'],
  ['Ask for a video', 'Please send a short video of your stock or your shop.'],
  ['Ask for Instagram', 'Do you sell on Instagram or another page? Please send the link.'],
  ['Ask for ID or CAC', 'Please send a photo of your ID card, or your CAC certificate if your business is registered.'],
];

export function MessagePopup({ m, close }) {
  const s = m.shop;
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [close]);
  const vetting = s.status === 'pending' || s.status === 'rejected';
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={'Message ' + s.name}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal desk-admin">
        <div className="panel-head">
          <div>
            <h3>{s.name}</h3>
            <span className="sub">They see your messages as ShopDesk.</span>
          </div>
          <button className="linkbtn" onClick={close}>
            Close
          </button>
        </div>
        <ShopDeskThread
          me="shopdesk"
          shopId={s.id}
          draft={m.text || ''}
          chips={vetting ? CHECKS : null}
          empty="No messages yet."
        />
      </div>
    </div>
  );
}
