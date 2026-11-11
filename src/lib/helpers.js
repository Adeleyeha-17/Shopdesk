// Small helpers used all over the app.
import { backInApp, cameInApp, currentPath, direction, keepSpot, newKey, nowShowing, transition } from './motion.js';
import { pulse } from './busy.js';

export const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);

// An order's code as the shop and its customers see it: the shop's initials and the order number (BB-1043).
// Customers put it in their transfer note, so a payment can't be matched to the wrong order.
export const orderCode = (shop, o) => `${(shop && shop.order_prefix) || 'SD'}-${o.id}`;

// Turns any error into a sentence for the screen (see errors.js for every case).
export { errText, errInfo, isNetwork } from './errors.js';

export function waLink(number, text) {
  let d = String(number || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = '234' + d.slice(1);
  return 'https://wa.me/' + d + '?text=' + encodeURIComponent(text);
}

// A Nigerian mobile number in any usual form (0803 123 4567, +234 803 123 4567, 2348031234567), or null.
export function ngMobile(n) {
  const d = String(n || '').replace(/\D/g, '');
  const m = d.match(/^(?:234|0)?([789][01]\d{8})$/);
  return m ? '0' + m[1] : null;
}
// tel: links in the international form, so the call goes through from any phone (and from a phone abroad).
export function telLink(n) {
  const local = ngMobile(n);
  if (local) return 'tel:+234' + local.slice(1);
  return 'tel:' + String(n || '').replace(/[^\d+]/g, '');
}

// Copies text to the clipboard, then shows a short message with say().
// Phones on a plain http:// address (like testing over home Wi-Fi) block the normal way, so there's a backup.
const COPY_FAILED = 'Press and hold the text to copy it.';
export function copyText(text, say, done) {
  const backup = () => {
    try {
      const box = document.createElement('textarea');
      box.value = text;
      box.setAttribute('readonly', '');
      box.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(box);
      box.select();
      box.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      box.remove();
      say(ok ? done : COPY_FAILED);
    } catch (e) {
      say(COPY_FAILED);
    }
  };
  if (navigator.clipboard && window.isSecureContext)
    navigator.clipboard.writeText(text).then(() => say(done), backup);
  else backup();
}

// Moves to another page of the app without reloading it: the page slides (see motion.js) and starts at the top.
// replace: true swaps the current page in the history instead of adding one, so Back skips it.
// move: 'forward', 'back' or 'none' (tabs change at once); by default it follows how deep the pages are.
export function navigate(path, { replace = false, move } = {}) {
  const from = currentPath();
  const to = path.split(/[?#]/)[0] || '/';
  if (to === from && !replace && !/[?#]/.test(path)) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  pulse();
  transition(() => {
    keepSpot();
    const k = newKey();
    if (replace) window.history.replaceState({ k }, '', path);
    else window.history.pushState({ k, from }, '', path);
    nowShowing(k);
    window.scrollTo(0, 0);
    const e = new Event('popstate');
    e.fromApp = true;
    window.dispatchEvent(e);
  }, move || direction(from, to));
}

// The back arrow at the top of a page: back to the page before, if it was in ShopDesk; otherwise (opened straight
// from a link in WhatsApp or an email) to the page above this one.
export function goBack(above) {
  if (cameInApp()) backInApp();
  else navigate(above, { replace: true, move: 'back' });
}

// Links to other ShopDesk pages (<a href="/orders">) move like navigate() instead of loading the site again.
// Links to other sites, new tabs, phone numbers, WhatsApp and #tabs work as normal links.
export function keepLinksInApp() {
  const onClick = (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href || href[0] !== '/' || href[1] === '/') return;
    e.preventDefault();
    navigate(href, { move: a.dataset.move });
  };
  document.addEventListener('click', onClick);
  return () => document.removeEventListener('click', onClick);
}
