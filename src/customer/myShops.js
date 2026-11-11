// The shops this customer has opened, kept in this browser, newest first. The Shops tab lists them (with the shops
// they've ordered from on their account), and the Cart tab goes back to them.
// Each entry: { slug, name, photos (up to 3 product photo paths), blurb, cartTotal, at (last opened) }.
const KEY = 'shopdesk-shops';
const HIDDEN = 'shopdesk-shops-hidden'; // taken off the list with Edit; opening the shop again brings it back
const MAX = 60;

function read(key, empty) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(v) ? v : empty;
  } catch (e) {
    return empty; // private browsing or storage turned off: the list is just empty
  }
}
function write(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch (e) {
    /* not kept; the page still works */
  }
}
const changed = () => window.dispatchEvent(new Event('shopdesk-shops'));

export const myShops = () => read(KEY, []).filter((s) => s && s.slug);
export const hiddenShops = () => read(HIDDEN, []);
export const lastShop = () => myShops()[0] || null;

// the customer opened this shop (or one of its orders): it goes to the top of the list
export function rememberShop(slug, name, more = {}) {
  if (!slug) return;
  const list = myShops();
  const old = list.find((s) => s.slug === slug) || {};
  write(KEY, [{ ...old, ...more, slug, name: name || old.name || slug, at: Date.now() }, ...list.filter((s) => s.slug !== slug)].slice(0, MAX));
  const hidden = hiddenShops();
  if (hidden.includes(slug)) write(HIDDEN, hidden.filter((x) => x !== slug));
  changed();
}

// update what's kept about a shop (e.g. its cart total) without moving it up the list
export function noteShop(slug, more) {
  const list = myShops();
  const i = list.findIndex((s) => s.slug === slug);
  if (i < 0) return;
  list[i] = { ...list[i], ...more };
  write(KEY, list);
}

export function forgetShop(slug) {
  write(KEY, myShops().filter((s) => s.slug !== slug));
  const hidden = hiddenShops();
  if (!hidden.includes(slug)) write(HIDDEN, [...hidden, slug]);
  changed();
}
