// The thin bar across the top of the screen while a page loads (see lib/busy.js): it moves quickly at first,
// slows down as it waits, then fills and fades when the page is ready.
import React, { useEffect, useState } from 'react';
import { onBusy } from '../lib/busy.js';

export function LoadingBar() {
  const [bar, setBar] = useState(null); // null: hidden, or { run, at } with at from 0 to 1
  useEffect(() => {
    let tick = null;
    let hide = null;
    let now = null;
    let run = 0;
    const show = (at) => {
      now = at;
      setBar(at === null ? null : { run, at });
    };
    const off = onBusy((busy) => {
      if (busy) {
        clearTimeout(hide);
        if (now === null || now >= 1) {
          run++;
          show(0.1);
        }
        if (!tick) tick = setInterval(() => show(Math.min(0.92, now + (0.92 - now) * 0.14)), 140);
      } else if (now !== null && now < 1) {
        clearInterval(tick);
        tick = null;
        show(1);
        hide = setTimeout(() => show(null), 380);
      }
    });
    return () => {
      off();
      clearInterval(tick);
      clearTimeout(hide);
    };
  }, []);
  if (!bar) return null;
  return (
    <div
      key={bar.run}
      className={'loadbar' + (bar.at >= 1 ? ' done' : '')}
      style={{ transform: `scaleX(${bar.at})` }}
      aria-hidden="true"
    />
  );
}
