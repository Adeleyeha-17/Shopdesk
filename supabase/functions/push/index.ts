// @ts-nocheck
// ShopDesk push sender (a Supabase Edge Function named "push").
// The app calls it right after anything happens (a new order, money in, a message...). It takes the alerts that haven't
// been sent yet from the database and sends each one to the phones of the person it's for, as a phone notification.
// It also sends the email backup: one email with what someone missed when they haven't opened ShopDesk for 10 minutes.
//   POST {"action":"key"}    -> {"key": "<public key>"}, which phones need to turn alerts on
//   POST {"action":"flush"}  -> sends whatever is waiting (phone alerts, then any emails due); safe to call any time, by anyone
//   POST {"action":"email"}  -> sends only the emails due (the database calls this every 5 minutes)
//   POST ?unsub=<secret>     -> "Stop these emails" in one tap from the mail app (GET opens the page on the site instead)
// Phone alerts need no secrets: it reaches the database through SUPABASE_DB_URL (Supabase provides it), and makes its own
// signing key the first time, kept in the database where only it can read it.
// Emails need your email account, set as secrets in Supabase (Edge Functions -> Secrets): SMTP_USER and SMTP_PASS
// (for Gmail: the address and an app password). Optional: SMTP_HOST (smtp.gmail.com), SMTP_PORT (465), EMAIL_FROM.
// Deploy with "Verify JWT" turned off.
import postgres from 'npm:postgres@3.4.5';

const SITE = 'https://shopdesk.com.ng';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
// Only the real push services of phones and browsers (Chrome, Safari, Firefox, Edge).
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;

const enc = new TextEncoder();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function b64u(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(s) {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// The signing key: made once, then read from the database.
let cached = null;
export async function getKeys(sql) {
  if (cached) return cached;
  let k = (await sql`select public.push_key() as k`)[0].k;
  if (!k) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    k = (await sql`select public.push_key_init(${pub}, ${sql.json(jwk)}) as k`)[0].k;
  }
  const { kty, crv, x, y, d } = k.private_jwk;
  const signer = await crypto.subtle.importKey('jwk', { kty, crv, x, y, d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  cached = { publicKey: k.public_key, signer };
  return cached;
}

// Proves to the push service that the alert comes from ShopDesk (VAPID, RFC 8292).
async function vapid(endpoint, keys) {
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SITE })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.signer, enc.encode(head + '.' + claims));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// Encrypts the alert so only that phone can read it (RFC 8291, aes128gcm).
export async function encrypt(sub, text) {
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(enc.encode(text), new Uint8Array([2]))));
  const head = new Uint8Array(86);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = 65;
  head.set(asPublic, 21);
  return concat(head, sealed);
}

// What the phone shows. Alerts about the same order replace each other; chat messages stack per order.
export function payload(n) {
  const tag = n.order_id ? (n.kind === 'message' ? 'chat-' : 'order-') + n.order_id : n.kind;
  return JSON.stringify({ title: n.title, body: n.body, url: n.url, tag, kind: n.kind, order_id: n.order_id });
}

export async function handle(req, sql, opts = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  // "Stop these emails": a mail app's one-tap button posts here; a person opening the link gets the page that asks first
  // (link checkers open every link in an email, so opening it never turns emails off by itself)
  const unsub = new URL(req.url).searchParams.get('unsub');
  if (unsub !== null) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(unsub)) return new Response('This link is not right.', { status: 400 });
    if (req.method !== 'POST') return Response.redirect(SITE + '/email-off?t=' + unsub, 303);
    await sql`select public.email_by_token(${unsub}::uuid, false)`.catch(() => {});
    return new Response('You won’t get these emails any more.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const send = opts.fetch || fetch;
  const allowed = opts.allowed || ((u) => {
    try {
      const x = new URL(u);
      return x.protocol === 'https:' && PUSH_HOSTS.test(x.hostname);
    } catch (e) {
      return false;
    }
  });
  let action = 'flush';
  try {
    const b = await req.json();
    if (b && b.action) action = String(b.action);
  } catch (e) {
    /* no body: flush */
  }
  if (action === 'email') return json(await sendEmails(sql, opts));
  const keys = await getKeys(sql);
  if (action === 'key') return json({ key: keys.publicKey });
  let alerts = 0, sent = 0;
  const gone = [];
  for (let round = 0; round < 3; round++) {
    const rows = (await sql`select public.push_claim(100) as c`)[0].c || [];
    alerts += rows.length;
    await Promise.all(
      rows.flatMap((n) =>
        (n.subs || []).map(async (s) => {
          if (!allowed(s.endpoint)) return;
          try {
            const r = await send(s.endpoint, {
              method: 'POST',
              headers: {
                Authorization: await vapid(s.endpoint, keys),
                'Content-Encoding': 'aes128gcm',
                'Content-Type': 'application/octet-stream',
                TTL: '86400',
                Urgency: 'high',
              },
              body: await encrypt(s, payload(n)),
            });
            if (r.status === 404 || r.status === 410) gone.push(s.endpoint);
            else if (r.status < 300) sent++;
          } catch (e) {
            /* one phone failing doesn't stop the others */
          }
        }),
      ),
    );
    if (rows.length < 100) break;
  }
  if (gone.length) await sql`select public.push_drop(${gone}::text[])`;
  const mail = await sendEmails(sql, opts).catch((e) => ({ error: String(e.message || e) }));
  return json({ alerts, sent, dropped: gone.length, mail });
}

