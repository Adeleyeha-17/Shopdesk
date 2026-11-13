// @ts-nocheck
// ShopDesk money (a Supabase Edge Function named "money"): paying online with Paystack, and ShopDesk Delivery with Shipbubble.
// Both stay off until they are switched on in Admin > Payments & delivery.
//
// Paying online: the customer pays once. The goods money settles straight into the shop's own bank account (a Paystack
// subaccount made from the bank details the shop already gave), and when the order goes with ShopDesk Delivery, the delivery
// fee goes to ShopDesk's account in the same payment. ShopDesk never holds a shop's money. Paystack's fee and ShopDesk's
// small fee are added on top for the customer (Admin can change who pays Paystack's fee), so the shop gets the full amount.
// Leave Paystack's own "pass fees to customers" setting off: the fee is already added here.
// ShopDesk Delivery: ShopDesk has the one courier account (Shipbubble) and pays couriers from its wallet there.
//
//   POST {"action":"quote", "order":id}                      shop: courier prices for a new order
//   POST {"action":"pick", "order":id, "courier_id", "service_code"}   shop: pick one; it becomes the delivery fee
//   POST {"action":"book", "order":id}                       shop: book the courier for a paid, packed order
//   POST {"action":"track", "order":id} or {"token":...}     shop or customer: the latest from the courier
//   POST {"action":"pay", "token":...}                       customer: start paying online, returns the Paystack page
//   POST {"action":"check", "reference":...}                 customer back from Paystack: was it paid?
//   POST {"action":"status"}                                 admin: are the keys set, test or live, courier wallet balance
//   POST ?hook=paystack                                      Paystack's webhook
//   POST ?hook=shipbubble                                    Shipbubble's webhook
//
// Secrets (Edge Functions -> Secrets): PAYSTACK_SECRET_KEY and SHIPBUBBLE_API_KEY. Test keys while testing, live keys once the
// accounts are approved. SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_DB_URL are provided by Supabase.
// Deploy with "Verify JWT" turned off (the function checks who is asking itself, and the webhooks have no sign-in).
import postgres from 'npm:postgres@3.4.5';

const SITE = 'https://shopdesk.com.ng';
const PAYSTACK = 'https://api.paystack.co';
const SHIPBUBBLE = 'https://api.shipbubble.com/v1';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// A message meant for the person (shown in the app as it is).
class Say extends Error {}
const say = (m) => new Say(m);

const enc = new TextEncoder();
async function hmac512(key, body) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(body)));
}
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (b) => btoa(String.fromCharCode(...b));
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Today's date in Lagos, as yyyy-mm-dd.
const lagosDate = (now = Date.now()) => new Date(now + 3600000).toISOString().slice(0, 10);
const validDate = (s) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null);
// Prices the customer sees end in 0 or 50.
const roundUp = (n) => Math.ceil(n / 50) * 50;

