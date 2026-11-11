\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Fair use: nobody, customer or shop, can abuse the rules. Runs after the other test files.
reset role;
insert into auth.users values ('f0000000-0000-4000-8000-000000000001', 'fairshop@example.com'), ('f0000000-0000-4000-8000-000000000002', 'other-shop@example.com'),
  ('f1000000-0000-4000-8000-000000000001', 'kunle@example.com'), ('f1000000-0000-4000-8000-000000000002', 'nkechi@example.com'),
  ('f1000000-0000-4000-8000-000000000003', 'sola@example.com') on conflict do nothing;
insert into admins values ('33333333-3333-3333-3333-333333333333') on conflict do nothing;
set role authenticated; set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000001';
insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location) values (auth.uid(), 'Fair Goods', 'fairgoods', 'OPay', '0111222333', 'FAIR GOODS', '08000000009', 'Things', 'Ikeja');
insert into products (shop_id, name, price, stock, photo_path) values (my_shop_id(), 'Kettle', 10000, 50, 'x/kettle.jpg');
set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000002';
insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location) values (auth.uid(), 'Other Shop', 'othershop', 'OPay', '0111222334', 'OTHER', '08000000008', 'Things', 'Yaba');
reset role; update shops set status = 'active' where slug in ('fairgoods', 'othershop');
select id as kettle from products where name = 'Kettle' \gset
select id as fair from shops where slug = 'fairgoods' \gset
-- an order the shop delivers, for customer $1
create or replace function pg_temp.delivered(p_user uuid) returns uuid language plpgsql as $$
declare t uuid; o bigint; k uuid := (select id from products where name = 'Kettle');
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  set local role authenticated;
  t := (place_order('fairgoods', '{"name":"Buyer","phone":"0801","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', k, 'qty', 1)))->>'token')::uuid;
  reset role;
  select id into o from orders where public_token = t;
  update orders set status = 'delivered', amount_paid = items_total, created_at = now() - interval '5 minutes', paid_at = now(), done_at = now(), received_by = 'shop', confirmed_at = now() where id = o;
  return t;
end $$;

\echo F1 evidence: a photo is needed for a wrong, damaged or missing item, not for "didn’t arrive" (expect 3 errors, then t):
select pg_temp.delivered('f1000000-0000-4000-8000-000000000001') as k1 \gset
reset role; select id as ok1 from orders where public_token = :'k1' \gset
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000001';
select report_problem(:'k1', 'wrong_item', 'This is not the kettle I ordered.', '{}');
select report_problem(:'k1', 'damaged', 'The kettle arrived with a crack.', '{}');
select report_problem(:'k1', 'missing_item', 'The lid was not in the box.', '{}');
\o /dev/null
select report_problem(:'k1', 'not_arrived', 'Nothing came, the shop marked it delivered.', '{}');
\o
reset role; select count(*) = 1 from problems where order_id = :ok1;

