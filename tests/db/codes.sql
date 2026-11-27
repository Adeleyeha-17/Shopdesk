\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- The note for the shop, discount codes, the sale banner, pay links and receipt emails.
reset role;
insert into auth.users values ('c0de0000-0000-4000-8000-000000000001', 'kemi@example.com'), ('c0de0000-0000-4000-8000-000000000002', 'tolu@example.com'),
  ('c0de0000-0000-4000-8000-000000000003', 'femi@example.com'), ('c0de0000-0000-4000-8000-000000000004', 'other@example.com') on conflict do nothing;
insert into shops (owner_id, name, slug, sells, location, status, reviewed_at, bank, account_number, account_name, delivery_paid_by) values
  ('c0de0000-0000-4000-8000-000000000001', 'Kemi Shoes', 'kemishoes', 'Shoes', 'Yaba, Lagos', 'active', now(), 'OPay', '0123456785', 'KEMI S', 'vendor');
select id || '/' as pic from shops where slug = 'kemishoes' \gset
set role authenticated; set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000001';
select save_product(null, jsonb_build_object('name', 'Sandals', 'photo_path', :'pic' || 's.jpg', 'price', 10000, 'stock', 50)) as sd \gset

\echo C1 a shop makes codes; bad ones get a plain reason (expect 2 ids, then 5 errors):
select save_coupon(null, ' ten off ', 'percent', 10, 0, null, null, true) is not null;
select save_coupon(null, 'FLAT2K', 'amount', 2000, 15000, null, 2, true) is not null;
select save_coupon(null, 'TENOFF', 'percent', 20, 0, null, null, true);
select save_coupon(null, 'no', 'percent', 10, 0, null, null, true);
select save_coupon(null, 'HALF', 'percent', 95, 0, null, null, true);
select save_coupon(null, 'OLD', 'percent', 10, 0, current_date - 3, null, true);
set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000002';
select save_coupon(null, 'MINE', 'percent', 10, 0, null, null, true);

\echo C2 only the shop sees its codes (expect 2 for Kemi, 0 for Tolu):
set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000001';
select count(*) from coupons;
set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000002';
select count(*) from coupons;

\echo C3 the storefront says the shop has codes; the code box checks a code (expect true, then 2000 off 20000, then 2 errors):
select (get_storefront('kemishoes')->'shop'->>'has_coupons');
select check_coupon('kemishoes', 'tenoff', 20000)->>'discount', check_coupon('kemishoes', 'FLAT2K', 20000)->>'discount';
select check_coupon('kemishoes', 'FLAT2K', 10000);
select check_coupon('kemishoes', 'NOPE', 20000);

\echo C4 an order with a code and a note: the total is after the discount, the shop is told, a receipt email is queued (expect 18000 | 2000 | TENOFF | note):
select (place_order('kemishoes', '{"name":"Tolu","phone":"08030000002","mode":"pickup","coupon":"tenoff","note":"  Please   wrap it as a gift  "}',
  jsonb_build_array(jsonb_build_object('product_id', :'sd', 'qty', 2))))->>'token' as t1 \gset
reset role;
select items_total || ' | ' || discount || ' | ' || coupon_code || ' | ' || note from orders where public_token = :'t1';
select body from notifications where kind = 'new_order' order by id desc limit 1;
select kind from receipt_emails r join orders o on o.id = r.order_id where o.public_token = :'t1';

\echo C5 each customer uses a code once; a cancelled order gives the use back (expect an error, then an order after cancelling):
set role authenticated; set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000002';
select place_order('kemishoes', '{"name":"Tolu","mode":"pickup","coupon":"TENOFF"}', jsonb_build_array(jsonb_build_object('product_id', :'sd', 'qty', 1)));
reset role; update orders set status = 'cancelled', cancel_reason = 'customer', done_at = now() where public_token = :'t1';
set role authenticated; set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000002';
select (place_order('kemishoes', '{"name":"Tolu","mode":"pickup","coupon":"TENOFF"}', jsonb_build_array(jsonb_build_object('product_id', :'sd', 'qty', 1))))->>'items_total';