export function makeApi(env, fetcher) {
  const get = (k) => env(k) || '';

  async function call(base, path, key, body, method) {
    let r, j;
    try {
      r = await fetcher(base + path, {
        method: method || (body ? 'POST' : 'GET'),
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      j = await r.json().catch(() => ({}));
    } catch (e) {
      console.error(base + path + ': ' + e.message);
      throw say('The connection dropped. Try again.');
    }
    if (!r.ok || j.status === false || j.status === 'failed' || j.status === 'error') {
      const e = new Error(String(j.message || 'HTTP ' + r.status));
      e.http = r.status;
      e.body = j;
      throw e;
    }
    return j.data;
  }

  const paystack = (path, body, method) => {
    const key = get('PAYSTACK_SECRET_KEY');
    if (!key) throw say('Paying online isn’t set up yet. Pay by transfer for now.');
    return call(PAYSTACK, path, key, body, method);
  };
  const ship = (path, body) => {
    const key = get('SHIPBUBBLE_API_KEY');
    if (!key) throw say('ShopDesk Delivery isn’t set up yet. Use your own rider for now.');
    return call(SHIPBUBBLE, path, key, body);
  };
  return { paystack, ship, get };
}

// ---------- ShopDesk Delivery ----------

// The courier service's goods categories, matched to what the shop sells.
let categories = null;
const CATEGORY_WORDS = [
  [/food|cake|snack|drink|grocer|kitchen|meal|chop|pastr|bak/i, /food/i],
  [/phone|laptop|gadget|electronic|computer|tech|charger|accessor.*phone/i, /electronic|gadget/i],
  [/jewel|gold|bead|ring|necklace|earring/i, /jewel/i],
  [/cloth|wear|fashion|shoe|sneaker|dress|shirt|gown|ankara|lace|fabric|thrift|wig|hair/i, /fashion|wear|cloth/i],
  [/bag|watch|accessor|belt|glass|cap|hat/i, /accessor/i],
  [/cream|skin|beauty|cosmetic|perfume|soap|makeup|body/i, /beauty|cosmetic|health/i],
  [/book|station/i, /book|document/i],
];
export async function categoryFor(api, sells) {
  if (!categories) categories = (await api.ship('/shipping/labels/categories')) || [];
  const find = (re) => categories.find((c) => re.test(c.category || ''));
  for (const [words, name] of CATEGORY_WORDS) if (words.test(sells || '')) {
    const c = find(name);
    if (c) return c.category_id;
  }
  const other = find(/other|general|miscell/i) || find(/fashion|wear/i) || categories[0];
  if (!other) throw say('ShopDesk Delivery can’t get prices right now. Try again shortly.');
  return other.category_id;
}

async function addressCode(api, who) {
  try {
    const d = await api.ship('/shipping/address/validate', who);
    if (!d?.address_code) throw new Error('no address code');
    return d.address_code;
  } catch (e) {
    if (e instanceof Say) throw e;
    console.error('address check: ' + e.message);
    return null;
  }
}

// Gets the pickup address code of the shop (checked once, kept until the shop changes its pickup address).
async function pickupCode(sql, api, shop) {
  if (shop.pickup_code) return shop.pickup_code;
  const code = await addressCode(api, {
    name: shop.name, email: shop.email, phone: shop.phone || '', address: shop.pickup_address,
  });
  if (!code) throw say('The courier service couldn’t find your pickup address. Check it on the Shop tab: add the street, area and city.');
  await sql`update public.shops set pickup_code = ${code} where id = ${shop.id} and pickup_address = ${shop.pickup_address}`;
  return code;
}

// Courier prices for an order. info is what money_quote_info returns.
export async function fetchQuotes(sql, api, info) {
  const { order, shop, items, margin } = info;
  const from = await pickupCode(sql, api, shop);
  const address = order.area && !order.address.toLowerCase().includes(String(order.area).toLowerCase()) ? order.address + ', ' + order.area : order.address;
  const to = await addressCode(api, {
    name: order.name, email: order.email || 'order' + order.id + '@shopdesk.com.ng', phone: order.phone, address,
    ...(order.lat != null && order.lng != null ? { latitude: Number(order.lat), longitude: Number(order.lng) } : {}),
  });
  if (!to) throw say('The courier service couldn’t find the delivery address. Ask the customer for the street, area and city, or use your own rider.');
  let d;
  try {
    d = await api.ship('/shipping/fetch_rates', {
      sender_address_code: from,
      reciever_address_code: to,
      pickup_date: lagosDate(),
      category_id: await categoryFor(api, shop.sells),
      package_items: (items || []).map((i) => ({
        name: String(i.name).slice(0, 80), description: String(i.name).slice(0, 120), unit_weight: '0.5', unit_amount: String(i.price), quantity: String(i.qty),
      })),
      package_dimension: { length: 30, width: 25, height: 15 },
      delivery_instructions: 'Order #' + order.id + ' from ' + shop.name + ' (ShopDesk)',
    });
  } catch (e) {
    if (e instanceof Say) throw e;
    console.error('fetch_rates: ' + e.message);
    throw say('No courier can take this order right now. Try again later or use your own rider.');
  }
  const list = (d?.couriers || [])
    .filter((c) => c.courier_id && c.service_code && Number(c.rate_card_amount || c.total) > 0)
    .map((c) => ({
      courier_id: String(c.courier_id),
      service_code: String(c.service_code),
      name: String(c.courier_name || 'Courier').slice(0, 60),
      image: c.courier_image || null,
      cost: Math.round(Number(c.total || c.rate_card_amount)),
      price: roundUp(Number(c.rate_card_amount || c.total) + Number(margin || 0)),
      eta: validDate(c.delivery_eta_time),
      eta_text: String(c.delivery_eta || '').slice(0, 60),
      token: d.request_token,
    }))
    .sort((a, b) => a.price - b.price)
    .slice(0, 6);
  if (!list.length) throw say('No courier can take this order right now. Try again later or use your own rider.');
  const fastest = d.fastest_courier;
  if (fastest) for (const q of list) q.fastest = q.courier_id === String(fastest.courier_id) && q.service_code === String(fastest.service_code);
  list[0].cheapest = true;
  return list;
}

async function createLabel(api, q) {
  return api.ship('/shipping/labels', { request_token: q.token, service_code: q.service_code, courier_id: q.courier_id });
}

// Books the courier. If the saved prices have expired or that courier is no longer free, it gets fresh prices and books the
// same courier again.
export async function bookCourier(sql, api, quote, info) {
  let label;
  try {
    label = await createLabel(api, quote);
  } catch (e) {
    if (e instanceof Say) throw e;
    if (/balance|insufficient|fund/i.test(e.message)) return walletLow(sql, e.message);
    console.error('label (saved prices): ' + e.message);
    const fresh = await fetchQuotes(sql, api, info);
    const again = fresh.find((q) => q.courier_id === quote.courier_id && q.service_code === quote.service_code);
    if (!again) throw say(quote.name + ' can’t take this order now. Use your own rider, or ask ShopDesk to change the courier.');
    try {
      label = await createLabel(api, again);
      quote = again;
    } catch (e2) {
      if (/balance|insufficient|fund/i.test(e2.message)) return walletLow(sql, e2.message);
      console.error('label (fresh prices): ' + e2.message);
      throw say('The courier couldn’t be booked right now. Try again shortly, or use your own rider.');
    }
  }
  return {
    sb_order: String(label.order_id),
    courier: label.courier?.name || quote.name,
    courier_phone: String(label.courier?.phone || '').slice(0, 20),
    status: label.status || 'pending',
    tracking_url: label.tracking_url || null,
    cost: Math.round(Number(label.payment?.shipping_fee || quote.cost || 0)),
    eta: quote.eta || null,
  };
}

async function walletLow(sql, why) {
  console.error('courier wallet: ' + why);
  await sql`select public.notify_admins('courier_wallet', 'Top up the courier wallet', 'A shop tried to book ShopDesk Delivery but the Shipbubble wallet is too low.', '/admin#money')`.catch(() => {});
  throw say('ShopDesk Delivery can’t book right now. We have been told and are fixing it. Use your own rider if it can’t wait.');
}

// What the courier service says about a shipment, in the shape money_ship_update takes.
export function shipmentUpdate(s) {
  const steps = (s.package_status || [])
    .map((x) => ({ status: String(x.status || '').slice(0, 80), at: validDate(x.datetime) }))
    .filter((x) => x.status)
    .slice(-20);
  const r = s.courier?.rider_info;
  const rider = r && (r.name || r.phone) ? { name: String(r.name || '').slice(0, 60), phone: String(r.phone || '').slice(0, 20) } : null;
  return {
    status: String(s.status || '').toLowerCase().slice(0, 40),
    ...(steps.length ? { steps } : {}),
    ...(s.tracking_url ? { tracking_url: s.tracking_url } : {}),
    ...(s.courier?.tracking_code ? { tracking_code: String(s.courier.tracking_code) } : {}),
    ...(rider ? { rider } : {}),
  };
}

// ---------- Pay online ----------

// The banks a shop can pick (src/vendor/shopForm.jsx), matched to the names in Paystack's bank list.
const BANKS = {
  OPay: /opay|paycom/i, Moniepoint: /moniepoint/i, Kuda: /kuda/i, PalmPay: /palmpay/i,
  'Access Bank': /^access bank/i, Carbon: /carbon/i, Citibank: /citi ?bank/i, Ecobank: /ecobank/i, FairMoney: /fairmoney/i,
  FCMB: /first city monument|fcmb/i, 'Fidelity Bank': /^fidelity/i, 'First Bank': /^first bank/i, 'Globus Bank': /globus/i,
  GTBank: /guaranty trust|gtbank/i, 'Jaiz Bank': /jaiz/i, 'Keystone Bank': /keystone/i, 'Lotus Bank': /lotus/i,
  'Optimus Bank': /optimus/i, Paga: /^paga/i, 'Parallex Bank': /parallex/i, 'Polaris Bank': /polaris/i,
  'PremiumTrust Bank': /premium ?trust/i, 'Providus Bank': /providus/i, 'Signature Bank': /signature/i,
  'Stanbic IBTC': /stanbic/i, 'Standard Chartered': /standard chartered/i, 'Sterling Bank': /^sterling/i,
  'SunTrust Bank': /suntrust/i, 'TAJ Bank': /^taj/i, 'Titan Trust Bank': /titan/i, UBA: /united bank for africa|^uba\b/i,
  'Union Bank': /^union bank/i, 'Unity Bank': /^unity/i, VFD: /vfd/i, 'Wema Bank': /wema/i, 'Zenith Bank': /zenith/i,
};
let bankList = null;
// The shortest matching name wins, so "Access Bank" is picked over "Access Bank (Diamond)".
export async function bankCode(api, bank) {
  const re = BANKS[bank];
  if (!re) return null;
  if (!bankList) bankList = (await api.paystack('/bank?country=nigeria&perPage=200')) || [];
  const hits = bankList.filter((b) => b.active !== false && (re.test(b.name || '') || re.test(b.slug || '')));
  hits.sort((a, b) => String(a.name).length - String(b.name).length);
  return hits[0]?.code || null;
}

export async function ensureSubaccount(sql, api, shop) {
  const want = shop.bank + ':' + shop.account_number;
  if (shop.subaccount && shop.subaccount_for === want) return shop.subaccount;
  const code = await bankCode(api, shop.bank);
  if (!code || !/^\d{10}$/.test(shop.account_number || '')) throw say('This shop can’t take online payments yet. Pay by transfer to the account above.');
  const body = { business_name: String(shop.name).slice(0, 100), settlement_bank: code, account_number: shop.account_number, percentage_charge: 0 };
  let d;
  try {
    d = shop.subaccount ? await api.paystack('/subaccount/' + shop.subaccount, body, 'PUT') : await api.paystack('/subaccount', body);
  } catch (e) {
    if (e instanceof Say) throw e;
    console.error('subaccount: ' + e.message);
    throw say('This shop can’t take online payments yet. Pay by transfer to the account above.');
  }
  const sub = d?.subaccount_code || shop.subaccount;
  await sql`update public.shops set paystack_subaccount = ${sub}, paystack_for = ${want} where id = ${shop.id}`;
  return sub;
}

export async function startPayment(sql, api, r, token, ref) {
  const sub = await ensureSubaccount(sql, api, r.shop);
  // The customer pays the goods (and delivery), plus ShopDesk's fee, plus Paystack's fee when fee > 0. ShopDesk's share is
  // the delivery fee and both fees, and Paystack takes its fee from ShopDesk's share, so the shop's share is exactly what
  // the shop is owed.
  const fee = Number(r.fee || 0);
  const service = Number(r.service || 0);
  const body = {
    email: r.email,
    amount: (r.amount + fee + service) * 100,
    currency: 'NGN',
    reference: ref,
    subaccount: sub,
    bearer: fee > 0 || (r.delivery_part > 0 && r.fee_by === 'shopdesk') ? 'account' : 'subaccount',
    callback_url: SITE + '/o/' + token,
    metadata: { order_id: r.order_id, shop: r.shop.slug, delivery_part: r.delivery_part, card_fee: fee, shopdesk_fee: service, cancel_action: SITE + '/o/' + token },
  };
  if (r.delivery_part + fee + service > 0) body.transaction_charge = (r.delivery_part + fee + service) * 100;
  try {
    const d = await api.paystack('/transaction/initialize', body);
    return { url: d.authorization_url, reference: ref };
  } catch (e) {
    if (e instanceof Say) throw e;
    console.error('initialize: ' + e.message);
    throw say('Paying online isn’t working right now. Try again, or pay by transfer.');
  }
}

// Checks with Paystack, then marks the order paid. Safe to run more than once for the same payment.
export async function confirmPayment(sql, api, ref) {
  let d;
  try {
    d = await api.paystack('/transaction/verify/' + encodeURIComponent(ref));
  } catch (e) {
    if (e instanceof Say) throw e;
    if (e.http === 404 || e.http === 400) return { paid: false, status: 'unknown' };
    throw say('Couldn’t check the payment yet. Refresh in a moment.');
  }
  if (d?.status !== 'success' || (d.currency && d.currency !== 'NGN')) return { paid: false, status: d?.status || 'unknown' };
  const r = (await sql`select public.money_paid(${ref}, ${d.amount}::bigint) as r`)[0].r;
  return { paid: true, order_id: r.order_id };
}

// ---------- Requests ----------

async function whoIs(req, env, fetcher) {
  const auth = req.headers.get('authorization') || '';
  const tok = auth.replace(/^Bearer\s+/i, '');
  const anon = env('SUPABASE_ANON_KEY');
  if (!tok || tok === anon) return null;
  try {
    const r = await fetcher(env('SUPABASE_URL') + '/auth/v1/user', { headers: { Authorization: 'Bearer ' + tok, apikey: anon } });
    if (!r.ok) return null;
    return (await r.json()).id || null;
  } catch (e) {
    return null;
  }
}

// Runs the database steps as the person asking, so the same checks apply as in the app.
const asUser = (sql, uid, fn) =>
  sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claim.sub', ${uid || ''}, true)`;
    return fn(tx);
  });
