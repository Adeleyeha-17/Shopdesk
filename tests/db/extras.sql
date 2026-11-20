\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Product descriptions, receipts for paid orders, and payment reminders for customers.
reset role;
insert into auth.users values ('cd000000-0000-4000-8000-000000000001', 'shoeshop@example.com'), ('cd000000-0000-4000-8000-000000000002', 'tolu@example.com'),
  ('cd000000-0000-4000-8000-000000000003', 'kemi@example.com') on conflict do nothing;
insert into shops (owner_id, name, slug, sells, location, status, reviewed_at, bank, account_number, account_name, delivery_paid_by) values
  ('cd000000-0000-4000-8000-000000000001', 'Shoe Hub', 'shoehub', 'Shoes', 'Ikeja, Lagos', 'active', now(), 'OPay', '0123456784', 'SHOE H', 'customer');
select id || '/' as pic from shops where slug = 'shoehub' \gset
-- orders left by the other test files are counted as already reminded, so only this file's orders are reminded here
update orders set reminders = 2;

\echo D1 a shop adds a product with a description; customers see it on the shop page (expect the description):
set role authenticated; set request.jwt.claim.sub = 'cd000000-0000-4000-8000-000000000001';
select save_product(null, jsonb_build_object('name', 'Leather loafers', 'description', '  Real leather, made in Aba. Runs one size small.  ', 'photo_path', :'pic' || 'loafers.jpg', 'price', 25000, 'stock', 5)) as loafers \gset
select save_product(null, '{"name":"Slides","options":[{"name":"42","price":8000,"stock":3},{"name":"43","price":8000,"stock":2}]}'::jsonb || jsonb_build_object('photo_path', :'pic' || 'slides.jpg')) as slides \gset
select p->>'name' || '|' || (p->>'description') from jsonb_array_elements(get_storefront('shoehub')->'products') p order by p->>'name';

\echo D2 an older product gets a description later; leaving it out keeps it, an empty one removes it, and a long one is refused (expect the new text twice, then empty, then an error):
select save_product(:'slides', '{"name":"Slides","description":"Soft rubber, good for the beach.","options":[]}'::jsonb || jsonb_build_object('options', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price)) from product_options where product_id = :'slides'))) is not null;
select description from products where id = :'slides';
select save_product(:'slides', jsonb_build_object('name', 'Slides', 'options', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price)) from product_options where product_id = :'slides'))) is not null;
select description from products where id = :'slides';
select save_product(:'loafers', '{"name":"Leather loafers","description":"","price":25000}') is not null;
select '[' || description || ']' from products where id = :'loafers';
select save_product(:'loafers', jsonb_build_object('name', 'Leather loafers', 'price', 25000, 'description', repeat('a', 301)));

\echo D3 no receipt until the shop has the money; then it shows the customer, the item with its size, the shop location, and how it was paid (expect null, then the receipt):
reset role; select id as size43 from product_options where product_id = :'slides' and name = '43' \gset
set role authenticated; set request.jwt.claim.sub = 'cd000000-0000-4000-8000-000000000002';
select (place_order('shoehub', '{"name":"Tolu Ade","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'slides', 'qty', 2, 'option_id', :'size43'))))->>'token' as t1 \gset
select get_order_public(:'t1')->>'receipt' is null;
reset role; select id as o1 from orders where public_token = :'t1' \gset
set role authenticated; set request.jwt.claim.sub = 'cd000000-0000-4000-8000-000000000001';
select confirm_payment(:o1) is not null;
set request.jwt.claim.sub = 'cd000000-0000-4000-8000-000000000002';
select x->'receipt'->>'customer', x->'receipt'->>'online', x->'receipt'->'refund', x->'shop'->>'location', x->'items'->0->>'name', x->'items'->0->>'qty', x->>'amount_paid'
from (select get_order_public(:'t1') as x) z;

\echo D4 reminders: 3 hours after ordering, in the day only, once (expect said paid, then 0 at night, 1 in the day, the alert, then 0):
select (place_order('shoehub', '{"name":"Tolu Ade","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'loafers', 'qty', 1))))->>'token' as t2 \gset
set request.jwt.claim.sub = 'cd000000-0000-4000-8000-000000000003';
select (place_order('shoehub', '{"name":"Kemi","mode":"delivery","address":"5 Allen Avenue, Ikeja"}', jsonb_build_array(jsonb_build_object('product_id', :'loafers', 'qty', 1))))->>'token' as t3 \gset
select (place_order('shoehub', '{"name":"Kemi","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'loafers', 'qty', 1))))->>'token' as t4 \gset
select 'said paid' from (select customer_says_paid(:'t4')) x;
reset role;
update orders set created_at = now() - interval '4 hours' where public_token in (:'t2', :'t3', :'t4');
select remind_buyers(23);
select remind_buyers(10);
select kind || '|' || title || '|' || body || '|' || (url = '/o/' || :'t2') from notifications where user_id = 'cd000000-0000-4000-8000-000000000002' and kind = 'pay_reminder';
select remind_buyers(10);

\echo D5 the order waiting for its delivery fee and the one the customer says is paid get nothing; once the fee is set it is reminded (expect 0 for Kemi, then 1):
select count(*) from notifications where user_id = 'cd000000-0000-4000-8000-000000000003' and kind = 'pay_reminder';
update orders set delivery_fee = 1500 where public_token = :'t3';
select remind_buyers(10);

\echo D6 the last reminder, 36 hours in, says when it cancels; nothing after that (expect 1, the cancel line, reminders 2, then 0):
update orders set created_at = now() - interval '37 hours' where public_token = :'t2';
select remind_buyers(14);
select regexp_replace(body, 'today|tomorrow', '<when>') from notifications where user_id = 'cd000000-0000-4000-8000-000000000002' and kind = 'pay_reminder' order by id desc limit 1;
select reminders, reminded_at is not null from orders where public_token = :'t2';
select remind_buyers(15);

\echo D7 an order first seen after 36 hours gets only the last reminder (expect 1 and reminders 2):
update orders set created_at = now() - interval '40 hours', reminders = 0 where public_token = :'t3';
select remind_buyers(9);
select reminders from orders where public_token = :'t3';

\echo D8 the shop sees that the customer was reminded on its order (expect true):
set role authenticated; set request.jwt.claim.sub = 'cd000000-0000-4000-8000-000000000001';
select reminded_at is not null from orders where public_token = :'t2';

\echo D9 nobody but the database can send reminders (expect 2 permission errors):
select remind_buyers(10);
set role anon; reset request.jwt.claim.sub; select remind_buyers(10);
reset role;
