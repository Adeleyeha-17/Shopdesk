// The thin loading bar at the top of the screen (shared/LoadingBar.jsx). Anything that loads says so here, and the
// bar runs until everything has finished.
//   useBusy(flag)   in a page: the bar runs while flag is true
//   pulse()         a short run, when moving to another page
import { useEffect } from 'react';

let running = 0;
const watchers = new Set();
const tell = () => watchers.forEach((f) => f(running > 0));

export function startBusy() {
  running++;
  tell();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    running = Math.max(0, running - 1);
    tell();
  };
}

export function pulse(ms = 320) {
  setTimeout(startBusy(), ms);
}

export function onBusy(f) {
  watchers.add(f);
  f(running > 0);
  return () => watchers.delete(f);
}

export function useBusy(on) {
  useEffect(() => (on ? startBusy() : undefined), [on]);
}
