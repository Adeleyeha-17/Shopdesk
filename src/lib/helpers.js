// Small helpers used all over the app.

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

// Moves to another page of the app without reloading it.
export function navigate(path) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event('popstate'));
}
