// Admin > Messages: every shop's chat with ShopDesk, the newest first. Unread means the shop wrote and you haven't
// opened it. Start a chat with any shop from its page (Message).
import React from 'react';
import { atText } from '../lib/dates.js';

export function MessagesPage({ d, setModal }) {
  const list = d.threads || [];
  return (
    <>
      <div className="page-head">
        <h1>Messages</h1>
        <span className="sub">Shops see you as ShopDesk. To start a chat, open the shop and tap Message.</span>
      </div>
      <section className="panel flush">
        {list.length === 0 ? (
          <p className="note" style={{ padding: 20 }}>
            No messages yet.
          </p>
        ) : (
          <div className="rows">
            {list.map((t) => (
              <button
                key={t.shop_id}
                className={'arow thread-row' + (t.unread > 0 ? ' unread' : '')}
                onClick={() => setModal({ kind: 'message', shop: { id: t.shop_id, name: t.name, status: t.status } })}
              >
                <span className="thread-main">
                  <strong>{t.name}</strong>
                  <span className="sub">
                    {t.from === 'shopdesk' ? 'You: ' : ''}
                    {t.last}
                  </span>
                </span>
                <span className="thread-side">
                  <span className="sub">{atText(t.at)}</span>
                  {t.unread > 0 && <em className="count">{t.unread}</em>}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
