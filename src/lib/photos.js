// Photos: product photos (anyone can see them) and order photos (private: only the shop, its customer and you).
import { supabase } from './database.js';

export const photoUrl = (path) =>
  supabase && path ? supabase.storage.from('product-photos').getPublicUrl(path).data.publicUrl : '';

// A random id for a file name (works on phones testing over plain http:// too).
export function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Shrinks a photo to at most 1000px on its long side and returns a JPEG blob.
export function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('That photo could not be read.'));
    r.onload = () => {
      const im = new Image();
      im.onerror = () => reject(new Error('That file is not a photo we can read.'));
      im.onload = () => {
        const k = Math.min(1, 1000 / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * k);
        c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        c.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('That photo could not be saved.'))),
          'image/jpeg',
          0.82,
        );
      };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

// ---------- order photos (private) ----------
// Saved in the order's own folder: <order number>/<kind>-<id>.jpg
//   pack = the shop's packing photo, v = a photo with the shop's answer to a problem, c = the customer's problem photo,
//   m = a photo in the chat, r = the shop's refund receipt
export async function uploadOrderPhoto(orderId, kind, file) {
  const blob = await shrinkPhoto(file);
  const path = `${orderId}/${kind}-${newId()}.jpg`;
  const { error } = await supabase.storage
    .from('order-photos')
    .upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}

// A photo in a shop's ShopDesk chat (order-photos/shop-<shop id>/m-...): only the shop and ShopDesk see it.
export async function uploadShopPhoto(shopId, file) {
  const blob = await shrinkPhoto(file);
  const path = `shop-${shopId}/m-${newId()}.jpg`;
  const { error } = await supabase.storage.from('order-photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}

// A video in a shop's ShopDesk chat (chat-videos/shop-<shop id>/m-...): only the shop and ShopDesk see it. Up to 20
// seconds, to keep storage small (and never over 50 MB).
export const VIDEO_SECONDS = 20;
export const VIDEO_MAX = 50 * 1024 * 1024;
const TOO_LONG = `Videos can be up to ${VIDEO_SECONDS} seconds. Record a shorter one.`;
const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp', 'video/x-matroska': 'mkv' };

// How long a video is, in seconds (null when the phone can't tell).
export function videoSeconds(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const end = (d) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => end(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => end(null);
    setTimeout(() => end(null), 8000);
    v.src = url;
  });
}

export async function uploadShopVideo(shopId, file) {
  if (file.size > VIDEO_MAX) throw new Error(TOO_LONG);
  const secs = await videoSeconds(file);
  // a phone that can't tell the length: a big file is a long video
  if ((secs != null && secs > VIDEO_SECONDS + 0.9) || (secs == null && file.size > 20 * 1024 * 1024)) throw new Error(TOO_LONG);
  const type = VIDEO_TYPES[file.type] ? file.type : 'video/mp4';
  const path = `shop-${shopId}/m-${newId()}.${VIDEO_TYPES[type]}`;
  const { error } = await supabase.storage.from('chat-videos').upload(path, file, { contentType: type });
  if (error) throw error;
  return path;
}

// A short-lived link to play a chat video (it stops working after an hour).
export async function videoLink(path) {
  const { data, error } = await supabase.storage.from('chat-videos').createSignedUrls([path], 3600);
  return error || !data || !data[0] ? null : data[0].signedUrl;
}

// Short-lived links to view order photos (they stop working after an hour).
export async function orderPhotoLinks(paths) {
  const list = [...new Set((paths || []).filter(Boolean))];
  if (!list.length) return {};
  const { data, error } = await supabase.storage.from('order-photos').createSignedUrls(list, 3600);
  if (error || !data) return {};
  const out = {};
  data.forEach((d) => {
    if (d && d.signedUrl) out[d.path] = d.signedUrl;
  });
  return out;
}
