\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Shop owners can buy from other shops with the same email, never from their own shop. Customers still can't open a shop.
-- What a shop spent buying shows in its report (my_purchases), and Admin can find and block a shop owner's buying only.
reset role;
insert into auth.users values ('cb000000-0000-4000-8000-000000000001', 'wigseller@example.com'), ('cb000000-0000-4000-8000-000000000002', 'packaging@example.com'),
  ('cb000000-0000-4000-8000-000000000003', 'buyer.only@example.com'), ('cb000000-0000-4000-8000-000000000009', 'buyboss@example.com') on conflict do nothing;
insert into admins values ('cb000000-0000-4000-8000-000000000009') on conflict do nothing;
insert into shops (owner_id, name, slug, sells, location, status, reviewed_at, bank, account_number, account_name) values
  ('cb000000-0000-4000-8000-000000000001', 'Wig Palace', 'wigpalace', 'Wigs', 'Yaba, Lagos', 'active', now(), 'OPay', '0123456782', 'WIG P'),
  ('cb000000-0000-4000-8000-000000000002', 'Pack Pro', 'packpro', 'Packaging', 'Ikeja, Lagos', 'active', now(), 'OPay', '0123456783', 'PACK P');
insert into products (shop_id, name, price, stock, photo_path) select id, 'Wig box', 2500, 100, 'x/box.jpg' from shops where slug = 'packpro';
insert into products (shop_id, name, price, stock, photo_path) select id, 'Bone straight', 90000, 10, 'x/wig.jpg' from shops where slug = 'wigpalace';
select id as box from products where name = 'Wig box' \gset
select id as wig from products where name = 'Bone straight' \gset

\echo B1 a shop owner buys from another shop with the same email; the seller hears a normal new order (expect the order total, then the alert):
set role authenticated; set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000001';
select (place_order('packpro', '{"name":"Amaka","phone":"08031112222","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'box', 'qty', 4))))->>'token' as tok1 \gset
reset role; select items_total from orders where public_token = :'tok1';
select kind || '|' || title from notifications where user_id = 'cb000000-0000-4000-8000-000000000002' and kind = 'new_order';
select id as o1 from orders where public_token = :'tok1' \gset

\echo B2 the account now runs a shop and buys, and knows its own link; its buyer details are saved (expect true true wigpalace, then 1):
set role authenticated; set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000001';
select my_account()->>'vendor', my_account()->>'customer', my_account()->>'shop_slug';
reset role; select count(*) from customers where user_id = 'cb000000-0000-4000-8000-000000000001';

\echo B3 nobody orders from their own shop or acts as the customer on their own shop orders (expect 2 errors):
set role authenticated; set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000001';
select place_order('wigpalace', '{"name":"Amaka","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'wig', 'qty', 1)));
set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000003';
select (place_order('wigpalace', '{"name":"Ifeoma","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'wig', 'qty', 1))))->>'token' as tok2 \gset
set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000001';
select customer_says_paid(:'tok2');

\echo B4 alerts about the buying order go to the buyer page, and the buyer writes in the order chat as the customer (expect confirmed with /o/ link, then customer):
set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000002';
select confirm_order(:o1);
reset role; select kind || '|' || (url like '/o/%') from notifications where user_id = 'cb000000-0000-4000-8000-000000000001' and kind = 'confirmed';
set role authenticated; set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000001';
select sender from jsonb_to_record(send_message(:o1, 'Please pack them flat')) as x(sender text);

\echo B5 the report counts only what was paid, per shop, for the month (expect 0 before paying, then 10000 1 and Pack Pro):
select my_purchases(date_trunc('month', now() at time zone 'Africa/Lagos')::date, (now() at time zone 'Africa/Lagos')::date)->>'spent';
set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000002';
select confirm_payment(:o1) is not null;
set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000001';
select x->>'spent', x->>'orders', x->'shops'->0->>'name', x->'shops'->0->>'spent'
from (select my_purchases(date_trunc('month', now() at time zone 'Africa/Lagos')::date, (now() at time zone 'Africa/Lagos')::date) as x) z;

\echo B6 a plain customer still cannot open a shop (expect 1 error):
set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000003';
insert into shops (owner_id, name, slug) values (auth.uid(), 'Ifeoma Store', 'ifeomastore');

\echo B7 Admin finds the shop owner as a buyer, tagged with their shop; a shop owner who never bought is not listed (expect the email and Wig Palace, then 0):
set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000009';
select x->>'email' || '|' || (x->>'shop') from jsonb_array_elements(admin_find_customers('wigseller')) x;
select count(*) from jsonb_array_elements(admin_find_customers('packaging@')) x;

\echo B8 blocking the shop owner stops only their buying; their shop still sells, and a pure shop cannot be blocked this way (expect error, then a new order total, then an error):
select admin_block_user('cb000000-0000-4000-8000-000000000001', true, 'Ordered and never paid, several times');
set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000001';
select place_order('packpro', '{"name":"Amaka","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'box', 'qty', 1)));
set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000003';
select (place_order('wigpalace', '{"name":"Ifeoma","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'wig', 'qty', 1))))->>'items_total';
set request.jwt.claim.sub = 'cb000000-0000-4000-8000-000000000009';
select admin_block_user('cb000000-0000-4000-8000-000000000002', true, 'Trying to block a shop that never bought');

\echo B9 visitors cannot ask what a shop spent (expect permission denied):
set role anon; reset request.jwt.claim.sub; select my_purchases(current_date, current_date);
reset role;
