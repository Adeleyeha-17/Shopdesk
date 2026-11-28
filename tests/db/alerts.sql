\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Alerts that bring people back: carts kept on the account and reminded, the Monday summary, slower sales and the quick sale.
reset role;
insert into auth.users values ('a1e70000-0000-4000-8000-000000000001', 'tolu@example.com'), ('a1e70000-0000-4000-8000-000000000002', 'femi@example.com'),
  ('a1e70000-0000-4000-8000-000000000003', 'ada@example.com') on conflict do nothing;
insert into shops (owner_id, name, slug, sells, location, status, reviewed_at, bank, account_number, account_name, delivery_paid_by) values
  ('a1e70000-0000-4000-8000-000000000001', 'Tolu Kicks', 'tolukicks', 'Shoes', 'Yaba, Lagos', 'active', now(), 'OPay', '0123456784', 'TOLU K', 'vendor');
select id || '/' as pic from shops where slug = 'tolukicks' \gset
set role authenticated; set request.jwt.claim.sub = 'a1e70000-0000-4000-8000-000000000001';
select save_product(null, jsonb_build_object('name', 'Air runner', 'photo_path', :'pic' || 'a.jpg', 'price', 30000, 'stock', 5)) as shoe \gset
select save_product(null, jsonb_build_object('name', 'Sock pack', 'photo_path', :'pic' || 's.jpg', 'price', 2000, 'stock', 50)) as sock \gset

\echo A1 signed out, nothing is kept; signed in, the cart is kept and comes back (expect 0, then 3 and the items):
set request.jwt.claim.sub = '';
select save_cart('tolukicks', jsonb_build_object(:'shoe', 1));
reset role; select count(*) from saved_carts;
set role authenticated; set request.jwt.claim.sub = 'a1e70000-0000-4000-8000-000000000002';
select save_cart('tolukicks', jsonb_build_object(:'shoe', 1, :'sock', 2, 'not-a-product', 5));
reset role; select count from saved_carts;
set role authenticated;
select my_cart('tolukicks') = jsonb_build_object(:'shoe', 1, :'sock', 2);

\echo A2 nobody reads or changes saved carts directly (expect an error):
select count(*) from saved_carts;

\echo A3 at 10pm no reminders; at noon a cart changed 2 hours ago is too fresh (expect 0, 0):
reset role;
delete from notifications where user_id::text like 'a1e70000%';
update saved_carts set updated_at = now() - interval '2 hours';
select remind_carts(22);
select remind_carts(12);

\echo A4 after 3 hours, one reminder with the cart link; again straight after, nothing (expect 1, the alert, 0):
update saved_carts set updated_at = now() - interval '4 hours';
select remind_carts(12);
select kind || '|' || title || '|' || body || '|' || url from notifications where user_id = 'a1e70000-0000-4000-8000-000000000002';
select remind_carts(12);

\echo A5 a day later, once more; then never again (expect 1, 0):
update saved_carts set updated_at = now() - interval '25 hours';
select remind_carts(12);
update saved_carts set updated_at = now() - interval '50 hours';
select remind_carts(12);

