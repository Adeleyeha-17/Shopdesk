// Admin: the ShopDesk chat with one shop, full screen on a phone and a large panel on a computer. Every Message button in Admin opens it, sometimes with a ready
// message to edit before sending. The shop sees it as "ShopDesk", never who wrote it.
import React from 'react';
import { ShopDeskThread } from '../shared/ShopDeskThread.jsx';
import { ChatScreen } from '../shared/ChatScreen.jsx';

// Ready messages for checking a shop before approving it.
const CHECKS = [
  ['Ask for photos', 'Please send 3 clear photos of the products you sell.'],
  ['Ask for a video', 'Please send a short video of your stock or your shop.'],
  ['Ask for Instagram', 'Do you sell on Instagram or another page? Please send the link.'],
  ['Ask for ID or CAC', 'Please send a photo of your ID card, or your CAC certificate if your business is registered.'],
];

export function MessagePopup({ m, close }) {
  const s = m.shop;
  const vetting = s.status === 'pending' || s.status === 'rejected';
  return (
    <ChatScreen title={s.name} sub="They see your messages as ShopDesk" close={close}>
      <ShopDeskThread
        me="shopdesk"
        shopId={s.id}
        draft={m.text || ''}
        chips={vetting ? CHECKS : null}
        empty="No messages yet."
      />
    </ChatScreen>
  );
}
