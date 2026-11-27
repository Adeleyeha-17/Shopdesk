// The money server function, run with Node against the test database that tests/db/run.sh leaves behind,
// with Paystack, Shipbubble and Supabase sign-in faked. Run tests/db/run.sh first, then: node tests/functions/money.mjs
// Uses the usual PGHOST, PGPORT, PGUSER and PGPASSWORD; TEST_DB names the database (shopdesk_test).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const copy = path.join(os.tmpdir(), 'shopdesk-money-' + process.pid + '.mjs');
fs.writeFileSync(copy, fs.readFileSync(path.join(here, '../../supabase/functions/money/index.ts'), 'utf8')
  .replace("'npm:postgres@3.4.5'", JSON.stringify(import.meta.resolve('postgres'))));
const { handle, bankCode, nubanOk, likelyBanks } = await import(pathToFileURL(copy).href);
fs.unlinkSync(copy);

const sql = postgres({ database: process.env.TEST_DB || 'shopdesk_test', max: 3, onnotice: () => {} });
const SHOP = 'c7700000-0000-4000-8000-000000000001', CUST = 'c7700000-0000-4000-8000-000000000002', ADMIN = 'c7700000-0000-4000-8000-000000000009';
const ENV = { PAYSTACK_SECRET_KEY: 'sk_test_abc', SHIPBUBBLE_API_KEY: 'sb_sandbox_xyz', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' };
const calls = [];
const reply = (data, status = 200, extra = {}) => new Response(JSON.stringify({ status: status < 300 ? 'success' : 'failed', data, ...extra }), { status });
let labelFails = 0;
async function fakeFetch(url, init = {}) {
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, method: init.method || 'GET', body });
  const u = new URL(url);
  if (u.pathname === '/auth/v1/user') {
    const t = (init.headers.Authorization || '').slice(7);
    return new Response(JSON.stringify({ id: { shop: SHOP, cust: CUST, admin: ADMIN }[t] }), { status: t in { shop: 1, cust: 1, admin: 1 } ? 200 : 401 });
  }
  if (u.host === 'api.shipbubble.com') {
    if (u.pathname.endsWith('/address/validate')) return reply({ address_code: body.address.includes('Herbert') ? 111 : 222 });
    if (u.pathname.endsWith('/labels/categories')) return reply([{ category_id: 98246239, category: 'Fashion wears' }, { category_id: 90097994, category: 'Accessories' }]);
    if (u.pathname.endsWith('/fetch_rates')) return reply({ request_token: 'RT' + calls.length, couriers: [
      { courier_id: 'gig', courier_name: 'GIG Logistics', service_code: 'gig_std', rate_card_amount: 3120, total: 3000, delivery_eta: 'Within 2 days', delivery_eta_time: '2030-01-03T12:00:00Z' },
      { courier_id: 'kwik', courier_name: 'Kwik', service_code: 'kwik_bike', rate_card_amount: 2010, total: 1900, delivery_eta: 'Same day', delivery_eta_time: 'soon' },
      { courier_id: 'gig', courier_name: 'GIG Logistics', service_code: 'gig_terminal', rate_card_amount: 1500, total: 1400, delivery_eta: 'Collect at GIG centre in 2 days' },
      { courier_id: 'abc', courier_name: 'ABC Cargo', service_code: 'abc_dropoff', service_type: 'dropoff', rate_card_amount: 1200, total: 1100, delivery_eta: '3 days' },
    ], fastest_courier: { courier_id: 'kwik', service_code: 'kwik_bike' } });
    if (u.pathname.endsWith('/shipping/labels')) {
      if (labelFails-- > 0) return reply(null, 400, { message: 'request token expired' });
      return reply({ order_id: 'SB-777', courier: { name: 'Kwik', phone: '08011112222' }, status: 'pending', tracking_url: 'https://track.example/777', payment: { shipping_fee: 1900 } });
    }
    if (u.pathname.includes('/labels/list/')) return reply({ results: [{ order_id: 'SB-777', status: 'in_transit', tracking_url: 'https://track.example/777',
      courier: { tracking_code: 'KW123', rider_info: { name: 'Musa', phone: '08099998888' } }, package_status: [{ status: 'Picked up', datetime: '2030-01-02T10:00:00Z' }] }] });
    if (u.pathname.endsWith('/wallet/balance')) return reply({ balance: 25000.5, currency: 'NGN' });
  }
  if (u.host === 'api.paystack.co') {
    if (u.pathname === '/bank') return new Response(JSON.stringify({ status: true, data: [{ name: 'Kuda Bank', code: '50211' }, { name: 'OPay Digital Services Limited (OPay)', slug: 'paycom', code: '999992' },
      { name: 'Access Bank (Diamond)', code: '063' }, { name: 'Access Bank', code: '044' }, { name: 'Guaranty Trust Bank', code: '058' },
      { name: 'First Bank of Nigeria', code: '011' }, { name: 'United Bank For Africa', code: '033' }] }));
    if (u.pathname === '/bank/resolve') {
      const known = { '2012345678:50211': 'ADA OKAFOR', '8031234567:999992': 'ADA OKAFOR' };
      const name = known[u.searchParams.get('account_number') + ':' + u.searchParams.get('bank_code')];
      return name ? new Response(JSON.stringify({ status: true, data: { account_name: name } })) : new Response(JSON.stringify({ status: false, message: 'Could not resolve account name' }), { status: 422 });
    }
    if (u.pathname === '/subaccount') return new Response(JSON.stringify({ status: true, data: { subaccount_code: 'ACCT_shop1' } }));
    if (u.pathname === '/transaction/initialize') return new Response(JSON.stringify({ status: true, data: { authorization_url: 'https://checkout.paystack.com/abc' } }));
    if (u.pathname.startsWith('/transaction/verify/')) return new Response(JSON.stringify({ status: true, data: { status: 'success', amount: paidKobo, currency: 'NGN' } }));
  }
  if (u.host === 'api.monnify.com' || u.host === 'sandbox.monnify.com') {
    const ok = (b) => new Response(JSON.stringify({ requestSuccessful: true, responseMessage: 'success', responseCode: '0', responseBody: b }));
    if (u.pathname === '/api/v1/auth/login') return ok({ accessToken: 'mn-token', expiresIn: 3000 });
    if (u.pathname === '/api/v1/banks') return ok([{ name: 'Opay', code: '999992' }, { name: 'Kuda Microfinance Bank', code: '50211' }]);
    if (u.pathname === '/api/v1/sub-accounts') return ok([{ subAccountCode: 'MFY_SUB_1' }]);
    if (u.pathname === '/api/v1/merchant/transactions/init-transaction') return ok({ checkoutUrl: 'https://sandbox.sdk.monnify.com/checkout/xyz' });
    if (u.pathname === '/api/v2/merchant/transactions/query') return ok({ paymentStatus: gw.monnify ? 'PAID' : 'PENDING', amountPaid: gw.monnify || 0, currencyCode: 'NGN' });
  }
  if (u.host === 'api.flutterwave.com') {
    if (u.pathname === '/v3/banks/NG') return reply([{ code: '999992', name: 'OPay' }, { code: '50211', name: 'Kuda Bank' }]);
    if (u.pathname === '/v3/subaccounts') return reply({ id: 9530, subaccount_id: 'RS_1' });
    if (u.pathname === '/v3/payments') return reply({ link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc' });
    if (u.pathname === '/v3/transactions/verify_by_reference') return reply({ status: gw.flutterwave ? 'successful' : 'pending', amount: gw.flutterwave || 0, currency: 'NGN' });
  }
  return new Response('{}', { status: 404 });
}
const gw = { monnify: 0, flutterwave: 0 }; // what the fake Monnify and Flutterwave say was paid (₦), 0: not paid
let paidKobo = 0;
const env = (k) => ENV[k];
const post = async (body, who, hook, headers = {}) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const req = new Request('https://x.supabase.co/functions/v1/money' + (hook ? '?hook=' + hook : ''), {
    method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: 'Bearer ' + who } : {}), ...headers },
  });
  const r = await handle(req, sql, { env, fetch: fakeFetch });
  return { status: r.status, ...(await r.json()) };
};
let fails = 0;
const check = (name, ok, got) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got))); if (!ok) fails++; };

