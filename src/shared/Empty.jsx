// A friendly empty screen: a small grey drawing, a title, a line of text and one button.
// kind: 'scooter' (nothing on the way), 'basket' (no carts), 'bag' (nothing bought yet), 'receipt' (no past orders).
import React from 'react';

const drawings = {
  scooter: (
    <>
      <path className="e1" d="M34 92h70" />
      <circle className="e3" cx="42" cy="84" r="11" />
      <circle className="e1f" cx="42" cy="84" r="4.5" />
      <circle className="e3" cx="98" cy="84" r="11" />
      <circle className="e1f" cx="98" cy="84" r="4.5" />
      <path className="e2f" d="M30 80c2-12 12-19 24-19h6l8 15h22c4-9 10-14 18-14 6 0 10 3 10 9v9H30z" />
      <path className="e3f" d="M70 54h24a5 5 0 0 1 0 10H70a5 5 0 0 1 0-10z" />
      <path className="e3s" d="M52 61l-8-26m0 0l-6-3m6 3l9-2" />
      <rect className="e2f" x="38" y="29" width="12" height="6" rx="3" />
      <text className="ez" x="62" y="30">z</text>
      <text className="ez" x="72" y="22" style={{ fontSize: 13 }}>z</text>
      <text className="ez" x="83" y="13" style={{ fontSize: 16 }}>z</text>
    </>
  ),
  basket: (
    <>
      <path className="e3s" d="M44 46l20-24m32 24L76 22" />
      <path className="e3f" d="M26 44h88a4 4 0 0 1 0 8H26a4 4 0 0 1 0-8z" />
      <path className="e2f" d="M32 52h76l-8 38a6 6 0 0 1-6 5H46a6 6 0 0 1-6-5z" />
      <path className="e1s" d="M52 62v24M64 62v24M76 62v24M88 62v24" />
    </>
  ),
  bag: (
    <>
      <path className="e3s" d="M56 42v-8a14 14 0 0 1 28 0v8" />
      <path className="e2f" d="M34 42h72l-5 50a6 6 0 0 1-6 5H45a6 6 0 0 1-6-5z" />
      <path className="e1s" d="M58 66h24M70 54v24" />
    </>
  ),
  receipt: (
    <>
      <path className="e2f" d="M44 16h52v78l-8-6-9 6-9-6-9 6-9-6-8 6z" />
      <path className="e1s" d="M56 34h28M56 46h28M56 58h18" />
      <path className="e3s" d="M56 74h28" />
    </>
  ),
};

export function Empty({ kind, title, text, action, onAction }) {
  return (
    <section className="empty-state">
      <svg viewBox="0 0 140 104" aria-hidden="true">
        {drawings[kind]}
      </svg>
      <h2>{title}</h2>
      {text && <p className="sub">{text}</p>}
      {action &&
        (onAction ? (
          <button className="btn small ghost" onClick={onAction}>
            {action[0]}
          </button>
        ) : (
          <a className="btn small ghost" href={action[1]}>
            {action[0]}
          </a>
        ))}
    </section>
  );
}
