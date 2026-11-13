// A chat that takes the whole screen on a phone (and a large panel on a computer): a header that stays at the top,
// the messages, and the message box sitting right on the keyboard. The phone's back button closes it, like leaving a page.
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useKeyboardFit } from './useKeyboardFit.js';

const BACK_CLOSES = true; // the demo, shown inside another page, closes it without the browser's history

export function ChatScreen({ title, sub, mark = false, close, children }) {
  const shut = useRef(close);
  shut.current = close;
  const pushed = useRef(false);
  const box = useRef(null);
  useKeyboardFit(box);
  const leave = () => (pushed.current ? window.history.back() : shut.current());
  useEffect(() => {
    try {
      if (BACK_CLOSES) {
        window.history.pushState({ chat: true }, '');
        pushed.current = true;
      }
    } catch (e) {
      /* this view doesn't allow it: Back closes it instead */
    }
    const back = () => shut.current();
    const esc = (e) => e.key === 'Escape' && (pushed.current ? window.history.back() : shut.current());
    window.addEventListener('popstate', back);
    window.addEventListener('keydown', esc);
    document.body.classList.add('desk-open');
    return () => {
      window.removeEventListener('popstate', back);
      window.removeEventListener('keydown', esc);
      document.body.classList.remove('desk-open');
    };
  }, []);
  return createPortal(
    <div className="overlay desk-overlay" ref={box} onClick={(e) => e.target === e.currentTarget && leave()}>
      <div className="modal desk-sheet" role="dialog" aria-modal="true" aria-labelledby="chatTitle">
        <div className="desk-head">
          <button className="back-btn" onClick={leave} aria-label="Back">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          {mark && <span className="desk-mark" aria-hidden="true" />}
          <div>
            <h2 id="chatTitle" className="sheet-title">
              {title}
            </h2>
            {sub && <span className="sub">{sub}</span>}
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