// set up a shop, an order, and switch both on
await sql`insert into auth.users values (${SHOP}, 'edge-shop@example.com'), (${CUST}, 'edge-cust@example.com'), (${ADMIN}, 'edge-admin@example.com') on conflict do nothing`;
await sql`insert into admins values (${ADMIN}) on conflict do nothing`;
await sql`delete from shops where slug = 'edgeshop'`;
const [shop] = await sql`insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location, status, pickup_address)
  values (${SHOP}, 'Edge Shoes', 'edgeshop', 'OPay', '0123456780', 'EDGE SHOES', '08031112222', 'Shoes and bags', 'Yaba', 'active', '5 Herbert Macaulay Way, Yaba, Lagos') returning id`;
const [prod] = await sql`insert into products (shop_id, name, price, stock, photo_path) values (${shop.id}, 'Sneakers', 15000, 5, 'x/s.jpg') returning id`;
const tok = await sql.begin(async (tx) => {
  await tx`select set_config('request.jwt.claim.sub', ${CUST}, true)`;
  await tx`set local role authenticated`;
  return (await tx`select place_order('edgeshop', ${sql.json({ name: 'Bola', phone: '08035556666', mode: 'delivery', address: '3 Admiralty Way, Lekki Phase 1', area: 'Lekki' })},
    ${sql.json([{ product_id: prod.id, qty: 1 }])})->>'token' as t`)[0].t;
});
const [ord] = await sql`select id from orders where public_token = ${tok}`;
await sql.begin(async (tx) => { await tx`select set_config('request.jwt.claim.sub', ${ADMIN}, true)`; await tx`select admin_save_settings('{"online_pay_on":true,"delivery_on":true,"delivery_margin":200}')`; });

