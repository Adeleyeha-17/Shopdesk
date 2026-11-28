// The customer's cart, one per shop (each shop is paid separately), kept in this browser so it survives a refresh,
// signing in, or coming back another day. Keys are a product id, or "product id:size id" for a product with sizes.
// Signed in, it's kept on the account too: it opens on another phone, and ShopDesk reminds them if they leave it.
import { supabase } from '../lib/database.js';
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
    window.dispatchEvent(new Event('shopdesk-cart')); // the Cart tab's number follows
    keepOnAccount(slug, kept);
  } catch (e) {
    /* not saved; the cart still works on this page */
  }
}

// a moment after the last change, the account's copy follows; an emptied cart goes at once (signed out: nothing is sent)
const waiting = {};
function keepOnAccount(slug, items) {
  clearTimeout(waiting[slug]);
  const send = async () => {
    delete waiting[slug];
    try {
      const { data } = await supabase.auth.getSession();
      if (data && data.session) await supabase.rpc('save_cart', { p_slug: slug, p_items: items });
    } catch (e) {
      /* offline: this browser still has it */
    }
  };
  if (Object.keys(items).length) waiting[slug] = setTimeout(send, 1500);
  else send();
}

// The cart kept on the account for this shop ({} when signed out or there is none).
export async function accountCart(slug) {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data || !data.session) return {};
    const r = await supabase.rpc('my_cart', { p_slug: slug });
    return r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {};
  } catch (e) {
    return {};
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

// Every shop with something in its cart (for the Carts list on Orders), the cart changed last first: [{ slug, items, at }].
export function allCarts() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('shopdesk-cart:')) continue;
      const c = JSON.parse(localStorage.getItem(k) || 'null');
      if (!c || typeof c.items !== 'object' || Date.now() - (c.at || 0) > KEEP_DAYS * 864e5) continue;
      if (Object.values(c.items).some((q) => q > 0)) out.push({ slug: k.slice('shopdesk-cart:'.length), items: c.items, at: c.at || 0 });
    }
  } catch (e) {
    /* storage turned off: no saved carts */
  }
  return out.sort((a, b) => b.at - a.at);
}

// Buy again: one more of something in that shop's cart, never more than what's left. Returns how many are in it now.
export function addOne(slug, key, left) {
  const items = loadCart(slug);
  const n = Math.min((items[key] || 0) + 1, left, 99);
  saveCart(slug, { ...items, [key]: n });
  return n;
}