// ---------- email backup ----------
const getEnv = (k) => (typeof Deno !== 'undefined' && Deno.env ? Deno.env.get(k) : undefined) || '';
export function mailConfig(get = getEnv) {
  const user = get('SMTP_USER'), pass = get('SMTP_PASS');
  if (!user || !pass) return null;
  return {
    host: get('SMTP_HOST') || 'smtp.gmail.com',
    port: Number(get('SMTP_PORT') || 465),
    user,
    pass,
    from: get('EMAIL_FROM') || user,
    base: (get('SUPABASE_URL') || '').replace(/\/+$/, ''),
  };
}

// The app's own colours, so the email looks like ShopDesk.
const C = { bg: '#f4f5f6', card: '#ffffff', ink: '#101114', muted: '#6a6f78', line: '#e9eaec', soft: '#f4f5f6',
  good: '#16a34a', bad: '#e5484d', wait: '#e8a317', info: '#3b82f6' };
const FONT = "Figtree,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const abs = (u) => (String(u || '').startsWith('/') ? SITE + u : SITE + '/');
// "Funmi · BB-24" -> "Funmi"; a shop's name stays as it is
const nameOf = (a) => String(a.title || '').split(' · ')[0] || 'Someone';

// label, colour, the heading when it's the only thing in the email, the button
function kindOf(k, who) {
  const mine = who === 'customer';
  const K = {
    message: ['Message', C.info],
    new_order: ['New order', C.good, 'You have a new order', 'Open the order'],
    says_paid: ['Payment', C.wait, 'A customer says they’ve paid', 'Check the order'],
    paid: ['Payment', C.good, 'Payment received', 'See your order'],
    part_paid: ['Payment', C.wait, 'Part of your payment arrived', 'See your order'],
    confirmed: ['Confirmed', C.good, 'Your order is confirmed', 'Pay for your order'],
    fee: ['Delivery fee', C.wait, 'Your delivery fee is set', 'See your order'],
    ready: ['Ready', C.good, 'Your order is ready', 'See your order'],
    out: ['On its way', C.good, 'Your order is on its way', 'Track your order'],
    moved: ['New time', C.wait, 'Your delivery time changed', 'See your order'],
    delivered: ['Delivered', C.good, 'Your order was delivered', 'Confirm you got it'],
    received: ['Received', C.good, 'Your customer got the order', 'Open the order'],
    cancelled: ['Cancelled', C.bad, mine ? 'Your order was cancelled' : 'An order was cancelled', mine ? 'See your order' : 'Open the order'],
    problem: ['Problem', C.bad, 'A customer reported a problem', 'Answer it'],
    problem_answer: ['Problem', C.wait, 'The shop answered your problem', 'See the answer'],
    problem_sorted: ['Problem', C.good, 'A problem is sorted', 'Open the order'],
    problem_escalated: ['Problem', C.wait, 'ShopDesk is deciding a problem', 'Open the order'],
    decided: ['Decision', C.wait, 'ShopDesk made a decision', 'See the decision'],
    refund_sent: ['Refund', C.wait, 'Your refund was sent', 'Check and confirm'],
    refund_ok: ['Refund', C.good, 'Refund confirmed', 'Open the order'],
    refund_missing: ['Refund', C.bad, 'A refund didn’t arrive', 'Open the order'],
    nudge: ['ShopDesk', C.info, null, 'Open ShopDesk'], // the heading is the nudge's own title
    visit: ['Visitors', C.good, null, 'Open ShopDesk'], // "Someone is looking at your shop"
  };
  if (K[k]) return K[k];
  if (String(k).startsWith('admin') || k === 'report') return ['ShopDesk', C.info, 'Something needs you in Admin', 'Open Admin'];
  return ['Update', C.muted, 'You have an update', 'Open ShopDesk'];
}