let r = await post({ action: 'quote', order: ord.id }, 'cust');
check('a customer cannot get courier prices', /not found/i.test(r.error || ''), r);
r = await post({ action: 'quote', order: ord.id }, 'shop');
check('only door-to-door couriers are offered (no centre pickup, no drop-off at the courier)', !r.list?.some((q) => q.service_code === 'gig_terminal' || q.courier_id === 'abc'), r.list);
check('the shop gets prices, cheapest first, margin added, rounded', r.list?.length === 2 && r.list[0].courier_id === 'kwik' && r.list[0].price === 2250 && r.list[1].price === 3350 && r.list[0].cheapest && r.list[0].fastest, r);
check('what ShopDesk pays and the booking token stay on the server', !('cost' in r.list[0]) && !('token' in r.list[0]), r.list?.[0]);
check('a bad eta is dropped', r.list?.[0].eta === null && r.list?.[1].eta === '2030-01-03T12:00:00.000Z', r.list);
const [{ pickup_code }] = await sql`select pickup_code from shops where id = ${shop.id}`;
check('the pickup address code is kept', Number(pickup_code) === 111, pickup_code);
const rates = calls.find((c) => c.url.endsWith('/fetch_rates'));
check('the rates request names the category and the parcel', rates.body.category_id === 98246239 && rates.body.reciever_address_code === 222 && rates.body.package_items[0].quantity === '1', rates.body);
const validated = calls.filter((c) => c.url.endsWith('/address/validate')).map((c) => c.body.address);
check('the area is not added twice', validated.includes('3 Admiralty Way, Lekki Phase 1'), validated);

r = await post({ action: 'pick', order: ord.id, courier_id: 'kwik', service_code: 'kwik_bike' }, 'shop');
check('picking sets the fee', r.price === 2250, r);