\echo F2 at most 2 open problems at once (expect t, then the open-problems error):
select pg_temp.delivered('f1000000-0000-4000-8000-000000000001') as k2 \gset
select pg_temp.delivered('f1000000-0000-4000-8000-000000000001') as k3 \gset
reset role; select id as ok2 from orders where public_token = :'k2' \gset
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000001';
\o /dev/null
select report_problem(:'k2', 'other', 'The colour is different from the photo.', '{}');
\o
reset role; select count(*) = 2 from problems where customer_id = 'f1000000-0000-4000-8000-000000000001';
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000001';
select report_problem(:'k3', 'other', 'The handle feels loose on this one.', '{}');
\echo F3 the order page says why reporting is closed (expect the same message):
select get_order_public(:'k3')->>'report_block';
\echo F4 at most 3 reports a month (expect the monthly error):
reset role; update problems set status = 'sorted', closed_at = now() where customer_id = 'f1000000-0000-4000-8000-000000000001';
select pg_temp.delivered('f1000000-0000-4000-8000-000000000001') as k4 \gset
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000001';
\o /dev/null
select report_problem(:'k3', 'other', 'The handle feels loose on this one.', '{}');
\o
select report_problem(:'k4', 'other', 'And this one also has a loose handle.', '{}');
\echo F5 two complaints decided against you in 90 days pause reporting for 30 days (expect the paused error, then null after 31 days):
reset role; update problems set created_at = now() - interval '40 days' where customer_id = 'f1000000-0000-4000-8000-000000000001';
update problems set status = 'decided', decision = 'shop', decided_at = now() - interval '1 day', closed_at = now() where customer_id = 'f1000000-0000-4000-8000-000000000001' and id in (select id from problems where customer_id = 'f1000000-0000-4000-8000-000000000001' order by id limit 2);
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000001';
select report_problem(:'k4', 'other', 'And this one also has a loose handle.', '{}');
reset role; update problems set decided_at = now() - interval '31 days' where customer_id = 'f1000000-0000-4000-8000-000000000001' and decision = 'shop';
select coalesce(report_block('f1000000-0000-4000-8000-000000000001'), 'null');

