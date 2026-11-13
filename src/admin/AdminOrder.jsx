// One order as you see it on Problems, Reports and Records: what was ordered (with the product photo the customer saw), the money, when each step happened (and
// why it was cancelled), the packing photo, and the chat between the shop and the customer. A chat with no problem or report
// opens only with a reason; each look goes in the Log. While a problem is with you, you can write in the chat as ShopDesk.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { atText } from '../lib/dates.js';
import { errText } from '../lib/helpers.js';
import { photoUrl } from '../lib/photos.js';
import { PhotoStrip } from '../shared/OrderPhotos.jsx';
import { ChatView } from '../shared/Chat.jsx';
import { MessageBox } from '../shared/MessageBox.jsx';

export function AdminOrder({ o, canChat = true, caseId = null }) {
  const [chat, setChat] = useState(
    o && o.chat ? { messages: o.chat, shop: 'Shop', customer: o.customer_name } : null,
  );
  const [err, setErr] = useState('');
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState('');
  // a problem with you: the chat opens by itself, and you can write in it as ShopDesk
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (caseId && o && !chat)
      supabase.rpc('admin_order_chat', { p_order: o.id, p_reason: null }).then(({ data, error }) => !error && setChat(data));
  }, [caseId, o && o.id]);
  async function sendCase() {
    setSending(true);
    setErr('');
    const { data, error } = await supabase.rpc('admin_case_message', { p_problem: caseId, p_body: text });
    setSending(false);
    if (error) setErr(errText(error));
    else {
      setText('');
      setChat((c) => ({ ...c, messages: [...((c && c.messages) || []), data] }));
    }
  }
  if (!o) return null;
  const pickup = o.mode === 'pickup';
  const steps = [
    ['Ordered', o.created_at],
    ['Confirmed', o.confirmed_at],
    ['Customer said paid', o.customer_says_paid_at],
    ['Paid', o.paid_at],
    [pickup ? 'Ready for pick-up' : `With ${o.rider_name || 'the rider'}`, o.out_at],
    [pickup ? 'Promised from' : 'Promised by', o.deliver_by],
    [
      o.status === 'cancelled'
        ? 'Cancelled'
        : o.received_by === 'customer'
          ? 'Customer confirmed'
          : 'Shop marked delivered',
      o.done_at,
    ],
  ].filter((s) => s[1]);
  async function openChat() {
    setErr('');
    if (!o.chat_free && !asking) return setAsking(true);
    const { data, error } = await supabase.rpc('admin_order_chat', { p_order: o.id, p_reason: why || null });
    if (error) setErr(errText(error));
    else setChat(data);
  }
  return (
    <div className="admin-order">
      <div className="two-col">
        <div className="stack-sm">
          <span className="label">
            {o.code} · {o.customer_name} · {pickup ? 'pick-up' : 'delivery'}
          </span>
          {(o.items || []).map((i, k) => (
            <div className="row" key={k}>
              <span className="item-line">
                {i.photo && (
                  <a href={photoUrl(i.photo)} target="_blank" rel="noreferrer" title="What the customer saw">
                    <img className="thumb sm" src={photoUrl(i.photo)} alt="" />
                  </a>
                )}
                {i.qty} × {i.name} {i.packed ? <span className="sub">· packed</span> : null}
              </span>
              <span className="num">{naira(i.price * i.qty)}</span>
            </div>
          ))}
          {!pickup && (
            <div className="row">
              <span className="sub">Delivery{o.delivery_paid_by === 'vendor' ? ' (shop pays)' : ''}</span>
              <span className="num">{o.delivery_fee == null ? 'not set' : naira(o.delivery_fee)}</span>
            </div>
          )}
          <div className="row">
            <span className="sub">Paid</span>
            <strong className="num">{naira(o.amount_paid)}</strong>
          </div>
          {(o.payments || []).map((pay, k) => (
            <span className="sub" key={k}>
              {naira(pay.amount)} · {atText(pay.at)} ·{' '}
              {pay.method === 'tap' ? 'shop confirmed' : 'bank alert'}
            </span>
          ))}
        </div>
        <div className="stack-sm">
          <span className="label">When</span>
          {steps.map(([t, at]) => (
            <span className="sub" key={t}>
              {t}: {atText(at)}
            </span>
          ))}
          {o.status === 'cancelled' && (
            <span className="sub">
              Why: {o.cancel_text || 'cancelled'}
              {o.cancel_note ? ` (“${o.cancel_note}”)` : ''}
            </span>
          )}
          {o.packing_photo && <PhotoStrip paths={[o.packing_photo]} label="Packing photo" />}
        </div>
      </div>
      {caseId ? (
        <div className="stack-sm case-chat">
          <span className="label">Their chat · what you write here, both of them see as ShopDesk</span>
          {chat ? (
            <ChatView
              messages={chat.messages}
              me="admin"
              names={{ shop: chat.shop, customer: chat.customer, shopdesk: 'ShopDesk (you)' }}
            />
          ) : (
            <p className="sub">Loading the chat…</p>
          )}
          <MessageBox value={text} onChange={setText} onSend={sendCase} busy={sending} />
        </div>
      ) : o.messages > 0 &&
        canChat &&
        (chat ? (
          <div className="stack-sm">
            <span className="label">Chat (read-only)</span>
            <ChatView
              messages={chat.messages}
              me="admin"
              names={{ shop: chat.shop, customer: chat.customer, shopdesk: 'ShopDesk' }}
            />
          </div>
        ) : asking ? (
          <div className="stack-sm">
            <div className="field">
              <label htmlFor={'why' + o.id}>Why are you reading this chat? (goes in the Log)</label>
              <input id={'why' + o.id} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={200} />
            </div>
            <div className="btns">
              <button className="btn small" onClick={openChat} disabled={why.trim().length < 5}>
                Read the chat
              </button>
              <button className="btn small ghost" onClick={() => setAsking(false)}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="btns">
            <button className="btn small ghost" onClick={openChat}>
              Read the chat ({o.messages})
            </button>
          </div>
        ))}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
