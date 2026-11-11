// Moving between pages like a phone app: the next page slides in from the right over the last one, Back slides it
// away to the right. The top bar stays put. Uses the browser's view transitions (Chrome, Edge, Safari 18+, recent
// Firefox); other browsers just change the page. Phones set to "reduce motion" get no slides.
// While the next page loads its data, the loading bar runs at the top (lib/busy.js).
import { flushSync } from 'react-dom';

// The page address without the domain.
export const currentPath = () => window.location.pathname;

const calm = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
let seq = 0;

// Runs change() (which updates the page) as one smooth move. dir: 'forward', 'back', or 'none' (just change it).
// after() runs once the new page is in place, before it shows (e.g. to put the scroll back where it was).
export function transition(change, dir = 'none', after) {
  const run = () => {
    flushSync(change);
    if (after) after();
  };
  if (dir === 'none' || !document.startViewTransition || calm() || document.visibilityState !== 'visible') {
    run();
    return;
  }
  const id = ++seq;
  const root = document.documentElement;
  root.dataset.move = dir;
  const done = () => {
    if (seq === id) delete root.dataset.move;
  };
  try {
    const t = document.startViewTransition(run);
    t.ready.catch(() => {});
    t.finished.then(done, done);
  } catch (e) {
    done();
    run();
  }
}

// How deep a page sits, so moving to a deeper page slides forward and moving up slides back.
export function depth(path) {
  const p = String(path || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/admin') return 0;
  if (p === '/orders' || p === '/email-off' || /^\/[^/]+\/cart$/.test(p)) return 2;
  if (p === '/account' || /^\/[^/]+\/checkout$/.test(p)) return 3;
  if (p.startsWith('/o/')) return 4;
  if (p === '/privacy') return 5;
  return 1; // a shop's page
}
// moving up (to a shallower page) slides back; anything else slides forward
export function direction(from, to) {
  return depth(to) < depth(from) ? 'back' : 'forward';
}

// Where each page in the history was scrolled to, so Back returns to the same spot in a list.
const spots = new Map();
let shownKey = null; // the history entry on screen now
export const newKey = () => Math.random().toString(36).slice(2, 10);
// call just before leaving a page; nowShowing(key) once the next one is in place
export function keepSpot() {
  if (shownKey) spots.set(shownKey, window.scrollY);
}
export function nowShowing(k) {
  shownKey = k || null;
}
export function spotOf(state) {
  return state && state.k && spots.has(state.k) ? spots.get(state.k) : null;
}
// once, when the app starts: the app puts the scroll back itself
export function startHistory() {
  try {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    const st = window.history.state;
    if (!st || !st.k) window.history.replaceState({ ...(st || {}), k: newKey() }, '');
    shownKey = window.history.state.k;
  } catch (e) {
    /* some views don't allow it; pages still change */
  }
}