const one = async (q) => (await q)[0]?.r;

const ACTIONS = {
  async quote({ sql, api, uid, body }) {
    if (!uid) throw say('Sign in again.');
    const id = Number(body.order);
    const info = await asUser(sql, uid, (tx) => one(tx`select public.money_quote_info(${id}) as r`));
    const list = await fetchQuotes(sql, api, info);
    await asUser(sql, uid, (tx) => tx`select public.money_save_quotes(${id}, ${sql.json(list)})`);
    return { list: list.map(({ token, cost, ...q }) => q) };
  },

  async pick({ sql, uid, body }) {
    if (!uid) throw say('Sign in again.');
    const q = await asUser(sql, uid, (tx) => one(tx`select public.money_pick_quote(${Number(body.order)}, ${String(body.courier_id)}, ${String(body.service_code)}) as r`));
    return { name: q.name, price: q.price, eta: q.eta, eta_text: q.eta_text };
  },

  async book({ sql, api, uid, body }) {
    if (!uid) throw say('Sign in again.');
    const id = Number(body.order);
    const { quote, info } = await asUser(sql, uid, (tx) => one(tx`select public.money_book_info(${id}) as r`));
    const s = await bookCourier(sql, api, quote, info);
    await asUser(sql, uid, (tx) => tx`select public.money_save_shipment(${id}, ${sql.json(s)})`);
    return { courier: s.courier, tracking_url: s.tracking_url, status: s.status };
  },

  async track({ sql, api, uid, body }) {
    let row;
    if (body.token) {
      row = (await sql`select sh.sb_order, sh.updated_at from public.shipments sh join public.orders o on o.id = sh.order_id where o.public_token = ${String(body.token)}::uuid`)[0];
    } else {
      if (!uid) throw say('Sign in again.');
      const id = await asUser(sql, uid, (tx) => one(tx`select (public.owned_order(${Number(body.order)})).id as r`));
      row = (await sql`select sb_order, updated_at from public.shipments where order_id = ${id}`)[0];
    }
    if (!row) return { shipment: null };
    // Ask the courier service at most once a minute per shipment; webhooks keep it up to date in between.
    if (Date.now() - new Date(row.updated_at).getTime() > 60000) {
      try {
        const d = await api.ship('/shipping/labels/list/' + encodeURIComponent(row.sb_order));
        const s = (d?.results || [])[0];
        if (s) await sql`select public.money_ship_update(${row.sb_order}, ${sql.json(shipmentUpdate(s))})`;
      } catch (e) {
        console.error('track: ' + e.message);
      }
    }
    const sh = (await sql`select courier, status, tracking_url, tracking_code, steps, rider from public.shipments where sb_order = ${row.sb_order}`)[0];
    return { shipment: sh || null };
  },

  async pay({ sql, api, uid, body }) {
    const token = String(body.token || '');
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw say('Order not found.');
    const ref = 'SD' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomUUID().slice(0, 8).toUpperCase();
    const r = await asUser(sql, uid, (tx) => one(tx`select public.money_start_payment(${token}::uuid, ${ref}) as r`));
    return startPayment(sql, api, r, token, ref);
  },

  async check({ sql, api, body }) {
    const ref = String(body.reference || '');
    if (!/^SD[A-Z0-9-]{6,40}$/.test(ref)) return { paid: false, status: 'unknown' };
    const known = (await sql`select status from public.online_payments where reference = ${ref}`)[0];
    if (!known) return { paid: false, status: 'unknown' };
    if (known.status === 'paid') return { paid: true };
    return confirmPayment(sql, api, ref);
  },

  async status({ sql, api, uid }) {
    const admin = uid && (await asUser(sql, uid, (tx) => one(tx`select public.is_admin() as r`)));
    if (!admin) throw say('Not allowed.');
    const pk = api.get('PAYSTACK_SECRET_KEY'), sk = api.get('SHIPBUBBLE_API_KEY');
    const out = {
      paystack: { set: !!pk, mode: pk ? (pk.startsWith('sk_live_') ? 'live' : 'test') : null },
      courier: { set: !!sk, mode: sk ? (sk.startsWith('sb_prod_') ? 'live' : 'test') : null, balance: null },
    };
    if (sk) {
      try {
        const w = await api.ship('/shipping/wallet/balance');
        out.courier.balance = Math.round(Number(w?.balance || 0));
      } catch (e) {
        out.courier.error = 'Couldn’t read the wallet: ' + (e instanceof Say ? e.message : 'check the Shipbubble key.');
      }
    }
    return out;
  },
};

