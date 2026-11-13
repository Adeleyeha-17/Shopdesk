\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Free plan: once a shop's plan has run out it still takes orders for free, up to the free orders a month. Past that it
-- pays the monthly price within the grace days, or its page closes until it pays or the month ends. Cancelled orders don't count.
reset role;
insert into auth.users values ('c6000000-0000-4000-8000-000000000001', 'freeshop@example.com'), ('c6000000-0000-4000-8000-000000000002', 'freebuyer@example.com'),
  ('c6000000-0000-4000-8000-000000000009', 'planboss@example.com') on conflict do nothing;
insert into admins values ('c6000000-0000-4000-8000-000000000009') on conflict do nothing;
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000001';
insert into shops (owner_id, name, slug, sells, location) values (auth.uid(), 'Free Shoes', 'freeshoes', 'Shoes', 'Yaba, Lagos');
insert into products (shop_id, name, price, stock, photo_path) values (my_shop_id(), 'Sandals', 4000, 50, 'x/sandals.jpg');
reset role;
select id as sandals from products where name = 'Sandals' \gset
select id as shop from shops where slug = 'freeshoes' \gset
update shops set status = 'active', paid_until = now() - interval '40 days' where slug = 'freeshoes';
set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000009';
select admin_save_settings('{"monthly_price": 3000, "free_orders": 3, "grace_days": 0, "close_unpaid": true}');
\echo P1 the plan ran out long ago, but the shop is on the free plan: it is open, with 0 of 3 orders this month (expect open, 3, 0, t):
set role anon; reset request.jwt.claim.sub; select case when get_storefront('freeshoes') is null then 'closed' else 'open' end;
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000001';
select my_plan()->>'free_orders', my_plan()->>'month_orders', my_plan()->>'open';
\echo P2 three orders keep it open and out of Needs attention (expect 3, open, 0):
set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000002';
select place_order('freeshoes', '{"name":"Bola","phone":"08035556666","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'sandals', 'qty', 1))) is not null from generate_series(1, 3) \g /dev/null
set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000001'; select my_plan()->>'month_orders';
select count(confirm_payment(id)) from orders where status = 'awaiting' \g /dev/null
set role anon; reset request.jwt.claim.sub; select case when get_storefront('freeshoes') is null then 'closed' else 'open' end;
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000009';
select count(*) from jsonb_array_elements(admin_attention()) x where x->>'kind' = 'plan' and x->>'slug' = 'freeshoes';
\echo P3 the fourth order goes through, then with no grace days the page closes and Admin sees it (expect t, 4, closed, the attention text):
set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000002';
select place_order('freeshoes', '{"name":"Bola","phone":"08035556666","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'sandals', 'qty', 1))) is not null;
set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000001'; select my_plan()->>'month_orders';
set role anon; reset request.jwt.claim.sub; select case when get_storefront('freeshoes') is null then 'closed' else 'open' end;
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000009';
select x->>'text' from jsonb_array_elements(admin_attention()) x where x->>'kind' = 'plan' and x->>'slug' = 'freeshoes';
\echo P4 a fifth order is refused (expect an error):
set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000002';
select place_order('freeshoes', '{"name":"Bola","phone":"08035556666","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'sandals', 'qty', 1)));
\echo P5 with grace days, the shop stays open after passing the free orders and the Plans page shows its month (expect open, 4, t):
set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000009';
select admin_save_settings('{"grace_days": 7}');
set role anon; reset request.jwt.claim.sub; select case when get_storefront('freeshoes') is null then 'closed' else 'open' end;
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000009';
select s->>'month_orders', s->>'passed_at' is not null from jsonb_array_elements(admin_billing()->'shops') s where s->>'slug' = 'freeshoes';
\echo P6 a cancelled order does not count: back to 3, under the limit (expect 3, open):
select admin_save_settings('{"grace_days": 0}');
reset role; select id as last from orders where shop_id = :'shop' order by id desc limit 1 \gset
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000001';
select cancel_order(:last, 'customer_asked', '');
select my_plan()->>'month_orders';
set role anon; reset request.jwt.claim.sub; select case when get_storefront('freeshoes') is null then 'closed' else 'open' end;
\echo P7 with the free plan off (0), the run-out plan closes the shop as before; paying reopens it (expect closed, open):
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000009';
select admin_save_settings('{"free_orders": 0}');
set role anon; reset request.jwt.claim.sub; select case when get_storefront('freeshoes') is null then 'closed' else 'open' end;
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000009';
select admin_record_payment(:'shop', 3000, 1, 'Transfer') is not null \g /dev/null
set role anon; reset request.jwt.claim.sub; select case when get_storefront('freeshoes') is null then 'closed' else 'open' end;
reset role;
select admin_save_settings('{"free_orders": 30, "grace_days": 7}') from (select set_config('request.jwt.claim.sub', 'c6000000-0000-4000-8000-000000000009', false)) x;
