// The ShopDesk chat: one shop and ShopDesk, inside the app. The shop sees every message from ShopDesk as "ShopDesk",
// never who wrote it. Used in the shop's app (me = 'shop') and in Admin (me = 'shopdesk'). New messages arrive by
// themselves; opening the chat marks the other side's messages read.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { errText } from '../lib/helpers.js';
import { uploadShopPhoto } from '../lib/photos.js';
import { kick } from '../lib/alerts.js';
import { ChatView } from './Chat.jsx';

export function ShopDeskThread({ me, shopId, draft = '', chips = null, onRead, empty }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const listRef = useRef(null);
  const read = useRef(onRead);
  read.current = onRead;
  const load = useCallback(async () => {
    const r =
      me === 'shop'
        ? await supabase.rpc('shopdesk_thread')
        : await supabase.rpc('admin_shop_thread', { p_shop: shopId });
    if (r.error) {
      setErr(errText(r.error));
      return;
    }
    setMsgs(me === 'shop' ? r.data || [] : (r.data && r.data.messages) || []);
    if (read.current) read.current();
  }, [me, shopId]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);
  const count = msgs ? msgs.length : 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);
  useEffect(() => setText(draft), [draft]);

  async function send(body, photo = null) {
    if (!body.trim() && !photo) return false;
    setErr('');
    const temp = { id: Number.MAX_SAFE_INTEGER - Date.now(), sender: me, body: body.trim(), photo, pending: true };
    setMsgs((cur) => [...(cur || []), temp]);
    const r =
      me === 'shop'
        ? await supabase.rpc('shopdesk_send', { p_body: body, p_photo: photo })
        : await supabase.rpc('admin_shop_send', { p_shop: shopId, p_body: body, p_photo: photo });
    if (r.error) {
      setMsgs((cur) => (cur || []).filter((x) => x !== temp));
      setErr(errText(r.error));
      return false;
    }
    setMsgs((cur) => [...(cur || []).filter((x) => x !== temp), r.data]);
    kick();
    return true;
  }
  async function sendText(e) {
    if (e) e.preventDefault();
    const t = text;
    if (!t.trim() || busy) return;
    setText('');
    setBusy(true);
    if (!(await send(t))) setText(t);
    setBusy(false);
  }
  async function sendPhoto(file) {
    if (!file) return;
    setBusy(true);
    try {
      await send('', await uploadShopPhoto(shopId, file));
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  }
  const inputId = 'sdp-' + me;
  return (
    <div className="chat desk-chat">
      {msgs === null ? (
        <p className="sub chat-empty">Loading…</p>
      ) : !msgs.length && empty ? (
        <p className="sub chat-empty">{empty}</p>
      ) : (
        <ChatView messages={msgs} me={me} listRef={listRef} />
      )}
      {chips && (
        <div className="filters desk-chips">
          {chips.map(([label, t]) => (
            <button key={label} type="button" className="filter" onClick={() => setText(t)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <form className="chat-send" onSubmit={sendText}>
        <label className="chat-photo" htmlFor={inputId} aria-label="Send a photo">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h3l2-2h6l2 2h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
          </svg>
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="visually-hidden"
          onChange={(e) => {
            sendPhoto(e.target.files && e.target.files[0]);
            e.target.value = '';
          }}
        />
        <textarea
          rows={me === 'shopdesk' && text.length > 60 ? 4 : 1}
          value={text}
          maxLength={2000}
          placeholder="Message"
          aria-label="Message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) sendText(e);
          }}
        />
        <button className="btn small" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
      {err && <p className="err">{err}</p>}
    </div>
  );
}
