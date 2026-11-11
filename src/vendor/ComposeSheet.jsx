// Writing to a customer inside ShopDesk: a bottom sheet with the message already written, ready to change or send.
// Used for "Remind" (sent in that order's chat) and "Message" (a note from the shop, on the customer's Shops tab).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { errText } from '../lib/helpers.js';

export function ComposeSheet({ title, to, text, note, onSend, onClose }) {
  const [body, setBody] = useState(text);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef(null);
  const [closing, setClosing] = useState(false);
  const leaving = useRef(false);
  const close = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    setClosing(true);
    setTimeout(onClose, 200);
  }, [onClose]);
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [close]);

  async function send() {
    if (!body.trim()) {
      setErr('Write a message.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await onSend(body.trim());
      close();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <div
      className={'overlay bottom' + (closing ? ' closing' : '')}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal sheet compose" role="dialog" aria-modal="true" aria-labelledby="composeTitle">
        <div className="row">
          <h2 id="composeTitle" className="sheet-title">
            {title}
          </h2>
          <button className="linkbtn" onClick={close}>
            Cancel
          </button>
        </div>
        <p className="note">
          To <strong>{to}</strong>
          {note ? ` · ${note}` : ''}
        </p>
        <textarea
          ref={box}
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 300))}
          rows={5}
          aria-label="Message"
        />
        <span className="sub">{300 - body.length} letters left</span>
        {err && (
          <p className="err" role="alert">
            {err}
          </p>
        )}
        <button className="btn" onClick={send} disabled={busy}>
          {busy ? 'Sending…' : 'Send in ShopDesk'}
        </button>
      </div>
    </div>
  );
}
