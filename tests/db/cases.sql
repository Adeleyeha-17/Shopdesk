\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Problems with ShopDesk: it decides within 48 hours (both sides see when), writes in the order's chat while it decides
-- (both see it as ShopDesk, nobody can report it), and the decision lands in the chat. Admin can find a customer to block.
reset role;
insert into auth.users values ('c7a00000-0000-4000-8000-000000000001', 'caseshop@example.com'), ('c7a00000-0000-4000-8000-000000000002', 'ngozi.case@example.com'),
  ('c7a00000-0000-4000-8000-000000000009', 'caseboss@example.com') on conflict do nothing;
insert into admins values ('c7a00000-0000-4000-8000-000000000009') on conflict do nothing;
insert into shops (owner_id, name, slug, sells, location, status, reviewed_at, bank, account_number, account_name) values
  ('c7a00000-0000-4000-8000-000000000001', 'Case Wigs', 'casewigs', 'Wigs', 'Surulere, Lagos', 'active', now(), 'OPay', '0123456781', 'CASE W');
select id as shop from shops where slug = 'casewigs' \gset
insert into customers (user_id, name, phone) values ('c7a00000-0000-4000-8000-000000000002', 'Ngozi Eze', '0803 777 1234') on conflict do nothing;
insert into orders (shop_id, customer_id, customer_name, customer_phone, mode, items_total, delivery_paid_by, status, amount_paid, paid_at, done_at, received_by)
  values (:'shop', 'c7a00000-0000-4000-8000-000000000002', 'Ngozi Eze', '08037771234', 'pickup', 20000, 'vendor', 'delivered', 20000, now() - interval '3 days', now() - interval '2 days', 'shop')
  returning id as o \gset
select public_token as t from orders where id = :o \gset
insert into problems (order_id, shop_id, customer_id, kind, details, status, created_at)
  values (:o, :'shop', 'c7a00000-0000-4000-8000-000000000002', 'wrong_item', 'I got a short wig, not the long one I paid for.', 'open', now() - interval '50 hours')
  returning id as pr \gset
select created_at + interval '96 hours' as due from problems where id = :pr \gset

\echo C1 the shop did not answer in 48 hours, so ShopDesk decides by 48 hours after that; the customer sees the same time (expect with_shopdesk, t, t):
set role authenticated; set request.jwt.claim.sub = 'c7a00000-0000-4000-8000-000000000009';
select x->>'status' from jsonb_array_elements(admin_problems()) x where (x->>'id')::bigint = :pr;
select (x->>'decide_by')::timestamptz = :'due' from jsonb_array_elements(admin_problems()) x where (x->>'id')::bigint = :pr;
set request.jwt.claim.sub = 'c7a00000-0000-4000-8000-000000000002';
select (get_order_public(:'t')->'problem'->>'decide_by')::timestamptz = :'due';

\echo C2 ShopDesk writes in the order chat; the shop and the customer both see it and hear it (expect shopdesk, then 2 alerts, then 1 visible to each):
set request.jwt.claim.sub = 'c7a00000-0000-4000-8000-000000000009';
select admin_case_message(:pr, 'Case Wigs, please send a photo of the wig you packed.')->>'sender';
reset role; select count(*) || '|' || min(title) from notifications where order_id = :o and kind = 'message';
set role authenticated; set request.jwt.claim.sub = 'c7a00000-0000-4000-8000-000000000001';
select count(*) from messages where order_id = :o and sender = 'shopdesk';
set request.jwt.claim.sub = 'c7a00000-0000-4000-8000-000000000002';
select count(*) from messages where order_id = :o and sender = 'shopdesk';

\echo C3 nobody can report a ShopDesk message, and only the admin can write as ShopDesk (expect 2 errors):
select report_message((select id from messages where order_id = :o and sender = 'shopdesk' limit 1), 'Rude or insulting');
select admin_case_message(:pr, 'pretending to be ShopDesk');

\echo C4 deciding writes the decision in the chat, and after that ShopDesk cannot write there (expect the decision, then an error):
set request.jwt.claim.sub = 'c7a00000-0000-4000-8000-000000000009';
select admin_decide_problem(:pr, 'customer', 'The packing photo shows the short wig. Refund the customer.', 20000);
reset role; select body from messages where order_id = :o and sender = 'shopdesk' order by id desc limit 1;
set role authenticated; set request.jwt.claim.sub = 'c7a00000-0000-4000-8000-000000000009';
select admin_case_message(:pr, 'One more thing');

\echo C5 Admin finds the customer by name, email or phone, but never a shop owner; then can block them (expect the customer, 1, 1, 0, then blocked):
select string_agg(x->>'email' || '|' || (x->>'orders') || '|' || (x->>'problems') || '|' || (x->>'blocked'), ', ') from jsonb_array_elements(admin_find_customers('ngozi')) x;
select count(*) from jsonb_array_elements(admin_find_customers('ngozi.case@')) x;
select count(*) from jsonb_array_elements(admin_find_customers('0803 777 1234')) x;
select count(*) from jsonb_array_elements(admin_find_customers('caseshop')) x;
select admin_block_user('c7a00000-0000-4000-8000-000000000002', true, 'Fake complaints on several shops');
select x->>'blocked' || '|' || (x->>'block_reason') from jsonb_array_elements(admin_find_customers('ngozi')) x;

\echo C6 only the admin can search customers (expect Not allowed):
set request.jwt.claim.sub = 'c7a00000-0000-4000-8000-000000000001';
select admin_find_customers('ngozi');
reset role;
