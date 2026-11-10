// The customer's cart, one per shop (each shop is paid separately), kept in this browser so it survives a refresh,
// signing in, or coming back another day. Keys are a product id, or "product id:size id" for a product with sizes.
import { options, optionWord } from '../lib/products.js';

const KEEP_DAYS = 30;
const key = (slug) => 'shopdesk-cart:' + slug;

export function loadCart(slug) {
  try {
    const c = JSON.parse(localStorage.getItem(key(slug)) || 'null');
    if (!c || typeof c.items !== 'object' || Date.now() - (c.at || 0) > KEEP_DAYS * 864e5) return {};
    return c.items;
  } catch (e) {
    return {}; // private browsing or storage turned off: the cart lasts while the page is open
  }
}

export function saveCart(slug, items) {
  try {
    const kept = Object.fromEntries(Object.entries(items || {}).filter(([, q]) => q > 0));
    if (Object.keys(kept).length)
      localStorage.setItem(key(slug), JSON.stringify({ items: kept, at: Date.now() }));
    else localStorage.removeItem(key(slug));
  } catch (e) {
    /* not saved; the cart still works on this page */
  }
}

export const clearCart = (slug) => saveCart(slug, {});

// A saved cart, fitted to what the shop has now: items that are gone or sold out leave, and quantities above
// what's left come down. Returns the cart and a sentence about what changed ('' if nothing did).
export function fitCart(items, products) {
  const out = {};
  const notes = [];
  let gone = 0;
  Object.entries(items || {}).forEach(([k, raw]) => {
    const q = Math.floor(Number(raw));
    if (!(q > 0)) return;
    const [pid, oid] = k.split(':');
    const p = (products || []).find((x) => x.id === pid);
    if (!p) {
      gone++;
      return;
    }
    const sizes = options(p);
    const o = oid ? sizes.find((x) => x.id === oid) : null;
    if (oid ? !o : sizes.length) {
      notes.push(`pick a ${optionWord(p)} for ${p.name} again`);
      return;
    }
    const name = o ? `${p.name} · ${o.name}` : p.name;
    const left = o ? o.stock : p.stock;
    if (left <= 0) {
      notes.push(`${name} is sold out`);
      return;
    }
    const n = Math.min(q, left, 99);
    if (n < q) notes.push(`only ${n} × ${name} left`);
    out[k] = n;
  });
  if (gone)
    notes.push(gone === 1 ? 'an item is no longer sold here' : `${gone} items are no longer sold here`);
  const text = notes.length ? `Your cart changed: ${notes.join('; ')}.` : '';
  return { items: out, note: text.charAt(0).toUpperCase() + text.slice(1) };
}
