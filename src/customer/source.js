// Where a customer came from before they ordered, for the shop's "Where orders come from" report.
// Instagram, TikTok, Facebook, Snapchat and X open links in their own built-in browser, which names itself, so they're
// spotted without the shop doing anything. WhatsApp opens the phone's normal browser, so its links carry ?s=wa
// (added by the shop's Copy WhatsApp message). Anything else is "direct". Nothing personal is kept: one word per
// shop on this phone, for a week.
const KEY = (slug) => 'shopdesk-from:' + slug;
const WEEK = 7 * 864e5;
const TAGS = {
  wa: 'whatsapp',
  whatsapp: 'whatsapp',
  ig: 'instagram',
  instagram: 'instagram',
  tt: 'tiktok',
  tiktok: 'tiktok',
  fb: 'facebook',
  facebook: 'facebook',
  sc: 'snapchat',
  x: 'x',
  tw: 'x',
};

function fromThisVisit() {
  try {
    const tag = new URLSearchParams(window.location.search).get('s');
    if (tag && TAGS[tag.toLowerCase()]) return TAGS[tag.toLowerCase()];
  } catch (e) {
    /* no address to read */
  }
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('instagram')) return 'instagram';
  if (ua.includes('musical_ly') || ua.includes('bytedancewebview') || ua.includes('tiktok')) return 'tiktok';
  if (ua.includes('fban') || ua.includes('fbav') || ua.includes('fb_iab')) return 'facebook';
  if (ua.includes('snapchat')) return 'snapchat';
  if (ua.includes('twitter')) return 'x';
  const ref = (document.referrer || '').toLowerCase();
  if (/instagram\./.test(ref)) return 'instagram';
  if (/tiktok\./.test(ref)) return 'tiktok';
  if (/facebook\.|fb\.com/.test(ref)) return 'facebook';
  if (/(^|\.)(t\.co|x\.com|twitter\.com)/.test(ref)) return 'x';
  return null;
}

// Called when a shop's page opens: a known source replaces what was kept; otherwise the week-old one stays.
export function noteSource(slug) {
  const s = fromThisVisit();
  if (!s) return;
  try {
    localStorage.setItem(KEY(slug), JSON.stringify({ s, at: Date.now() }));
  } catch (e) {
    /* private browsing: the order is counted as direct */
  }
}

// Sent with the order.
export function sourceFor(slug) {
  try {
    const x = JSON.parse(localStorage.getItem(KEY(slug)) || 'null');
    if (x && x.s && Date.now() - x.at < WEEK) return x.s;
  } catch (e) {
    /* nothing kept */
  }
  return fromThisVisit() || 'direct';
}

// A random id for this phone, so a shop's visitors are counted once a day each (nothing personal: just a random code).
export function visitorId() {
  try {
    let v = localStorage.getItem('shopdesk-visitor');
    if (!v) {
      v = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 40);
      localStorage.setItem('shopdesk-visitor', v);
    }
    return v;
  } catch (e) {
    return 'nostore-' + Math.random().toString(36).slice(2, 14);
  }
}
