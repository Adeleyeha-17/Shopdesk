// The demo's own small "address bar". The demo runs as a single page that may be shown inside another page,
// so the app's page address (/, /orders, /o/..., /your-shop) is kept here instead of in the real address bar.
// The build (demo/vite.demo.config.js) points the app's address reads and page moves at these.

const listeners = new Set();
let path = '/';
let hint = '';

function safeHash(name) {
  try {
    window.history.replaceState(null, '', name ? '#' + name : window.location.pathname);
  } catch (e) {
    /* some views don't allow it; the tab still changes */
  }
}

export const demo = {
  get path() {
    return path;
  },
  // Moves to another page of the app (the app then hears 'popstate', as on a real site).
  go(to) {
    const [p, h] = String(to || '/').split('#');
    path = p || '/';
    if (h !== undefined) safeHash(h);
    demo.changed();
  },
  setHash: safeHash,
  get hint() {
    return hint;
  },
  setHint(t) {
    hint = t || '';
    demo.changed();
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  changed() {
    listeners.forEach((fn) => fn());
  },
};

window.__demo = demo;