\echo C6 a code with 2 uses is used up after 2 orders; the minimum order counts the real prices (expect error, 18000, 18000, used up):
select place_order('kemishoes', '{"name":"Tolu","mode":"pickup","coupon":"FLAT2K"}', jsonb_build_array(jsonb_build_object('product_id', :'sd', 'qty', 1)));
select (place_order('kemishoes', '{"name":"Tolu","mode":"pickup","coupon":"FLAT2K"}', jsonb_build_array(jsonb_build_object('product_id', :'sd', 'qty', 2))))->>'items_total';
set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000003';
select (place_order('kemishoes', '{"name":"Femi","mode":"pickup","coupon":"FLAT2K"}', jsonb_build_array(jsonb_build_object('product_id', :'sd', 'qty', 2))))->>'items_total';
set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000004';
select place_order('kemishoes', '{"name":"Ade","mode":"pickup","coupon":"FLAT2K"}', jsonb_build_array(jsonb_build_object('product_id', :'sd', 'qty', 2)));

\echo C7 the shop sees how each code did; a switched-off or ended code stops working (expect TENOFF 1 uses, FLAT2K 2 uses 4000 off, then 2 errors):
set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000001';
select string_agg((c->>'code') || ' ' || (c->>'uses') || ' uses ' || (c->>'off') || ' off', ', ' order by c->>'code') from jsonb_array_elements(shop_coupons()) c;
select save_coupon((select id from coupons where code = 'TENOFF'), 'TENOFF', 'percent', 10, 0, null, null, false) is not null;
reset role; update coupons set ends_on = current_date - 1 where code = 'FLAT2K'; update coupons set max_uses = null where code = 'FLAT2K';
set role authenticated; set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000004';
select check_coupon('kemishoes', 'TENOFF', 20000);
select check_coupon('kemishoes', 'FLAT2K', 20000);

\echo C8 a ₦ off code always leaves ₦100 to pay (expect 100):
reset role; insert into coupons (shop_id, code, kind, value) select id, 'BIG', 'amount', 50000 from shops where slug = 'kemishoes';
set role authenticated; set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000004';
select (place_order('kemishoes', '{"name":"Ade","mode":"pickup","coupon":"BIG"}', jsonb_build_array(jsonb_build_object('product_id', :'sd', 'qty', 1))))->>'items_total';

\echo C9 the sale banner shows until its date (expect the banner, then nothing once it has passed):
set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000001';
update shops set banner = 'Sale ends Sunday', banner_until = current_date + 2 where slug = 'kemishoes';
select get_storefront('kemishoes')->'shop'->>'banner';
update shops set banner_until = current_date - 1 where slug = 'kemishoes';
select coalesce(get_storefront('kemishoes')->'shop'->>'banner', 'none');

\echo C10 the pay link is only for the customer, and shows no address or phone (expect a link for Femi, none for others, no address):
reset role; select public_token as tf from orders where customer_name = 'Femi' \gset
set role authenticated; set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000003';
select (order_extras(:'tf')->>'pay_token') is not null;
set request.jwt.claim.sub = 'c0de0000-0000-4000-8000-000000000004';
select (order_extras(:'tf')->>'pay_token') is null;
reset role; select pay_token as pf from orders where customer_name = 'Femi' \gset
set role anon;
select get_pay_link(:'pf')->>'to_pay', get_pay_link(:'pf')->>'code' is not null, get_pay_link(:'pf')::text ~ 'Femi|0803|address';

\echo C11 someone else pays online with the link, never asked for an email: a signed-in payer gets the receipt at their account email, anyone else at a ShopDesk address, never the customer (expect ShopDesk address, other@example.com, an error):
reset role; update shops set pay_test = true where slug = 'kemishoes';
select (money_start_link_payment(:'pf', 'SDTEST-C11A', null)->>'email') ~ '^paid[0-9]+@shopdesk\.com\.ng$';
select money_start_link_payment(:'pf', 'SDTEST-C11B', 'c0de0000-0000-4000-8000-000000000004')->>'email';
select money_start_link_payment(gen_random_uuid(), 'SDTEST-C11C', null);

\echo C12 paying in full queues the "payment confirmed" email; the sender gets the order with the customer email (expect paid, then placed and paid for Femi):
select money_paid('SDTEST-C11B', 1800000 + 100000)->>'order_id' is not null;
select string_agg(kind, ' ' order by r.id) from receipt_emails r join orders o on o.id = r.order_id where o.customer_name = 'Femi';
select string_agg((x->>'kind') || ' ' || (x->>'email') || ' ' || (x->>'code' is not null)::text, ', ') from jsonb_array_elements(receipt_claim(50)) x where x->>'name' = 'Femi';
select count(*) from receipt_emails where sent_at is null;

\echo C13 the push function helpers stay private (expect 3 errors):
set role authenticated;
select receipt_claim(5);
select money_start_link_payment(:'pf', 'SDTEST-C13', null);
select coupon_for((select id from shops limit 1), 'X', 1, null);
reset role;
