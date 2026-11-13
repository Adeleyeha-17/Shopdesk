// The box for writing a chat message (order chats and the ShopDesk chat): it grows with what you type, up to about six
// lines, then scrolls. Enter sends on a computer; on a phone Enter makes a new line and the arrow sends.
import React, { useLayoutEffect, useRef } from 'react';

export function MessageBox({ value, onChange, onSend, busy = false, before = null, autoFocus = false, onFocus, maxLength = 1000 }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }, [value]);
  const ready = !busy && value.trim().length > 0;
  return (
    <form
      className="chat-send"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSend();
      }}
    >
      {before}
      <div className="msgbox">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          maxLength={maxLength}
          placeholder="Message"
          aria-label="Message"
          autoFocus={autoFocus}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault();
              if (ready) onSend();
            }
          }}
        />
      </div>
      <button className={'msg-send' + (ready ? ' ready' : '')} disabled={!ready} aria-label="Send">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
        </svg>
      </button>
    </form>
  );
}
