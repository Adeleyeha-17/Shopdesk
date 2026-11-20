\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Saved delivery addresses, Buy again (what a customer bought before, as the shop sells it today), and when an order was delivered.
reset role;
insert into auth.users values ('ce000000-0000-4000-8000-000000000001', 'gadgets@example.com'), ('ce000000-0000-4000-8000-000000000002', 'bola@example.com'),
  ('ce000000-0000-4000-8000-000000000003', 'chidi@example.com') on conflict do nothing;
insert into shops (owner_id, name, slug, sells, location, status, reviewed_at, bank, account_number, account_name, delivery_paid_by) values
  ('ce000000-0000-4000-8000-000000000001', 'Gadget Corner', 'gadgetcorner', 'Phone accessories', 'Ikeja, Lagos', 'active', now(), 'OPay', '0123456785', 'GADGET C', 'vendor');
select id || '/' as pic from shops where slug = 'gadgetcorner' \gset
set role authenticated; set request.jwt.claim.sub = 'ce000000-0000-4000-8000-000000000001';
select save_product(null, jsonb_build_object('name', 'Power bank', 'photo_path', :'pic' || 'pb.jpg', 'price', 15000, 'stock', 9)) as pb \gset
select save_product(null, jsonb_build_object('name', 'Phone case', 'photo_path', :'pic' || 'case.jpg', 'option_label', 'Model',
  'options', jsonb_build_array(jsonb_build_object('name', 'iPhone 13', 'price', 4000, 'stock', 5), jsonb_build_object('name', 'iPhone 15', 'price', 4500, 'stock', 5)))) as cs \gset
select save_product(null, jsonb_build_object('name', 'Charger', 'photo_path', :'pic' || 'ch.jpg', 'price', 6000, 'stock', 4)) as ch \gset
reset role; select id as i15 from product_options where name = 'iPhone 15' \gset

\echo A1 a delivery order saves its address; the same address again (any letter case) is not saved twice and comes first (expect 2 addresses, the newest first):
set role authenticated; set request.jwt.claim.sub = 'ce000000-0000-4000-8000-000000000002';
select (place_order('gadgetcorner', '{"name":"Bola","phone":"08030000001","mode":"delivery","address":"12 Allen Avenue, Ikeja","area":"Ikeja"}',
  jsonb_build_array(jsonb_build_object('product_id', :'pb', 'qty', 1))))->>'token' as t1 \gset
select place_order('gadgetcorner', '{"name":"Bola","phone":"08030000001","mode":"delivery","address":"Plot 4, Admiralty Way, Lekki","area":"Lekki"}',
  jsonb_build_array(jsonb_build_object('product_id', :'cs', 'option_id', :'i15', 'qty', 2))) is not null;
select place_order('gadgetcorner', '{"name":"Bola","phone":"08030000001","mode":"delivery","address":"12 ALLEN AVENUE, IKEJA"}',
  jsonb_build_array(jsonb_build_object('product_id', :'ch', 'qty', 1))) is not null;
select address || ' | ' || area from customer_addresses order by used_at desc;

\echo A2 a pick-up order or a map pin saves no address (expect still 2):
reset role; update orders set status = 'paid', amount_paid = items_total, paid_at = now() where customer_id = 'ce000000-0000-4000-8000-000000000002';
set role authenticated; set request.jwt.claim.sub = 'ce000000-0000-4000-8000-000000000002';
select place_order('gadgetcorner', '{"name":"Bola","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'ch', 'qty', 1))) is not null;
select place_order('gadgetcorner', '{"name":"Bola","mode":"delivery","lat":6.6,"lng":3.35}', jsonb_build_array(jsonb_build_object('product_id', :'pb', 'qty', 1))) is not null;
select count(*) from customer_addresses;

\echo A3 a customer sees, adds and removes only their own addresses (expect 0 for Chidi, then an error, then 3 for Bola after adding, then 2):
set request.jwt.claim.sub = 'ce000000-0000-4000-8000-000000000003';
select count(*) from customer_addresses;
insert into customer_addresses (user_id, address) values ('ce000000-0000-4000-8000-000000000002', 'Not my address');
set request.jwt.claim.sub = 'ce000000-0000-4000-8000-000000000002';
insert into customer_addresses (user_id, address, area) values (auth.uid(), 'Office: 5 Broad Street, Lagos Island', 'Lagos Island');
select count(*) from customer_addresses;
delete from customer_addresses where address like 'Office%';
select count(*) from customer_addresses;

\echo A4 only the 10 used most recently are kept (expect 10, and the oldest gone):
reset role;
insert into customer_addresses (user_id, address, used_at) select 'ce000000-0000-4000-8000-000000000003', 'House ' || n || ', Yaba', now() - make_interval(days => 20 - n) from generate_series(1, 12) n;
select count(*), min(address) filter (where address = 'House 1, Yaba') is null and min(address) filter (where address = 'House 2, Yaba') is null from customer_addresses where user_id = 'ce000000-0000-4000-8000-000000000003';

\echo A5 Buy again shows what Bola bought, at the price and stock of today, newest first, the case with its model (expect the shop, open, then 3 items):
set role authenticated; set request.jwt.claim.sub = 'ce000000-0000-4000-8000-000000000001';
select save_product(:'pb', '{"name":"Power bank","price":16000,"sale_price":14500}') is not null;
set request.jwt.claim.sub = 'ce000000-0000-4000-8000-000000000002';
select x->>'shop', x->>'open', jsonb_array_length(x->'items') from jsonb_array_elements(my_past_items()) x;
select i->>'name' || ' | ' || coalesce(i->>'option', '-') || ' | ' || (i->>'price') || ' | ' || coalesce(i->>'sale_price', '-') || ' | ' || (i->>'stock')
from jsonb_array_elements(my_past_items()) x, jsonb_array_elements(x->'items') i order by i->>'name';

\echo A6 a product the shop stopped selling drops out, cancelled orders do not count, and a closed shop shows as not open (expect Phone case, then false):
reset role;
update products set active = false where id = :'ch';
update orders set status = 'cancelled' where id in (select order_id from order_items where product_id = :'pb');
set role authenticated; set request.jwt.claim.sub = 'ce000000-0000-4000-8000-000000000002';
select string_agg(i->>'name', ', ' order by i->>'name') from jsonb_array_elements(my_past_items()) x, jsonb_array_elements(x->'items') i;
reset role; update shops set status = 'suspended' where slug = 'gadgetcorner';
set role authenticated; set request.jwt.claim.sub = 'ce000000-0000-4000-8000-000000000002';
select x->>'open' from jsonb_array_elements(my_past_items()) x;
reset role; update shops set status = 'active' where slug = 'gadgetcorner';

\echo A7 My orders says when an order was delivered (expect true once delivered):
reset role;
update orders set status = 'delivered', done_at = now() where id = (select max(id) from orders where customer_id = 'ce000000-0000-4000-8000-000000000002');
set role authenticated; set request.jwt.claim.sub = 'ce000000-0000-4000-8000-000000000002';
select (my_orders()->0->>'done_at') is not null;

\echo A8 visitors cannot ask what someone bought, nor see anyone else addresses (expect a permission error, then 0):
set role anon; reset request.jwt.claim.sub;
select my_past_items();
select count(*) from customer_addresses;
reset role;
