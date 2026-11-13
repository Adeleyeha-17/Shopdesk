// Chat inside one order, between the shop and the customer. New messages arrive by themselves.
// Messages can't be edited or deleted, so the chat is the record if a problem goes to ShopDesk.
// A customer sees a warning on any message from the shop with a different account number from the one on the order.
// Either side can report the other's message (tap it, then Report): rude, threats, scam or spam. ShopDesk sees it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { atText } from '../lib/dates.js';
import { errText } from '../lib/helpers.js';
import { uploadOrderPhoto } from '../lib/photos.js';
import { channelName, kick } from '../lib/alerts.js';
import { PhotoStrip, ChatVideo } from './OrderPhotos.jsx';

// Nigerian account numbers have 10 digits (phone numbers have 11, so they don't count).
const otherAccount = (t, mine) =>
  (
    String(t || '')
      .replace(/[\s.-]/g, '')
      .match(/\d+/g) || []
  ).some((d) => d.length === 10 && d !== String(mine || ''));

const REASONS = ['Rude or insulting', 'Threats', 'Scam', 'Spam'];

// Tap a message from the other side to report it.
function ReportMessage({ id, onClose }) {
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(reason) {
    setBusy(true);
    const { error } = await supabase.rpc('report_message', { p_message: id, p_reason: reason });
    setBusy(false);
    setOut(error ? errText(error) : 'Reported. ShopDesk will look.');
    if (!error) {
      kick();
      setTimeout(onClose, 1800);
    }
  }
  return (
    <div className="msg-report">
      {out ? (
        <span className="sub">{out}</span>
      ) : (
        <>
          <span className="sub">Report this message:</span>
          <div className="filters">
            {REASONS.map((r) => (
              <button key={r} className="filter" disabled={busy} onClick={() => send(r)}>
                {r}
              </button>
            ))}
            <button className="linkbtn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// The messages themselves. me: 'shop' | 'customer' | 'admin' (admin sees both sides, named, and flags).
export function ChatView({
  messages,
  me,
  names = {},
  warnPay = false,
  payAccount = '',
  listRef,
  canReport = false,
}) {
  const [menu, setMenu] = useState(null);
  const [reporting, setReporting] = useState(null);
  if (!messages.length) return <p className="sub chat-empty">No messages yet.</p>;
  return (
    <div className="chat-list" ref={listRef}>
      {messages.map((m) => {
        const mine = m.sender === me;
        const tappable = canReport && !mine && !m.pending && me !== 'admin';
        return (
          <React.Fragment key={m.id}>
            <div
              className={'msg ' + (mine ? 'mine' : 'theirs') + (m.pending ? ' pending' : '')}
              onClick={tappable ? () => setMenu(menu === m.id ? null : m.id) : undefined}
            >
              {me === 'admin' && <span className="msg-who">{names[m.sender] || m.sender}</span>}
              {m.photo && <PhotoStrip paths={[m.photo]} label="Photo" />}
              {(m.video || m.localVideo) && <ChatVideo path={m.video} local={m.localVideo} />}
              {m.body && <p>{m.body}</p>}
              <span className="msg-time">{m.pending ? 'Sending…' : atText(m.created_at)}</span>
              {warnPay && !mine && otherAccount(m.body, payAccount) && (
                <span className="msg-warn">Only pay to the account on your order.</span>
              )}
              {me === 'admin' && m.flag === 'other_account' && (
                <span className="msg-warn">Another account number</span>
              )}
            </div>
            {tappable && menu === m.id && reporting !== m.id && (
              <button className="linkbtn msg-act" onClick={() => setReporting(m.id)}>
                Report
              </button>
            )}
            {reporting === m.id && (
              <ReportMessage
                id={m.id}
                onClose={() => {
                  setReporting(null);
                  setMenu(null);
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function Chat({ orderId, me, open, onSeen, autoFocus = false, payAccount = '', canReport = false }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const listRef = useRef(null);
  const seen = useRef(onSeen);
  seen.current = onSeen;
  const add = useCallback((rows) => {
    setMsgs((cur) => {
      const all = [...(cur || [])];
      rows.forEach((r) => {
        const i = all.findIndex((x) => x.id === r.id);
        if (i >= 0) all[i] = r;
        else all.push(r);
      });
      return all
        .filter((x) => !x.pending || !rows.some((r) => r.body === x.body && r.photo === x.photo))
        .sort((a, b) => a.id - b.id);
    });
  }, []);
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('id, sender, body, photo, created_at')
      .eq('order_id', orderId)
      .order('id', { ascending: true })
      .limit(500);
    if (error) setErr(errText(error));
    else add(data || []);
  }, [orderId, add]);
  useEffect(() => {
    load();
    const ch = supabase
      .channel(channelName('chat-' + orderId))
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: 'order_id=eq.' + orderId },
        (p) => add([p.new]),
      )
      .subscribe();
    const t = setInterval(load, 15000);
    return () => {
      clearInterval(t);
      supabase.removeChannel(ch);
    };
  }, [orderId, load, add]);
  // Seen: clear the unread dot, and keep the newest message in view.
  const count = msgs ? msgs.length : 0;
  useEffect(() => {
    if (!count) return;
    if (seen.current) seen.current();
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  async function send(body, photo = null) {
    if (!body.trim() && !photo) return;
    setErr('');
    const temp = {
      id: Number.MAX_SAFE_INTEGER - Date.now(),
      sender: me,
      body: body.trim(),
      photo,
      pending: true,
    };
    setMsgs((cur) => [...(cur || []), temp]);
    const { data, error } = await supabase.rpc('send_message', {
      p_order: orderId,
      p_body: body,
      p_photo: photo,
    });
    if (error) {
      setMsgs((cur) => (cur || []).filter((x) => x !== temp));
      setErr(errText(error));
      return false;
    }
    add([data]);
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
      const path = await uploadOrderPhoto(orderId, 'm', file);
      await send('', path);
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  }
  return (
    <div className="chat">
      {msgs === null ? (
        <p className="sub chat-empty">Loading…</p>
      ) : (
        <ChatView
          messages={msgs}
          me={me}
          warnPay={me === 'customer'}
          payAccount={payAccount}
          listRef={listRef}
          canReport={canReport}
        />
      )}
      {open ? (
        <form className="chat-send" onSubmit={sendText}>
          <label className="chat-photo" htmlFor={'cp' + orderId} aria-label="Send a photo">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h3l2-2h6l2 2h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
            </svg>
          </label>
          <input
            id={'cp' + orderId}
            type="file"
            accept="image/*"
            className="visually-hidden"
            onChange={(e) => {
              sendPhoto(e.target.files && e.target.files[0]);
              e.target.value = '';
            }}
          />
          <textarea
            rows={1}
            value={text}
            maxLength={1000}
            placeholder="Message"
            aria-label="Message"
            autoFocus={autoFocus}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) sendText(e);
            }}
          />
          <button className="btn small" disabled={busy || !text.trim()}>
            Send
          </button>
        </form>
      ) : (
        <p className="sub chat-empty">Chat closed.</p>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
