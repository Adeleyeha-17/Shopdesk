\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- The sales report (update 013): area, source and the price before a sale on orders; money out; the monthly goal;
-- plan payments counted as money out. Runs after the other test files.
reset role;
insert into auth.users values ('a2000000-0000-4000-8000-000000000001', 'report@example.com'), ('a2000000-0000-4000-8000-000000000002', 'other@example.com'),
  ('a2100000-0000-4000-8000-000000000001', 'buyer@example.com') on conflict do nothing;
set role authenticated; set request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';
insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location) values (auth.uid(), 'Report Shop', 'reportshop', 'OPay', '0333444555', 'REPORT SHOP', '08000000011', 'Oils', 'Yaba');
set request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000002';
insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location) values (auth.uid(), 'Other Shop', 'reportother', 'OPay', '0333444556', 'OTHER', '08000000012', 'Things', 'Ikeja');
reset role; update shops set status = 'active', paid_until = now() + interval '30 days' where slug in ('reportshop', 'reportother');
select id as rshop from shops where slug = 'reportshop' \gset
select id as oshop from shops where slug = 'reportother' \gset
set role authenticated; set request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';
select save_product(null, jsonb_build_object('name', 'Argan oil', 'photo_path', :'rshop' || '/a.jpg', 'price', 9500, 'sale_price', 8000, 'stock', 10, 'low_at', 2)) as argan \gset
select save_product(null, jsonb_build_object('name', 'Soap', 'photo_path', :'rshop' || '/s.jpg', 'price', 2000, 'stock', 10, 'low_at', 2)) as soap \gset

\echo R1 a delivery order keeps the area, where the customer came from and the price before a sale (expect Lekki Phase 1|instagram, then Argan oil 8000 was 9500 / Soap 2000 was -, then Lekki Phase 1):
set request.jwt.claim.sub = 'a2100000-0000-4000-8000-000000000001';
select place_order('reportshop', '{"name":"Bisi","phone":"0805","mode":"delivery","address":"4 Admiralty Way","area":"Lekki Phase 1","source":"instagram"}',
  jsonb_build_array(jsonb_build_object('product_id', :'argan', 'qty', 2), jsonb_build_object('product_id', :'soap', 'qty', 1)))->>'token' as t1 \gset
reset role; select id as r1 from orders where public_token = :'t1' \gset
select area || '|' || source from orders where id = :r1;
select string_agg(name || ' ' || price || ' was ' || coalesce(was_price::text, '-'), ' / ' order by id) from order_items where order_id = :r1;
select area from customers where user_id = 'a2100000-0000-4000-8000-000000000001';

\echo R2 pick-up has no area, an unknown source counts as direct, and the saved area stays (expect |direct, then Lekki Phase 1):
set role authenticated; set request.jwt.claim.sub = 'a2100000-0000-4000-8000-000000000001';
select place_order('reportshop', '{"name":"Bisi","phone":"0805","mode":"pickup","area":"Yaba","source":"carrier pigeon"}',
  jsonb_build_array(jsonb_build_object('product_id', :'soap', 'qty', 1)))->>'token' as t2 \gset
reset role; select area || '|' || source from orders where public_token = :'t2';
select area from customers where user_id = 'a2100000-0000-4000-8000-000000000001';

\echo R3 money out: a shop adds and reads its own, removes it, and cannot touch another shop (expect 2|47500, then 2 plain errors, then 0, then 1):
set role authenticated; set request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';
insert into money_out (shop_id, amount, kind, note) values (:'rshop', 45000, 'restock', '2 cartons');
insert into money_out (shop_id, amount, kind, spent_on) values (:'rshop', 2500, 'transport', current_date - 3);
select count(*) || '|' || sum(amount) from money_out;
insert into money_out (shop_id, amount, kind) values (:'oshop', 1000, 'other');
insert into money_out (shop_id, amount, kind) values (:'rshop', 0, 'other');
set request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000002';
select count(*) from money_out;
delete from money_out where shop_id = :'rshop';
set request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';
delete from money_out where kind = 'transport';
select count(*) from money_out;

\echo R4 what money out takes: a known kind only, and no changing it afterwards (expect 2 plain errors):
insert into money_out (shop_id, amount, kind) values (:'rshop', 500, 'bribes');
update money_out set amount = 1;

\echo R5 visitors and customers see no money out (expect a permission error, then 0):
reset role; set role anon; select count(*) from money_out;
reset role; set role authenticated; set request.jwt.claim.sub = 'a2100000-0000-4000-8000-000000000001'; select count(*) from money_out;

\echo R6 the monthly goal: the shop sets it, not below zero (expect 750000, then a plain error):
set request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';
update shops set monthly_goal = 750000 where id = :'rshop';
reset role; select monthly_goal from shops where id = :'rshop';
set role authenticated; set request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';
update shops set monthly_goal = -1 where id = :'rshop';

\echo R7 a plan payment you record shows in the money out of that shop (expect 1|shopdesk|3000|ShopDesk plan · 1 month):
reset role; insert into admins values ('33333333-3333-3333-3333-333333333333') on conflict do nothing;
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_record_payment(:'rshop', 3000, 1) is not null as recorded \gset
reset role; select count(*) || '|' || min(kind) || '|' || min(amount) || '|' || min(note) from money_out where shop_id = :'rshop' and kind = 'shopdesk';

\echo R8 a shop messages its own customers inside ShopDesk: no account numbers, only its customers, once a week (expect 3 plain errors, then shop_message|Report Shop|/reportshop, then 2 plain errors):
set role authenticated; set request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';
select message_customer('a2100000-0000-4000-8000-000000000001', 'Pay to 0123456789 for a discount');
select message_customer('a2000000-0000-4000-8000-000000000002', 'Hello');
select message_customer('a2100000-0000-4000-8000-000000000001', '   ');
select message_customer('a2100000-0000-4000-8000-000000000001', 'We miss you! New stock just came in.');
reset role; select kind || '|' || title || '|' || url from notifications where user_id = 'a2100000-0000-4000-8000-000000000001' and kind = 'shop_message';
set role authenticated; set request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';
select message_customer('a2100000-0000-4000-8000-000000000001', 'Another one');
set request.jwt.claim.sub = 'a2100000-0000-4000-8000-000000000001';
select message_customer('a2100000-0000-4000-8000-000000000001', 'I am not a shop');

\echo R9 the month-end report: only on the last day, once per shop, and the app cannot send it (expect 0, then t, then true|true, then 0, then a permission error):
reset role; reset request.jwt.claim.sub;
select send_monthly_reports((date_trunc('month', now() at time zone 'Africa/Lagos') + interval '14 days')::date);
select send_monthly_reports((date_trunc('month', now() at time zone 'Africa/Lagos') + interval '1 month - 1 day')::date) > 0;
select (title like 'Your % report is ready') || '|' || (body = '₦0 in from 2 orders · -₦48,000 left after money out. Tap to see it.' and url like '/?report=%#sales')
from notifications where user_id = 'a2000000-0000-4000-8000-000000000001' and kind = 'monthly_report';
select send_monthly_reports((date_trunc('month', now() at time zone 'Africa/Lagos') + interval '1 month - 1 day')::date);
set role authenticated; set request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';
select send_monthly_reports();
