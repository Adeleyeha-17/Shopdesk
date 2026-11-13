// The ShopDesk chat: one shop and ShopDesk, inside the app. The shop sees every message from ShopDesk as "ShopDesk",
// never who wrote it. Used in the shop's app (me = 'shop') and in Admin (me = 'shopdesk'). Text, photos and videos
// (taken there and then, or picked from the phone; videos up to 20 seconds). New messages arrive by themselves; opening the chat marks the
// other side's messages read.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { errText } from '../lib/helpers.js';
import { uploadShopPhoto, uploadShopVideo, VIDEO_SECONDS } from '../lib/photos.js';
import { kick } from '../lib/alerts.js';
import { ChatView } from './Chat.jsx';
import { MessageBox } from './MessageBox.jsx';

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
    if (!file) return;
    setBusy(true);
    if (kind === 'video') await send('', { videoFile: file }, { localVideo: URL.createObjectURL(file) });
    else await send('', { photoFile: file }, { body: 'Photo' });
    setBusy(false);
  }
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
        {err && <p className="err">{err}</p>}
        <MessageBox
          value={text}
          onChange={setText}
          onSend={sendText}
          onFile={sendFile}
          video
          maxSeconds={VIDEO_SECONDS}
          busy={busy}
          maxLength={2000}
        />
      </div>
    </div>
  );
}