\echo F6 no hoarding stock: 3 unpaid orders per shop, then pay or cancel one (expect the unpaid error):
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';
select place_order('fairgoods', '{"name":"Nkechi","phone":"0802","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)))->>'token' as u1 \gset
select place_order('fairgoods', '{"name":"Nkechi","phone":"0802","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)))->>'token' as u2 \gset
select place_order('fairgoods', '{"name":"Nkechi","phone":"0802","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)))->>'token' as u3 \gset
select place_order('fairgoods', '{"name":"Nkechi","phone":"0802","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)));
\echo F7 the customer cancels an unpaid order: stock back, the shop hears, reason "customer"; then she can order again (expect +1 stock, cancelled|customer, 1 alert, t):
reset role; select stock as s0 from products where id = :'kettle' \gset
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';
select (get_order_public(:'u1')->>'can_cancel')::boolean;
\o /dev/null
select customer_cancel(:'u1');
\o
reset role; select stock - :s0 from products where id = :'kettle';
select status || '|' || cancel_reason from orders where public_token = :'u1';
select count(*) from notifications where user_id = 'f0000000-0000-4000-8000-000000000001' and kind = 'cancelled' and title like 'Nkechi cancelled%';
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';
select (place_order('fairgoods', '{"name":"Nkechi","phone":"0802","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)))->>'token') is not null;
\echo F8 nobody else can cancel it, and not after saying it’s paid (expect 2 errors):
set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000003'; select customer_cancel(:'u2');
set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';
\o /dev/null
select customer_says_paid(:'u2');
\o
select customer_cancel(:'u2');

\echo F9 the shop cancels with a reason the customer sees; not within a day of "I’ve paid" (expect error, error, then cancelled|out_of_stock and the alert text):
set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000001';
select id as uo2 from orders where public_token = :'u2' \gset
select id as uo3 from orders where public_token = :'u3' \gset
select cancel_order(:uo2, 'out_of_stock');
select cancel_order(:uo3, 'because');
\o /dev/null
select cancel_order(:uo3, 'out_of_stock', 'Sold the last one in the shop.');
\o
reset role; select status || '|' || cancel_reason from orders where id = :uo3;
select body from notifications where order_id = :uo3 and kind = 'cancelled' and user_id = 'f1000000-0000-4000-8000-000000000002';

\echo F10 unpaid orders cancel themselves after 48 hours (stock back, both told); "I’ve paid" orders and part-paid ones stay (expect 1 cancelled, unpaid, +1 stock, 2 alerts, awaiting):
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000003';
select place_order('fairgoods', '{"name":"Sola","phone":"0803","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)))->>'token' as x1 \gset
reset role; update orders set created_at = now() - interval '49 hours' where public_token in (:'x1', :'u2');
select stock as s1 from products where id = :'kettle' \gset
select tidy() >= 1;
select cancel_reason from orders where public_token = :'x1';
select stock - :s1 from products where id = :'kettle';
select count(*) from notifications n join orders o on o.id = n.order_id where o.public_token = :'x1' and n.kind = 'cancelled';
select status from orders where public_token = :'u2';
\echo F11 the customer’s page shows the pay-by time and the reason (expect t, unpaid):
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000003';
select get_order_public(:'x1')->>'cancel_reason' = 'unpaid';
select place_order('fairgoods', '{"name":"Sola","phone":"0803","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)))->>'token' as x2 \gset
select (get_order_public(:'x2')->>'pay_by')::timestamptz between now() + interval '47 hours' and now() + interval '49 hours';

\echo F12 refunds: the shop needs a receipt photo; with one, the page isn’t paused while the customer checks (expect t, error, f):
reset role;
select pg_temp.delivered('f1000000-0000-4000-8000-000000000003') as r1 \gset
select pg_temp.delivered('f1000000-0000-4000-8000-000000000002') as r2 \gset
select pg_temp.delivered('f1000000-0000-4000-8000-000000000003') as r3 \gset
reset role; select id as ro1 from orders where public_token = :'r1' \gset
insert into problems (order_id, shop_id, customer_id, kind, details, status, decision, decided_at, closed_at, owed_amount, owed_by)
  values (:ro1, :'fair', 'f1000000-0000-4000-8000-000000000003', 'other', 'Test refund problem here.', 'decided', 'customer', now(), now(), 5000, now() - interval '1 minute');
select shop_owes(:'fair');
set role authenticated; set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000001';
select refund_sent(:ro1, null);
\o /dev/null
select refund_sent(:ro1, :ro1 || '/r-61111111-2222-4333-8444-555555555555.jpg');
\o
reset role; select shop_owes(:'fair');
\echo F13 the customer says it didn’t arrive: paused again, you and the shop hear (expect t, 1, 1, then "already" error):
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000003';
\o /dev/null
select problem_customer(:'r1', 'refund_missing');
\o
reset role; select shop_owes(:'fair');
select count(*) from notifications where kind = 'admin_refund' and user_id = '33333333-3333-3333-3333-333333333333';
select count(*) from notifications where kind = 'refund_missing' and order_id = :ro1;
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000003';
select problem_customer(:'r1', 'refund_missing');
\echo F13b a new receipt doesn’t end the dispute; it goes to you (expect t, 2):
set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000001';
\o /dev/null
select refund_sent(:ro1, :ro1 || '/r-81111111-2222-4333-8444-555555555555.jpg');
\o
reset role; select shop_owes(:'fair');
select count(*) from notifications where kind = 'admin_refund' and user_id = '33333333-3333-3333-3333-333333333333';
set role authenticated;
\echo F14 Needs attention shows the disputed refund (expect 1):
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select count(*) from jsonb_array_elements(admin_attention()) x where x->>'kind' = 'refund_disputed' and x->>'slug' = 'fairgoods';
\echo F15 a customer who stays silent can’t keep the shop paused: 48 hours after a receipt it counts as received (expect auto|t, f); a disputed one doesn’t (expect null):
reset role; select id as ro2 from orders where public_token = :'r2' \gset
insert into problems (order_id, shop_id, customer_id, kind, details, status, decision, decided_at, closed_at, owed_amount, owed_by, owed_sent_at, owed_receipt)
  values (:ro2, :'fair', 'f1000000-0000-4000-8000-000000000002', 'other', 'Second refund problem.', 'decided', 'customer', now() - interval '3 days', now(), 4000, now() - interval '1 day', now() - interval '49 hours', :ro2 || '/r-71111111-2222-4333-8444-555555555555.jpg');
update problems set owed_sent_at = now() - interval '49 hours' where order_id = :ro1;
select tidy() >= 1;
select owed_cleared_by || '|' || (owed_paid_at is not null) from problems where order_id = :ro2;
select coalesce(owed_cleared_by, 'null') from problems where order_id = :ro1;
\echo F15b for 7 days after that she can still say it didn’t arrive; once you’ve closed it, it’s closed and both hear (expect null|t, then 2 alerts, then the closed error):
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';
\o /dev/null
select problem_customer(:'r2', 'refund_missing');
\o
reset role; select coalesce(owed_cleared_by, 'null') || '|' || (owed_paid_at is null and owed_disputed_at is not null) from problems where order_id = :ro2;
select id as pr2 from problems where order_id = :ro2 \gset
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\o /dev/null
select admin_clear_owed(:pr2, 'Receipt matches the bank statement.');
\o
reset role; select count(*) from notifications where order_id = :ro2 and kind = 'refund_ok' and title like '%cleared%' or (order_id = :ro2 and kind = 'refund_ok' and body like '%ShopDesk checked%');
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';
select problem_customer(:'r2', 'refund_missing');

\echo F16 report a message: only the other side’s, once; a shop can report a rude customer (expect 3 errors, then t, error, then customer|t):
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000003';
select (send_message(:ro1, 'You people are useless, I will deal with you')->>'id') as m_cust \gset
set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000001';
select (send_message(:ro1, 'Please stay calm, we are checking with the bank.')->>'id') as m_shop \gset
select report_message(:m_shop, 'Reporting my own message');
set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002'; select report_message(:m_cust, 'Not my order');
set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000001'; select report_message(:m_cust, '');
\o /dev/null
select report_message(:m_cust, 'Threatening language');
\o
reset role; select count(*) = 1 from reports where message_id = :m_cust and about = 'customer';
set role authenticated; set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000001'; select report_message(:m_cust, 'Again');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select (x->>'about') || '|' || (x->'message'->>'body' like 'You people are useless%') from jsonb_array_elements(admin_reports()) x where x->'message'->>'id' = :'m_cust';

\echo F17 a shop sending a different account number in chat is flagged to you; its own number and phone numbers aren’t (expect other_account, null, null, null, then t, attention 1):
set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000001';
select coalesce(send_message(:ro1, 'Please pay into 0999 888 777 instead, my OPay is down')->>'flag', 'null');
select coalesce(send_message(:ro1, 'Our account is 0111222333')->>'flag', 'null');
select coalesce(send_message(:ro1, 'Call the rider on 08031234567')->>'flag', 'null');
set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000003';
select coalesce(send_message(:ro1, 'My account for the refund is 2233445566')->>'flag', 'null');
reset role; select count(*) >= 1 from audit_log where action = 'other_account' and shop_id = :'fair';
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select count(*) from jsonb_array_elements(admin_attention()) x where x->>'kind' = 'other_account' and x->>'slug' = 'fairgoods';

\echo F18 reporting a shop: sign in, once until it’s handled, 5 a day (expect error, t, "already" error):
set role anon; reset request.jwt.claim.sub; select report_shop('fairgoods', 'Anonymous complaint', '');
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';
\o /dev/null
select report_shop('fairgoods', 'They keep cancelling my orders.', '');
\o
reset role; select count(*) = 1 from reports where reporter_id = 'f1000000-0000-4000-8000-000000000002' and shop_id = :'fair' and message_id is null;
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';
select report_shop('fairgoods', 'Again they cancelled my order.', '');

\echo F19 you can block an abusive customer (with a reason; not a shop account); they can’t order, write, report or complain; unblocking lifts it (expect 3 errors, t, 4 errors, t):
set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000001'; select admin_block_user('f1000000-0000-4000-8000-000000000003', true, 'Threatening the shop');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_block_user('f1000000-0000-4000-8000-000000000003', true, 'no');
select admin_block_user('f0000000-0000-4000-8000-000000000001', true, 'Rude shop owner');
\o /dev/null
select admin_block_user('f1000000-0000-4000-8000-000000000003', true, 'Threatened the shop in chat (report on TT order).');
\o
reset role; select count(*) = 1 from blocked_users where user_id = 'f1000000-0000-4000-8000-000000000003';
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000003';
select place_order('fairgoods', '{"name":"Sola","phone":"0803","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)));
select send_message(:ro1, 'hello?');
select report_shop('othershop', 'Something happened here', '');
select report_problem(:'r3', 'other', 'Just testing the block rule.', '{}');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\o /dev/null
select admin_block_user('f1000000-0000-4000-8000-000000000003', false, 'Apologised; give another chance.');
\o
set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000003';
select (send_message(:ro1, 'Sorry about earlier.')->>'id') is not null;
\echo F20 the shop can still write to a blocked customer about their order, and you see the block in Problems (expect t, t):
reset role; insert into blocked_users (user_id, reason) values ('f1000000-0000-4000-8000-000000000003', 'Blocked again for the test');
set role authenticated; set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000001';
select (send_message(:ro1, 'Your refund is on its way.')->>'id') is not null;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select bool_or((x->'customer'->>'blocked')::boolean) from jsonb_array_elements(admin_problems()) x where x->'order'->>'id' = :'ro1';

\echo F21 rights: the new functions need an account; the helpers and blocked list are closed (expect t x5, f x5, permission denied):
reset role;
select has_function_privilege('authenticated', 'public.customer_cancel(uuid)', 'execute'), has_function_privilege('authenticated', 'public.report_message(bigint, text)', 'execute'),
  has_function_privilege('authenticated', 'public.cancel_order(bigint, text, text)', 'execute'), has_function_privilege('authenticated', 'public.refund_sent(bigint, text)', 'execute'),
  has_function_privilege('authenticated', 'public.admin_block_user(uuid, boolean, text)', 'execute');
select has_function_privilege('authenticated', 'public.tidy(uuid)', 'execute'), has_function_privilege('authenticated', 'public.report_block(uuid)', 'execute'),
  has_function_privilege('authenticated', 'public.is_blocked(uuid)', 'execute'), has_function_privilege('anon', 'public.customer_cancel(uuid)', 'execute'),
  has_function_privilege('anon', 'public.report_message(bigint, text)', 'execute');
set role authenticated; set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000003'; select count(*) from blocked_users;
\echo F22 receipts: only the shop adds r- photos to its order (expect t f):
reset role;
select order_photo_access(:ro1 || '/r-x.jpg', true) from (select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000001', true)) x;
select order_photo_access(:ro1 || '/r-x.jpg', true) from (select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000003', true)) x;

\echo F23 nothing is lost: a shop can’t delete a product (it hides it), each order line keeps the photo the customer saw, and a photo in use can’t be removed (expect permission denied, t, t, f, t):
set role authenticated; set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000001';
delete from products where id = :'kettle';
reset role; select bool_and(i.photo_path = 'x/kettle.jpg') from order_items i join orders o on o.id = i.order_id where o.shop_id = :'fair';
select (admin_order_json(:ro1)->'items'->0->>'photo') = 'x/kettle.jpg' from (select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true)) x;
select product_photo_unused('x/kettle.jpg');
select product_photo_unused('x/upload-that-failed.jpg');
\echo F24 the shop’s own photo files: one in use stays, an upload that didn’t save can go (expect 1 left, the kettle photo):
reset role; update products set photo_path = :'fair' || '/kettle.jpg' where id = :'kettle'; update order_items set photo_path = :'fair' || '/kettle.jpg' where product_id = :'kettle';
insert into storage.objects (bucket_id, name) values ('product-photos', :'fair' || '/kettle.jpg'), ('product-photos', :'fair' || '/failed.jpg');
set role authenticated; set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000001';
delete from storage.objects;
reset role; select count(*) || ' left, ' || string_agg(split_part(name, '/', 2), ',') from storage.objects where bucket_id = 'product-photos' and name like :'fair' || '%';
\echo R1 an order’s chat with no report or problem opens only with your reason, which is logged (expect error, then t, 1 log line with the reason):
reset role; select id as plain from orders where public_token = :'x2' \gset
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_order_chat(:plain);
select (admin_order_chat(:plain, 'Customer phoned about a delay')->'messages') is not null;
reset role; select count(*) from audit_log where action = 'chat_view' and detail like '%Reason: Customer phoned about a delay';
\echo R2 find any order by its code; the lookup is logged; the cancel reason shows (expect FG|t|not paid in 48 hours, 1, then error):
reset role; select id as x1id from orders where public_token = :'x1' \gset
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select left(r->'order'->>'code', 2) || '|' || (r->'shop'->>'slug' = 'fairgoods') || '|' || (r->'order'->>'cancel_text') from (select admin_find_order('fg-' || :x1id) r) x;
reset role; select count(*) from audit_log where action = 'order_lookup';
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_find_order('nothing here');
\echo R3 automatic actions are in your Log (expect t t):
select bool_or(x->>'action' = 'auto_cancel' and x->>'who' is null), bool_or(x->>'action' = 'auto_refund_ok') from jsonb_array_elements(admin_audit_log()) x;
\echo R4 a shop deleted with its account (in Supabase) still leaves you a copy; its orders are found there; shops and customers can’t see copies (expect t, the deleted shop without its chat, then the reason error, error x2, permission denied):
reset role;
select o.id as gone_order from orders o join shops s on s.id = o.shop_id where s.slug = 'fairgoods' order by o.id limit 1 \gset
delete from auth.users where id = 'f0000000-0000-4000-8000-000000000001';
select reason = 'The shop''s account was deleted.' and owner_email is null and jsonb_array_length(data->'orders') > 5 from archives where slug = 'fairgoods';
select max(id) as arch from archives \gset
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select r->'archive'->>'shop' || ' · chat included: ' || (r->'order' ? 'chat') from (select admin_find_order(:'gone_order') r) x;
select admin_archive(:arch, 'no');
set request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000003'; select admin_archives();
select admin_find_order('1');
select count(*) from archives;
\echo R5 you can download it with a reason (logged), and still see its photos (expect t, 1, t):
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select jsonb_array_length(admin_archive(:arch, 'Customer dispute after deletion')->'orders') > 5;
reset role; select count(*) from audit_log where action = 'archive_view';
select order_photo_access(:gone_order || '/r-x.jpg', false) from (select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true)) x;
\echo R6 clearing old customer details also clears them in copies (expect t):
reset role; update archives set created_at = now() - interval '400 days';
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\o /dev/null
select purge_customer_details(180);
\o
reset role; select bool_and(purged) and not bool_or(data::text like '%"customer_phone": "080%') from archives;
\echo F25 "Call rider" must ring: the rider’s number has to be a Nigerian mobile (expect the number error x2, then out x3):
reset role;
insert into orders (shop_id, customer_id, customer_name, customer_phone, mode, address, items_total, delivery_paid_by, delivery_fee, amount_paid, status, confirmed_at, paid_at)
  select id, 'f1000000-0000-4000-8000-000000000001', 'Kunle', '08020000000', 'delivery', '12 Allen Avenue', 5000, 'vendor', 0, 5000, 'paid', now(), now() from shops where slug = 'othershop' returning id as oc \gset
set role authenticated; set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000002';
select hand_to_rider(:oc, 'Musa', '0803 123 456', now() + interval '3 hours');
select hand_to_rider(:oc, 'Musa', '0112345678901', now() + interval '3 hours');
\o /dev/null
select hand_to_rider(:oc, 'Musa', '+234 803 123 4567', now() + interval '3 hours');
\o
reset role; select status from orders where id = :oc;
set role authenticated; set request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000002';
\o /dev/null
select hand_to_rider(:oc, 'Musa', '0803-123-4567', now() + interval '3 hours');
select hand_to_rider(:oc, 'Musa', '2349031234567', now() + interval '3 hours');
\o
reset role; select status from orders where id = :oc; select status from orders where id = :oc;