r = await post({ action: 'pay', token: tok }, 'cust');
check('with a test key, only a test shop can be paid online', /isn.t on yet/.test(r.error || ''), r);
await sql.begin(async (tx) => { await tx`select set_config('request.jwt.claim.sub', ${ADMIN}, true)`; await tx`select admin_set_pay_test(${shop.id}, true)`; });
r = await post({ action: 'pay', token: tok }, 'shop');
check('only the customer can pay', /Sign in with the account/.test(r.error || ''), r);
r = await post({ action: 'pay', token: tok }, 'cust');
const testInit = calls.filter((c) => c.url.endsWith('/transaction/initialize')).pop()?.body;
check('with a test key, the whole payment goes to ShopDesk (no split)', r.url && testInit.amount === 1766500 && !testInit.subaccount && !testInit.transaction_charge && !calls.some((c) => c.url.includes('/subaccount')), testInit);
const payTok = (await sql`select pay_token from orders where public_token = ${tok}::uuid`)[0].pay_token;
r = await post({ action: 'paylink', pay: payTok }, null);
let linkInit = calls.filter((c) => c.url.endsWith('/transaction/initialize')).pop()?.body;
check('someone else pays with the pay link without signing in or typing an email, and comes back to the pay link page',
  r.url && /^paid\d+@shopdesk\.com\.ng$/.test(linkInit.email) && linkInit.amount === 1766500 && linkInit.callback_url.endsWith('/pay/' + payTok), linkInit);
r = await post({ action: 'paylink', pay: payTok }, 'admin');
linkInit = calls.filter((c) => c.url.endsWith('/transaction/initialize')).pop()?.body;
check('a signed-in payer gets the Paystack receipt at their account email', r.url && linkInit.email === 'edge-admin@example.com', linkInit);
r = await post({ action: 'paylink', pay: crypto.randomUUID() }, null);
check('a wrong pay link is refused', /pay link isn.t right/.test(r.error || ''), r);
ENV.PAYSTACK_SECRET_KEY = 'sk_live_abc';
r = await post({ action: 'pay', token: tok }, 'cust');
ENV.PAYSTACK_SECRET_KEY = 'sk_test_abc';
const init = calls.filter((c) => c.url.endsWith('/transaction/initialize')).pop()?.body;
check('paying returns the Paystack page', r.url === 'https://checkout.paystack.com/abc' && /^SD/.test(r.reference), r);
// 17,250 due: the customer pays ShopDesk's ₦50 and Paystack's fee (₦365) on top; ShopDesk's share is delivery plus both,
// and Paystack takes its fee from ShopDesk's share, so the shop gets its 15,000 in full
check('goods to the shop subaccount, delivery and the card fee to ShopDesk', init.subaccount === 'ACCT_shop1' && init.amount === 1766500 && init.transaction_charge === 266500 && init.bearer === 'account', init);
const psFee = Math.min(Math.ceil(init.amount * 0.015) + 10000, 200000);
check('after Paystack takes its fee, ShopDesk still has the delivery fee and its own fee', init.transaction_charge - psFee >= 230000, psFee);
const sub = calls.find((c) => c.url.endsWith('/subaccount'));
check('with the live key, the subaccount uses the shop bank details', sub.body.settlement_bank === '999992' && sub.body.account_number === '0123456780', sub.body);

paidKobo = 1766500;
const ev = JSON.stringify({ event: 'charge.success', data: { reference: r.reference, amount: paidKobo } });
let h = await post(ev, null, 'paystack', { 'x-paystack-signature': 'nope' });
check('a webhook with a bad signature is refused', h.status === 401, h);
const sig = crypto.createHmac('sha512', ENV.PAYSTACK_SECRET_KEY).update(ev).digest('hex');
h = await post(ev, null, 'paystack', { 'x-paystack-signature': sig });
let [o] = await sql`select status, amount_paid from orders where id = ${ord.id}`;
check('the Paystack webhook marks the order paid with what was due, not the card fee', h.ok && o.status === 'paid' && o.amount_paid === 17250, o);
r = await post({ action: 'check', reference: init.reference }, null);
check('checking again says paid', r.paid === true, r);

