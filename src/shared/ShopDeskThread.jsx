// The ShopDesk chat: one shop and ShopDesk, inside the app. The shop sees every message from ShopDesk as "ShopDesk",
// never who wrote it. Used in the shop's app (me = 'shop') and in Admin (me = 'shopdesk'). Text, photos and videos
// (recorded there and then, or picked from the phone). New messages arrive by themselves; opening the chat marks the
// other side's messages read.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { errText } from '../lib/helpers.js';
import { uploadShopPhoto, uploadShopVideo, VIDEO_SECONDS } from '../lib/photos.js';
import { kick } from '../lib/alerts.js';
import { ChatView } from './Chat.jsx';
import { MessageBox } from './MessageBox.jsx';

const ICONS = {
  plus: <path d="M12 5v14M5 12h14" />,
  photo: <path d="M4 7h3l2-2h6l2 2h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  record: <path d="M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5" />,
  video: <path d="M4 4h16v16H4zM10 9v6l5-3z" />,
};
const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {ICONS[name]}
  </svg>
);

export function ShopDeskThread({ me, shopId, draft = '', chips = null, onRead, empty }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [attach, setAttach] = useState(false);
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
    const rows = me === 'shop' ? r.data || [] : (r.data && r.data.messages) || [];
    // keep messages still sending on screen
    setMsgs((cur) => [...rows, ...(cur || []).filter((x) => x.pending)]);
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

  // temp: what shows while it sends; media: { photo } or { video }
  async function send(body, media = {}, temp = {}) {
    setErr('');
    const t = { id: Number.MAX_SAFE_INTEGER - Date.now(), sender: me, body: body.trim(), pending: true, ...temp };
    setMsgs((cur) => [...(cur || []), t]);
    try {
      let photo = media.photo || null;
      let video = null;
      if (media.photoFile) photo = await uploadShopPhoto(shopId, media.photoFile);
      if (media.videoFile) video = await uploadShopVideo(shopId, media.videoFile);
      const args = { p_body: body, p_photo: photo, p_video: video };
      const r =
        me === 'shop'
          ? await supabase.rpc('shopdesk_send', args)
          : await supabase.rpc('admin_shop_send', { p_shop: shopId, ...args });
      if (r.error) throw r.error;
      setMsgs((cur) => [...(cur || []).filter((x) => x !== t), r.data]);
      kick();
      return true;
    } catch (e) {
      setMsgs((cur) => (cur || []).filter((x) => x !== t));
      setErr(errText(e));
      return false;
    } finally {
      if (temp.localVideo) setTimeout(() => URL.revokeObjectURL(temp.localVideo), 60000);
    }
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
  async function sendFile(file, kind) {
    setAttach(false);
    if (!file) return;
    setBusy(true);
    if (kind === 'video') await send('', { videoFile: file }, { localVideo: URL.createObjectURL(file) });
    else await send('', { photoFile: file }, { body: 'Photo' });
    setBusy(false);
  }
  const pick = (kind, capture) => (
    <label className="attach-opt">
      <Icon name={capture ? 'record' : kind} />
      <span>{kind === 'photo' ? 'Photo' : capture ? 'Record a video' : 'Video from phone'}</span>
      <input
        type="file"
        accept={kind === 'photo' ? 'image/*' : 'video/*'}
        capture={capture ? 'environment' : undefined}
        className="visually-hidden"
        onChange={(e) => {
          sendFile(e.target.files && e.target.files[0], kind);
          e.target.value = '';
        }}
      />
    </label>
  );
  return (
    <div className="chat desk-chat">
      {msgs === null ? (
        <p className="sub chat-empty">Loading…</p>
      ) : !msgs.length && empty ? (
        <p className="sub chat-empty">{empty}</p>
      ) : (
        <ChatView messages={msgs} me={me} listRef={listRef} />
      )}
      <div className="desk-compose">
        {chips && (
          <div className="filters desk-chips">
            {chips.map(([label, t]) => (
              <button key={label} type="button" className="filter" onClick={() => setText(t)}>
                {label}
              </button>
            ))}
          </div>
        )}
        {attach && (
          <>
            <div className="attach-row">
              {pick('photo')}
              {pick('video', true)}
              {pick('video')}
            </div>
            <span className="sub attach-note">Videos can be up to {VIDEO_SECONDS} seconds.</span>
          </>
        )}
        {err && <p className="err">{err}</p>}
        <MessageBox
          value={text}
          onChange={setText}
          onSend={sendText}
          busy={busy}
          maxLength={2000}
          onFocus={() => setAttach(false)}
          before={
            <button
              type="button"
              className={'chat-photo attach-btn' + (attach ? ' on' : '')}
              aria-label={attach ? 'Close' : 'Send a photo or video'}
              aria-expanded={attach}
              onClick={() => setAttach(!attach)}
            >
              <Icon name="plus" />
            </button>
          }
        />
      </div>
    </div>
  );
}
