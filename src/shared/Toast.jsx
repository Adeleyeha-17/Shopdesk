// The pop-up at the bottom of the screen: one short line, and sometimes a button (like Open for a new message).
// toast: { text, title?, action?: { label, run } } or null.
import React from 'react';

export function Toast({ toast, onClose, low = false }) {
  if (!toast) return null;
  return (
    <div className={'toast' + (low ? ' low' : '') + (toast.action ? ' has-action' : '')} role="status">
      <span className="toast-text">
        {toast.title && <strong>{toast.title}</strong>}
        <span>{toast.text}</span>
      </span>
      {toast.action && (
        <button
          className="toast-btn"
          onClick={() => {
            onClose();
            toast.action.run();
          }}
        >
          {toast.action.label}
        </button>
      )}
      {toast.action && (
        <button className="toast-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  );
}

// A toast that goes away by itself: [toast, say(text | toast), close]
export function useToast(ms = 4000) {
  const [toast, setToast] = React.useState(null);
  const timer = React.useRef(null);
  const close = React.useCallback(() => setToast(null), []);
  const say = React.useCallback(
    (t) => {
      const next = typeof t === 'string' ? { text: t } : t;
      setToast(next);
      clearTimeout(timer.current);
      if (next) timer.current = setTimeout(() => setToast(null), next.action ? Math.max(ms, 8000) : ms);
    },
    [ms],
  );
  React.useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, say, close];
}