r = await post({ action: 'book', order: ord.id }, 'shop');
check('booking needs every item packed', /packed/.test(r.error || ''), r);
await sql`update order_items set packed = true where order_id = ${ord.id}`;
labelFails = 1;
r = await post({ action: 'book', order: ord.id }, 'shop');
const labels = calls.filter((c) => c.url.endsWith('/shipping/labels'));
check('an expired booking token is fetched again and the same courier booked', r.courier === 'Kwik' && labels.length === 2 && labels[1].body.courier_id === 'kwik' && labels[1].body.request_token !== labels[0].body.request_token, { r, labels });
[o] = await sql`select o.status, o.rider_name, o.rider_phone, sh.sb_order, sh.cost, sh.price from orders o join shipments sh on sh.order_id = o.id where o.id = ${ord.id}`;
check('the order goes out with the courier', o.status === 'out' && o.rider_name === 'Kwik' && o.sb_order === 'SB-777' && o.cost === 1900 && o.price === 2250, o);

await sql`update shipments set updated_at = now() - interval '5 minutes' where order_id = ${ord.id}`;
r = await post({ action: 'track', token: tok }, null);
check('tracking asks the courier service and saves the rider', r.shipment?.status === 'in_transit' && r.shipment.rider?.name === 'Musa' && r.shipment.tracking_code === 'KW123' && r.shipment.steps?.length === 1, r);
const listed = calls.filter((c) => c.url.includes('/labels/list/')).length;
await post({ action: 'track', token: tok }, null);
check('tracking again within a minute does not ask again', calls.filter((c) => c.url.includes('/labels/list/')).length === listed, listed);

const sev = JSON.stringify({ event: 'shipment.status.changed', order_id: 'SB-777', status: 'completed', package_status: [{ status: 'Delivered', datetime: '2030-01-02T15:00:00Z' }] });
h = await post(sev, null, 'shipbubble', { 'x-ship-signature': 'bad' });
check('a Shipbubble webhook with a bad signature is refused', h.status === 401, h);
const ssig = crypto.createHmac('sha512', ENV.SHIPBUBBLE_API_KEY).update(sev).digest('hex');
h = await post(sev, null, 'shipbubble', { 'x-ship-signature': ssig });
[o] = await sql`select status, received_by from orders where id = ${ord.id}`;
check('the delivered webhook marks the order delivered', h.ok && o.status === 'delivered' && o.received_by === 'shop', o);

const banks = { paystack: (path) => fakeFetch('https://api.paystack.co' + path).then((x) => x.json()).then((j) => j.data) };
const codes = await Promise.all(['Access Bank', 'GTBank', 'UBA', 'First Bank', 'Other bank'].map((b) => bankCode(banks, b)));
check('banks named in the shop form match Paystack (the shortest name wins), and Other bank has none', codes.join() === '044,058,033,011,', codes);

r = await post({ action: 'bank', account_number: '2012345678' }, 'shop');
check('with a test key the account check is off', r.available === false, r);
ENV.PAYSTACK_SECRET_KEY = 'sk_live_abc';
r = await post({ action: 'bank', account_number: '2012345678' }, 'shop');
check('an account number finds its bank and name', r.available && r.matches.length === 1 && r.matches[0].bank === 'Kuda' && r.matches[0].account_name === 'ADA OKAFOR', r);
r = await post({ action: 'bank', account_number: '2012345678', bank: 'GTBank' }, 'shop');
check('the bank the shop picked is checked alone', r.available && r.matches.length === 0, r);
r = await post({ action: 'bank', account_number: '2012345678' }, null);
check('only signed-in people can check accounts', /Sign in/.test(r.error || ''), r);
check('the bank code check works (044 + 012345678 gives 4, so 0123456784 fits Access Bank)', nubanOk('044', '0123456784') && !nubanOk('044', '0123456781'), null);
check('phone-number banks are always tried, other banks only when the number fits', likelyBanks('0123456784').includes('Access Bank') && !likelyBanks('0123456781').includes('Access Bank') && likelyBanks('0123456784').slice(0, 4).join() === 'OPay,PalmPay,Moniepoint,Kuda', likelyBanks('0123456784'));

