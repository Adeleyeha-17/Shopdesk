// A shop's poster for WhatsApp status, Instagram and TikTok (1080 × 1920), drawn on the phone from its announcement:
// the shop's name, what's new, the discount and code, up to three products with their prices, and the shop's link.
import { naira } from '../lib/money.js';
import { photoUrl } from '../lib/photos.js';

const W = 1080;
const H = 1920;
const HEAD = { new: 'NEW IN', sale: 'SALE', black_friday: 'BLACK FRIDAY', restock: 'BACK IN STOCK' };
const FONT = 'Figtree, system-ui, -apple-system, "Segoe UI", sans-serif';

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// the photo fills the box, cropped to its middle
function cover(c, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s;
  const sh = h / s;
  c.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

// the headline in as few lines as fit, as large as fits
function fitLines(c, text, maxW, size) {
  const words = text.split(' ');
  for (let s = size; s >= 80; s -= 10) {
    c.font = `900 ${s}px ${FONT}`;
    const lines = [];
    let line = '';
    words.forEach((w) => {
      const t = line ? line + ' ' + w : w;
      if (c.measureText(t).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = t;
    });
    lines.push(line);
    if (lines.length <= 2 && lines.every((l) => c.measureText(l).width <= maxW)) return { lines, size: s };
  }
  return { lines: [text], size: 80 };
}

const offText = (off) => (!off ? '' : off.kind === 'percent' ? `${off.value}% OFF` : `${naira(off.value)} OFF`);
const afterOff = (price, off) =>
  !off ? price : off.kind === 'percent' ? Math.round(price * (1 - off.value / 100)) : Math.max(0, price - off.value);
const endsText = (d) =>
  'Ends ' + new Date(d + 'T12:00:00').toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });

// news: { kind, off, code, ends_on, body, products: [{ name, price, sale_price, photo_path }] }; shop: { name, slug }
export async function makePoster(shop, news) {
  if (document.fonts && document.fonts.ready) await document.fonts.ready.catch(() => {});
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  const ink = '#1d1410';
  c.fillStyle = '#f6efe6';
  c.fillRect(0, 0, W, H);
  c.textBaseline = 'alphabetic';

  // the shop
  c.fillStyle = '#ead7c6';
  c.beginPath();
  c.arc(110, 130, 40, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#7a4a2f';
  c.font = `800 40px ${FONT}`;
  c.textAlign = 'center';
  c.fillText((shop.name.trim()[0] || 'S').toUpperCase(), 110, 145);
  c.textAlign = 'left';
  c.fillStyle = ink;
  c.font = `800 44px ${FONT}`;
  c.fillText(shop.name, 170, 146, W - 240);

  // what's new
  let y = 330;
  const head = fitLines(c, HEAD[news.kind] || 'NEW', W - 140, 190);
  c.font = `900 ${head.size}px ${FONT}`;
  head.lines.forEach((l) => {
    y += head.size * 0.92;
    c.fillText(l, 70, y);
  });

  // the deal
  if (news.off) {
    y += 150;
    c.fillStyle = '#c2410c';
    c.font = `900 130px ${FONT}`;
    c.fillText(offText(news.off), 70, y, W - 140);
    y += 50;
    c.font = `800 46px ${FONT}`;
    const code = 'CODE: ' + news.code;
    const w = c.measureText(code).width + 60;
    c.strokeStyle = ink;
    c.lineWidth = 5;
    c.setLineDash([16, 12]);
    roundRect(c, 70, y, w, 96, 22);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = ink;
    c.fillText(code, 100, y + 64);
    y += 96;
    if (news.body) {
      y += 80;
      c.font = `600 44px ${FONT}`;
      c.fillText(news.body.slice(0, 60), 70, y, W - 140);
    }
  } else if (news.body) {
    y += 90;
    c.font = `600 48px ${FONT}`;
    c.fillText(news.body.slice(0, 60), 70, y, W - 140);
  }
  if (news.ends_on) {
    y += 46;
    c.font = `800 36px ${FONT}`;
    const t = endsText(news.ends_on);
    const w = c.measureText(t).width + 48;
    c.fillStyle = ink;
    roundRect(c, 70, y, w, 66, 33);
    c.fill();
    c.fillStyle = '#fff';
    c.fillText(t, 94, y + 46);
  }

  // up to three products
  const items = (news.products || []).slice(0, 3);
  const imgs = await Promise.all(items.map((p) => loadImage(photoUrl(p.photo_path))));
  const gap = 24;
  const cw = (W - 140 - gap * (items.length - 1)) / Math.max(items.length, 1);
  const ch = cw + 150;
  const top = H - 230 - ch;
  items.forEach((p, i) => {
    const x = 70 + i * (cw + gap);
    c.fillStyle = '#fff';
    roundRect(c, x, top, cw, ch, 30);
    c.fill();
    c.save();
    roundRect(c, x + 16, top + 16, cw - 32, cw - 32, 20);
    c.clip();
    if (imgs[i]) cover(c, imgs[i], x + 16, top + 16, cw - 32, cw - 32);
    else {
      c.fillStyle = '#efe7de';
      c.fillRect(x + 16, top + 16, cw - 32, cw - 32);
    }
    c.restore();
    const was = p.sale_price || p.price;
    const now = afterOff(was, news.off);
    c.textAlign = 'center';
    c.fillStyle = ink;
    c.font = `800 ${items.length === 1 ? 56 : 44}px ${FONT}`;
    c.fillText(naira(now), x + cw / 2, top + cw + 50, cw - 30);
    c.font = `500 32px ${FONT}`;
    if (now !== was || p.sale_price) {
      const old = naira(p.price);
      c.fillStyle = '#8a7f78';
      c.fillText(old, x + cw / 2, top + cw + 98);
      const ow = c.measureText(old).width;
      c.fillRect(x + cw / 2 - ow / 2, top + cw + 86, ow, 3);
    } else {
      c.fillStyle = '#6b5f58';
      c.fillText(p.name.slice(0, 22), x + cw / 2, top + cw + 98, cw - 30);
    }
    c.textAlign = 'left';
  });

  // the shop's link
  c.fillStyle = ink;
  roundRect(c, 70, H - 190, W - 140, 130, 30);
  c.fill();
  c.fillStyle = '#fff';
  c.font = `500 34px ${FONT}`;
  c.fillText('Order now', 110, H - 136);
  c.font = `800 44px ${FONT}`;
  c.fillText(`shopdesk.com.ng/${shop.slug}`, 110, H - 84, W - 220);

  return new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
}

// Shares the poster where the phone can (WhatsApp, Instagram…), otherwise saves it. Returns 'shared' or 'saved'.
export async function sharePoster(blob, shop, text) {
  const file = new File([blob], `${shop.slug}-poster.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  savePoster(blob, shop);
  return 'saved';
}

export function savePoster(blob, shop) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${shop.slug}-poster.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