// "4:12pm", "Yesterday 4:12pm" or "Sat 4:12pm", in Lagos time
export function whenText(iso, now = new Date()) {
  const d = new Date(iso);
  const day = (x) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'short' }).format(x);
  const t = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit' }).format(d).replace(/\s/g, '').toLowerCase();
  if (day(d) === day(now)) return t;
  if (day(d) === day(new Date(now.getTime() - 864e5))) return 'Yesterday ' + t;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short' }).format(d) + ' ' + t;
}

export function subjectFor(p) {
  const a = p.alerts, msgs = a.filter((x) => x.kind === 'message').length, other = a.length - msgs;
  const s = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  if (a.length === 1) {
    const x = a[0];
    if (x.kind === 'message') return clip('New message from ' + String(x.title).replace(' · ', ' about '), 90);
    return clip(x.title + ': ' + x.body, 90);
  }
  if (!other) return s(msgs, 'new message') + ' on ShopDesk';
  if (!msgs) return s(other, 'update') + ' on ShopDesk';
  return s(msgs, 'new message') + ' and ' + s(other, 'update') + ' on ShopDesk';
}

// The email itself: what happened, newest last, each with a way straight to it.
export function renderEmail(p, cfg = {}, now = new Date()) {
  const all = p.alerts, shown = all.slice(-6), more = all.length - shown.length;
  const msgs = all.filter((x) => x.kind === 'message');
  const one = all.length === 1 ? all[0] : null;
  const home = p.who === 'shop' ? SITE + '/#orders' : p.who === 'admin' ? SITE + '/admin' : SITE + '/orders';
  const stop = SITE + '/email-off?t=' + p.token;
  const unsub = cfg.base ? cfg.base + '/functions/v1/push?unsub=' + p.token : stop;
  let heading, button, target;
  if (one && one.kind === 'message') [heading, button, target] = [nameOf(one) + ' sent you a message', 'Reply to ' + nameOf(one), abs(one.url)];
  else if (one) { const k = kindOf(one.kind, p.who); [heading, button, target] = [k[2] || one.title, k[3], abs(one.url)]; }
  else if (msgs.length === all.length) [heading, button, target] = ['You have ' + all.length + ' new messages', 'Open ShopDesk', home];
  else [heading, button, target] = ['You missed ' + all.length + ' updates', 'Open ShopDesk', home];
  const subject = subjectFor(p);
  const hello = p.who === 'shop' && p.shop ? esc(p.shop) + ', here’s' : 'Here’s';
  const pre = clip(one ? one.body : (shown[shown.length - 1] || {}).body, 110);

  const item = (a, i) => {
    const [label, colour] = kindOf(a.kind, p.who);
    const isMsg = a.kind === 'message';
    const code = String(a.title || '').split(' · ')[1] || '';
    const body = isMsg
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px"><tr><td class="bubble" style="background:${C.soft};border-radius:16px 16px 16px 4px;padding:10px 14px;font-size:15px;line-height:22px;color:${C.ink}">${esc(a.body)}</td></tr></table>`
      : `<div class="muted" style="font-size:14px;line-height:21px;color:${C.muted};margin-top:4px">${esc(a.body)}</div>`;
    const link = one ? '' : `<a href="${esc(abs(a.url))}" class="ink" style="display:inline-block;margin-top:10px;font-size:14px;font-weight:700;color:${C.ink};text-decoration:none">${isMsg ? 'Reply' : 'Open'} &rarr;</a>`;
    return `<tr><td class="line" style="padding:16px 0;${i ? `border-top:1px solid ${C.line};` : ''}">
      <div class="muted" style="font-size:12px;line-height:16px;color:${C.muted};letter-spacing:.2px"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${colour};margin-right:6px;vertical-align:1px"></span>${esc(label)}${one && isMsg && code ? ' &middot; ' + esc(code) : ''} &middot; ${esc(whenText(a.at, now))}</div>
      ${one && isMsg ? '' : `<div class="ink" style="font-size:15px;line-height:21px;font-weight:700;color:${C.ink};margin-top:6px">${esc(a.title)}</div>`}
      ${body}${link}</td></tr>`;
  };

  const safety = p.who === 'customer'
    ? 'Only pay into the account on your order page. ShopDesk never asks for your sign-in code.'
    : 'ShopDesk never asks for your sign-in code or your bank PIN.';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title>
<style>
  body{margin:0;padding:0}
  a{color:inherit}
  @media (prefers-color-scheme: dark){
    .bg{background:#0d0e10!important}.card{background:#17181b!important}.ink{color:#f2f3f5!important}.muted{color:#9ea3ab!important}
    .bubble{background:#25272b!important;color:#f2f3f5!important}.line{border-color:#25272b!important}
    .btn{background:#f2f3f5!important}.btn a{color:#0d0e10!important}.logo{background:#f2f3f5!important;color:#0d0e10!important}
    .note{background:#25272b!important}
  }
</style></head>
<body class="bg" style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(pre)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:${C.bg};font-family:${FONT};color:${C.ink}">
<tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
  <tr><td style="padding:0 6px 14px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td class="logo" style="width:28px;height:28px;background:${C.ink};border-radius:8px;color:#ffffff;font-weight:800;font-size:17px;text-align:center;line-height:28px;font-family:${FONT}">S</td>
      <td class="ink" style="padding-left:9px;font-weight:800;font-size:18px;letter-spacing:-0.3px;color:${C.ink};font-family:${FONT}">ShopDesk</td>
    </tr></table>
  </td></tr>
  <tr><td class="card" style="background:${C.card};border-radius:18px;padding:26px 24px 24px">
    <h1 class="ink" style="margin:0;font-size:23px;line-height:29px;font-weight:800;letter-spacing:-0.3px;color:${C.ink}">${esc(heading)}</h1>
    <p class="muted" style="margin:6px 0 6px;font-size:15px;line-height:22px;color:${C.muted}">${hello} what happened while you were away.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${shown.map(item).join('')}</table>
    ${more > 0 ? `<p class="muted" style="margin:0 0 4px;font-size:14px;color:${C.muted}">And ${more} more in ShopDesk.</p>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr>
      <td class="btn" align="center" style="background:${C.ink};border-radius:12px">
        <a href="${esc(target)}" style="display:block;padding:14px 18px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;font-family:${FONT}">${esc(button)}</a>
      </td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px"><tr>
      <td class="note muted" style="background:${C.soft};border-radius:12px;padding:12px 14px;font-size:13px;line-height:19px;color:${C.muted}">&#128274; ${esc(safety)}</td>
    </tr></table>
  </td></tr>
  <tr><td class="muted" style="padding:18px 10px 0;text-align:center;font-size:12px;line-height:18px;color:${C.muted}">
    You get this when something happens and you haven’t opened ShopDesk for 10 minutes.<br>
    Turn on alerts in the app to hear straight away.<br><br>
    <a href="${esc(stop)}" class="muted" style="color:${C.muted};text-decoration:underline">Stop these emails</a> &nbsp;&middot;&nbsp;
    <a href="${SITE}" class="muted" style="color:${C.muted};text-decoration:none">shopdesk.com.ng</a>
  </td></tr>
  </table>
</td></tr></table>
</body></html>`;
  const text = [heading, '', ...shown.map((a) => [kindOf(a.kind, p.who)[0] + ' · ' + whenText(a.at, now), a.title, a.body, abs(a.url), ''].join('\n')),
    more > 0 ? 'And ' + more + ' more in ShopDesk.\n' : '', button + ': ' + target, '', safety, '',
    'You get this when something happens and you haven’t opened ShopDesk for 10 minutes.', 'Stop these emails: ' + stop].join('\n');
  return { subject, html, text, unsub };
}

// ---------- sending: plain SMTP over SSL (port 465), no extra packages ----------
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64Lines = (text) => b64(enc.encode(text)).replace(/.{1,76}/g, '$&\r\n').trimEnd();
// A subject with any characters (₦, ’, emoji), as RFC 2047 encoded words of at most 75 characters each.
function encodeSubject(s) {
  const clean = String(s).replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(clean) && clean.length < 70) return clean;
  const words = [];
  let cur = '';
  for (const ch of clean) {
    if (enc.encode(cur + ch).length > 42) { words.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => '=?UTF-8?B?' + b64(enc.encode(w)) + '?=').join('\r\n ');
}

export function buildMessage({ from, to, subject, html, text, unsub, now = new Date() }) {
  const b = 'sd-' + crypto.randomUUID();
  const head = [
    'From: "ShopDesk" <' + from + '>',
    'To: <' + to + '>',
    'Subject: ' + encodeSubject(subject),
    'Date: ' + now.toUTCString(),
    'Message-ID: <' + crypto.randomUUID() + '@shopdesk.com.ng>',
    'MIME-Version: 1.0',
    'List-Unsubscribe: <' + unsub + '>',
    ...(unsub.includes('?unsub=') ? ['List-Unsubscribe-Post: List-Unsubscribe=One-Click'] : []),
    'Auto-Submitted: auto-generated',
    'X-Auto-Response-Suppress: All',
    'Content-Type: multipart/alternative; boundary="' + b + '"',
  ];
  const part = (type, body) => ['--' + b, 'Content-Type: ' + type + '; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64Lines(body)].join('\r\n');
  return head.join('\r\n') + '\r\n\r\n' + part('text/plain', text) + '\r\n' + part('text/html', html) + '\r\n--' + b + '--\r\n';
}

export async function smtpOpen(cfg) {
  const conn = cfg.connect
    ? await cfg.connect(cfg)
    : await Deno.connectTls({ hostname: cfg.host, port: cfg.port, ...(cfg.caCerts ? { caCerts: cfg.caCerts } : {}) });
  const dec = new TextDecoder();
  let buf = '', broken = false;
  async function readReply() {
    const lines = [];
    for (;;) {
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        lines.push(line);
        if (/^\d{3}( |$)/.test(line)) return { code: Number(line.slice(0, 3)), text: lines.join(' | ') };
      }
      const chunk = new Uint8Array(4096);
      const n = await conn.read(chunk);
      if (n === null) throw new Error('The mail server closed the connection.');
      buf += dec.decode(chunk.subarray(0, n), { stream: true });
    }
  }
  async function write(s) {
    const data = enc.encode(s);
    for (let off = 0; off < data.length; ) off += await conn.write(data.subarray(off));
  }
  async function cmd(line, want, stage) {
    if (broken) throw new Error('The mail connection is closed.');
    let timer;
    try {
      if (line != null) await write(line + '\r\n');
      const r = await Promise.race([readReply(), new Promise((_, no) => (timer = setTimeout(() => no(new Error('The mail server took too long.')), 20000)))]);
      if (!want.includes(r.code)) throw Object.assign(new Error(('Mail server said ' + r.text).slice(0, 300)), { code: r.code, stage });
      return r;
    } catch (e) {
      if (!e.code) broken = true;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    await cmd(null, [220], 'hello');
    await cmd('EHLO shopdesk.com.ng', [250], 'hello');
    await cmd('AUTH PLAIN ' + b64(enc.encode('\0' + cfg.user + '\0' + cfg.pass)), [235], 'sign-in');
  } catch (e) {
    try { conn.close(); } catch (x) { /* already closed */ }
    throw e;
  }
  return {
    async send(from, to, data) {
      try {
        await cmd('MAIL FROM:<' + from + '>', [250], 'from');
        await cmd('RCPT TO:<' + to + '>', [250, 251], 'to');
        await cmd('DATA', [354], 'data');
        await write(data.replace(/\r\n\./g, '\r\n..') + '.\r\n');
        await cmd(null, [250], 'data');
      } catch (e) {
        if (e.code) await cmd('RSET', [250], 'reset').catch(() => {});
        throw e;
      }
    },
    async close() {
      await cmd('QUIT', [221], 'bye').catch(() => {});
      try { conn.close(); } catch (e) { /* already closed */ }
    },
  };
}

const EMAIL_OK = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/;
// Sends the emails that are due. A server that's down or a wrong password: the alerts wait for the next try (30 minutes).
// An address the mail server refuses for good: that email is dropped.
export async function sendEmails(sql, opts = {}) {
  const cfg = opts.mail !== undefined ? opts.mail : mailConfig();
  if (!cfg) return { emails: 0, failed: 0, off: 'no email account set up' };
  const people = (await sql`select public.email_claim(20) as c`)[0].c || [];
  if (!people.length) return { emails: 0, failed: 0 };
  let s = null, emails = 0, failed = 0, why = '';
  try {
    s = await smtpOpen(cfg);
  } catch (e) {
    why = e.message;
  }
  for (const p of people) {
    const ids = p.alerts.map((a) => a.id);
    try {
      if (!s) throw new Error(why || 'No mail connection.');
      if (!EMAIL_OK.test(p.email || '')) continue;
      const m = renderEmail(p, cfg);
      await s.send(cfg.from, p.email, buildMessage({ from: cfg.from, to: p.email, ...m }));
      emails++;
    } catch (e) {
      failed++;
      console.error('email backup: ' + e.message);
      const forGood = e.stage === 'to' && e.code >= 500;
      if (!forGood) await sql`select public.email_unclaim(${p.user_id}::uuid, ${ids}::bigint[])`;
    }
  }
  if (s) await s.close();
  return { emails, failed, ...(why ? { error: why } : {}) };
}

let db = null;
if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve(async (req) => {
    try {
      db = db || postgres(Deno.env.get('SUPABASE_DB_URL'), { prepare: false, max: 3, idle_timeout: 20 });
      return await handle(req, db);
    } catch (e) {
      console.error(e);
      return json({ error: 'failed' }, 500);
    }
  });
}