r = await post({ action: 'status' }, 'shop');
check('only Admin sees the keys status', r.error === 'Not allowed.', r);
r = await post({ action: 'status' }, 'admin');
check('Admin sees live or test mode and the wallet', r.paystack?.mode === 'live' && r.courier?.mode === 'test' && r.courier.balance === 25001, r);

ENV.PAYSTACK_SECRET_KEY = '';
r = await post({ action: 'bank', account_number: '2012345678' }, 'shop');
check('without a Paystack key the check is simply off', r.available === false, r);
ENV.SHIPBUBBLE_API_KEY = '';
r = await post({ action: 'quote', order: ord.id }, 'shop');
check('a database check message comes through as it is', /locked once paid/.test(r.error || ''), r);
r = await post({ action: 'nope' }, 'shop');
check('an unknown action is refused', r.status === 400, r);

// ---------- Monnify and Flutterwave, beside Paystack ----------
const asAdmin = (p) => sql.begin(async (tx) => { await tx`select set_config('request.jwt.claim.sub', ${ADMIN}, true)`; await tx`select admin_save_settings(${sql.json(p)})`; });
const newOrder = () => sql.begin(async (tx) => {
  await tx`select set_config('request.jwt.claim.sub', ${CUST}, true)`;
  await tx`set local role authenticated`;
  return (await tx`select place_order('edgeshop', ${sql.json({ name: 'Bola', phone: '08035556666', mode: 'pickup' })}, ${sql.json([{ product_id: prod.id, qty: 1 }])})->>'token' as t`)[0].t;
});
await sql`update products set stock = 20 where id = ${prod.id}`;
Object.assign(ENV, { PAYSTACK_SECRET_KEY: 'sk_live_abc', MONNIFY_API_KEY: 'MK_PROD_abc', MONNIFY_SECRET_KEY: 'mn-secret', MONNIFY_CONTRACT_CODE: '7059707855',
  FLW_SECRET_KEY: 'FLWSECK-abc-X', FLW_WEBHOOK_HASH: 'hush' });
await sql`update shops set pay_test = false where id = ${shop.id}`;
await asAdmin({ online_pay_on: true });
const t2 = await newOrder();
r = await post({ action: 'pay', token: t2, via: 'monnify' }, 'cust');
check('a gateway Admin hasn’t switched on can’t be used', /Monnify isn.t on/.test(r.error || ''), r);
await asAdmin({ pay_gateways: ['paystack', 'monnify', 'flutterwave'] });
r = await post({ action: 'pay', token: t2, via: 'monnify' }, 'cust');
const mSub = calls.filter((c) => c.url.endsWith('/api/v1/sub-accounts')).pop()?.body;
const mInit = calls.filter((c) => c.url.endsWith('/init-transaction')).pop()?.body;
check('Monnify: the shop gets a payout account for its own bank account, and exactly its share is split to it',
  r.url && mSub?.[0].accountNumber === '0123456780' && mSub[0].bankCode === '999992' && mSub[0].email === 'edge-shop@example.com'
  && mInit.incomeSplitConfig?.[0].subAccountCode === 'MFY_SUB_1' && mInit.incomeSplitConfig[0].splitAmount === 15000 && mInit.incomeSplitConfig[0].feePercentage === 0
  && mInit.amount > 15000 && mInit.contractCode === '7059707855' && mInit.redirectUrl.endsWith('/o/' + t2), { mSub, mInit });