async function paystackHook(req, sql, api) {
  const raw = await req.text();
  const key = api.get('PAYSTACK_SECRET_KEY');
  if (!key || !same(hex(await hmac512(key, raw)), req.headers.get('x-paystack-signature') || '')) return json({ error: 'bad signature' }, 401);
  let ev;
  try {
    ev = JSON.parse(raw);
  } catch (e) {
    return json({ ok: true });
  }
  const ref = ev?.data?.reference;
  if (ev?.event === 'charge.success' && typeof ref === 'string' && ref.startsWith('SD')) {
    try {
      await confirmPayment(sql, api, ref);
    } catch (e) {
      console.error('paystack hook ' + ref + ': ' + e.message);
    }
  }
  return json({ ok: true });
}

async function shipbubbleHook(req, sql, api) {
  const raw = await req.text();
  const key = api.get('SHIPBUBBLE_API_KEY');
  const sig = req.headers.get('x-ship-signature') || '';
  if (!key) return json({ error: 'not set up' }, 401);
  const mac = await hmac512(key, raw);
  if (!same(hex(mac), sig.toLowerCase()) && !same(b64(mac), sig)) return json({ error: 'bad signature' }, 401);
  let ev;
  try {
    ev = JSON.parse(raw);
  } catch (e) {
    return json({ ok: true });
  }
  const s = ev?.data && typeof ev.data === 'object' ? ev.data : ev;
  const id = s?.order_id;
  if (id) {
    const u = shipmentUpdate(s);
    if (/cancel/i.test(ev?.event || '')) u.status = 'cancelled';
    try {
      await sql`select public.money_ship_update(${String(id)}, ${sql.json(u)})`;
    } catch (e) {
      console.error('shipbubble hook ' + id + ': ' + e.message);
    }
  }
  return json({ ok: true });
}

export async function handle(req, sql, opts = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const env = opts.env || ((k) => Deno.env.get(k));
  const fetcher = opts.fetch || fetch;
  const api = makeApi(env, fetcher);
  const hook = new URL(req.url).searchParams.get('hook');
  if (hook === 'paystack') return paystackHook(req, sql, api);
  if (hook === 'shipbubble') return shipbubbleHook(req, sql, api);

  let body = {};
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: 'Send JSON.' }, 400);
  }
  const act = ACTIONS[body.action];
  if (!act) return json({ error: 'Unknown action.' }, 400);
  try {
    const uid = await whoIs(req, env, fetcher);
    return json(await act({ sql, api, uid, body }));
  } catch (e) {
    // Messages raised by the database checks are written for the person too.
    if (e instanceof Say || (e?.severity === 'ERROR' && e?.code === 'P0001')) return json({ error: e.message });
    console.error(body.action + ': ' + (e?.stack || e));
    return json({ error: 'Something went wrong. Try again.' });
  }
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