\echo A6 changing the cart starts again; an order since then means no reminder (expect 0 and reminders back to 0):
set role authenticated; set request.jwt.claim.sub = 'a1e70000-0000-4000-8000-000000000002';
select save_cart('tolukicks', jsonb_build_object(:'shoe', 2));
select place_order('tolukicks', '{"name":"Femi","phone":"08031234567","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'sock', 'qty', 1))) is not null \g /dev/null
reset role;
update saved_carts set updated_at = now() - interval '4 hours';
update orders set created_at = now() - interval '1 hour' where customer_id = 'a1e70000-0000-4000-8000-000000000002';
select remind_carts(12);
select reminders from saved_carts;

\echo A6b once they've ordered from the shop, the old cart doesn't come back (expect {}):
set role authenticated; set request.jwt.claim.sub = 'a1e70000-0000-4000-8000-000000000002';
select my_cart('tolukicks');

\echo A7 an emptied cart is forgotten (expect 0):
set role authenticated;
select save_cart('tolukicks', '{}'::jsonb);
reset role; select count(*) from saved_carts;

\echo A8 Monday summary: last week 2 orders for 40000 against 20000 the week before; best seller named; once a week (expect 1, the alert, 0):
delete from orders where shop_id = (select id from shops where slug = 'tolukicks');
select (date_trunc('week', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos') as monday \gset
insert into orders (shop_id, customer_id, customer_name, customer_phone, mode, items_total, delivery_paid_by, status, amount_paid, paid_at)
select s.id, 'a1e70000-0000-4000-8000-000000000002', 'Femi', '08031234567', 'pickup', t, 'vendor', 'paid', t, :'monday'::timestamptz - d
from shops s, (values (30000, interval '2 days'), (10000, interval '3 days'), (20000, interval '10 days')) v(t, d) where s.slug = 'tolukicks';
insert into order_items (order_id, product_id, name, price, qty)
select o.id, :'shoe', 'Air runner', 30000, 1 from orders o where o.items_total = 30000 and o.customer_id::text like 'a1e70000%';
insert into order_items (order_id, product_id, name, price, qty)
select o.id, :'sock', 'Sock pack', 2000, 5 from orders o where o.items_total in (10000, 20000) and o.customer_id::text like 'a1e70000%';
delete from notifications where user_id::text like 'a1e70000%';
select shop_summaries(9, 1);
select kind || '|' || title || '|' || body || '|' || url from notifications where user_id = 'a1e70000-0000-4000-8000-000000000001';
select shop_summaries(10, 1);

\echo A9 not on other days or hours (expect 0, 0):
delete from shop_nudges where shop_id = (select id from shops where slug = 'tolukicks');
select shop_summaries(9, 2);
select shop_summaries(14, 1);

\echo A10 slower sales: 20000 by now last week, 5000 so far; the alert and the Sales card say so; once a week (expect 1, the alert, true, 0):
delete from orders where shop_id = (select id from shops where slug = 'tolukicks');
insert into orders (shop_id, customer_id, customer_name, customer_phone, mode, items_total, delivery_paid_by, status, amount_paid, paid_at)
select s.id, 'a1e70000-0000-4000-8000-000000000002', 'Femi', '08031234567', 'pickup', t, 'vendor', 'paid', t, at
from shops s, (values (20000, :'monday'::timestamptz - interval '7 days' + (now() - :'monday'::timestamptz) / 2), (5000, now() - interval '1 minute')) v(t, at)
where s.slug = 'tolukicks';
delete from notifications where user_id::text like 'a1e70000%';
select shop_summaries(12, 3);
select kind || '|' || title || '|' || body || '|' || url from notifications where user_id = 'a1e70000-0000-4000-8000-000000000001';
set role authenticated; set request.jwt.claim.sub = 'a1e70000-0000-4000-8000-000000000001';
select (sales_pace()->>'so_far') || '|' || (sales_pace()->>'last') || '|' || (sales_pace()->>'sale_on');
reset role;
select shop_summaries(13, 4);

\echo A11 not slow when sales are close to last week (expect 0):
delete from shop_nudges where shop_id = (select id from shops where slug = 'tolukicks');
update orders set items_total = 15000, amount_paid = 15000 where items_total = 5000 and shop_id = (select id from shops where slug = 'tolukicks');
select shop_summaries(12, 3);

\echo A12 quick sale: a 10% code for 3 days and the sale banner; again reuses the code; odd percents and other people refused (expect SAVE10|10|true twice, t, 2 errors):
set role authenticated; set request.jwt.claim.sub = 'a1e70000-0000-4000-8000-000000000001';
select quick_sale(10)->>'id' as q1 \gset
select code || '|' || value || '|' || (ends_on = (now() at time zone 'Africa/Lagos')::date + 3) from coupons where id = :q1;
select quick_sale(10)->>'id' as q2 \gset
select code || '|' || value || '|' || (id = :q1) from coupons where id = :q2;
select banner like '10% off everything with code SAVE10 until %' from shops where slug = 'tolukicks';
select sales_pace()->>'sale_on';
select quick_sale(50);
set request.jwt.claim.sub = 'a1e70000-0000-4000-8000-000000000003';
select quick_sale(10);