check('Monnify live keys use the live address, signed in with the key and secret', calls.some((c) => c.url === 'https://api.monnify.com/api/v1/auth/login'), null);
const mRef = mInit.paymentReference;
r = await post({ eventType: 'SUCCESSFUL_TRANSACTION', eventData: { paymentReference: mRef, paymentStatus: 'PAID' } }, null, 'monnify');
let row = (await sql`select status, provider from online_payments where reference = ${mRef}`)[0];
check('a Monnify message alone doesn’t mark an order paid: Monnify is asked first', row.status === 'started' && row.provider === 'monnify', row);
gw.monnify = mInit.amount;
r = await post({ eventType: 'SUCCESSFUL_TRANSACTION', eventData: { paymentReference: mRef } }, null, 'monnify');
row = (await sql`select p.status, o.status as ostatus from online_payments p join orders o on o.id = p.order_id where p.reference = ${mRef}`)[0];
check('when Monnify confirms the payment, the order is paid', row.status === 'paid' && row.ostatus === 'paid', row);
r = await post({ action: 'check', reference: mRef }, null);
check('the order page check works for a Monnify payment', r.paid === true, r);
const t3 = await newOrder();
const subsBefore = calls.filter((c) => c.url.endsWith('/api/v1/sub-accounts')).length;
r = await post({ action: 'pay', token: t3, via: 'flutterwave' }, 'cust');
const fSub = calls.filter((c) => c.url.endsWith('/v3/subaccounts')).pop()?.body;
const fInit = calls.filter((c) => c.url.endsWith('/v3/payments')).pop()?.body;
check('Flutterwave: a payout account for the shop bank account, and exactly its share goes to it',
  r.url && fSub?.account_number === '0123456780' && fSub.account_bank === '999992' && fInit.subaccounts?.[0].id === 'RS_1'
  && fInit.subaccounts[0].transaction_charge_type === 'flat_subaccount' && fInit.subaccounts[0].transaction_charge === 15000 && fInit.redirect_url.endsWith('/o/' + t3), { fSub, fInit });
r = await post({ event: 'charge.completed', data: { tx_ref: fInit.tx_ref } }, null, 'flutterwave', { 'verif-hash': 'wrong' });
check('a Flutterwave message without the secret hash is refused', r.status === 401, r);
gw.flutterwave = fInit.amount;
r = await post({ event: 'charge.completed', data: { tx_ref: fInit.tx_ref } }, null, 'flutterwave', { 'verif-hash': 'hush' });
row = (await sql`select status, provider from online_payments where reference = ${fInit.tx_ref}`)[0];
check('when Flutterwave confirms the payment, the order is paid', row.status === 'paid' && row.provider === 'flutterwave', row);
const t4 = await newOrder();
r = await post({ action: 'pay', token: t4, via: 'monnify' }, 'cust');
check('the shop’s Monnify payout account is made once, not for every payment', calls.filter((c) => c.url.endsWith('/api/v1/sub-accounts')).length === subsBefore, null);
ENV.MONNIFY_API_KEY = 'MK_TEST_abc';
const t5 = await newOrder();
r = await post({ action: 'pay', token: t5, via: 'monnify' }, 'cust');
check('with Monnify test keys, only test shops can pay with Monnify', /isn.t on yet/.test(r.error || ''), r);
await sql`update shops set pay_test = true where id = ${shop.id}`;
r = await post({ action: 'pay', token: t5, via: 'monnify' }, 'cust');
const tInit = calls.filter((c) => c.url.endsWith('/init-transaction')).pop();
check('a test shop pays through the Monnify sandbox, with no split', r.url && tInit.url.startsWith('https://sandbox.monnify.com') && !tInit.body.incomeSplitConfig, tInit);
r = await post({ action: 'status' }, 'admin');
check('Admin sees each gateway’s keys: live or test', r.monnify?.mode === 'test' && r.monnify.set && r.flutterwave?.mode === 'live', r);
await sql`update shops set pay_test = false where id = ${shop.id}`;
await asAdmin({ pay_gateways: ['paystack'] });

await sql.begin(async (tx) => { await tx`select set_config('request.jwt.claim.sub', ${ADMIN}, true)`; await tx`select admin_save_settings('{"online_pay_on":false,"delivery_on":false}')`; });
await sql.end();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
