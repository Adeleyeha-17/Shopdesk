\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
insert into auth.users values ('66666666-6666-6666-6666-666666666666', 'shopper@example.com');
-- vendor 1 sets up a shop with two products
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location, social) values (auth.uid(), 'Rose Perfumes', 'rose', 'OPay', '8000000001', 'ROSE U.', '08030000000', 'Perfumes and body mists', 'Yaba, Lagos', '@roseperfumes');
insert into products (shop_id, name, price, stock, photo_path) values (my_shop_id(), 'Sweet Obsession 30ml', 9500, 2, 'x/a.jpg'), (my_shop_id(), 'Amouage 30ml', 15000, 5, 'x/b.jpg');
\echo T1 vendor1 sees own products:
select count(*) from products;
\echo T2 vendor1 cannot change own shop status (expect permission denied):
update shops set status = 'active';
-- vendor 2
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into shops (owner_id, name, slug) values (auth.uid(), 'Tunde Thrift', 'tunde');
\echo T3 vendor2 sees shops / products / orders of others (expect 1 0 0):
select count(*) from shops; select count(*) from products; select count(*) from orders;
\echo T4 vendor2 tries to edit vendor1 product (expect 0 rows changed):
with u as (update products set price = 1 returning 1) select count(*) from u;
\echo T5 vendor2 tries to plant a shop for someone else (expect RLS error):
insert into shops (owner_id, name, slug) values ('11111111-1111-1111-1111-111111111111', 'Fake', 'fakeshop');
\echo V1 vendor creates a shop that is already approved (expect permission denied):
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into shops (owner_id, name, slug, status) values (auth.uid(), 'Sneaky', 'sneaky', 'active');
\echo V2 vendor approves itself (expect permission denied):
update shops set reviewed_at = now();
\echo V3 new shops wait for approval and their order page is closed (expect pending pending, closed, error):
reset role; select string_agg(status, ' ' order by slug) from shops;
set role anon; reset request.jwt.claim.sub;
select coalesce(get_storefront('rose')::text, 'closed');
set role authenticated; set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select place_order('rose', '{"name":"Early","mode":"pickup"}', '[]');
set role anon; reset request.jwt.claim.sub;
-- owner vets the applications
reset role; insert into admins values ('33333333-3333-3333-3333-333333333333');
select id as rose from shops where slug = 'rose' \gset
select id as tunde from shops where slug = 'tunde' \gset
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo V4 a vendor tries to approve a shop (expect Not allowed):
select admin_review_shop(:'tunde', true);
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo V5 owner sees 2 applications, with what Rose sells and her photos count:
select o->>'shops_pending', jsonb_array_length(o->'applications'), (o->'applications')::text like '%Perfumes and body mists%', (select jsonb_array_length(a->'photos') from jsonb_array_elements(o->'applications') a where a->>'slug' = 'rose') from (select admin_overview() o) x;
\echo V6 reject without a reason (expect error), then reject Tunde with one, approve Rose:
select admin_review_shop(:'tunde', false, 'no');
select admin_review_shop(:'tunde', false, 'Could not confirm the business on WhatsApp');
select admin_review_shop(:'rose', true);
\echo V7 approving an open shop again (expect error):
select admin_review_shop(:'rose', true);
reset role;
\echo V8 statuses and the note Tunde sees (expect active rejected, note):
select string_agg(status, ' ' order by slug) from shops; select review_note from shops where slug = 'tunde';
-- customer (anon)
reset request.jwt.claim.sub; set role anon;
\echo T6 anon reads shops table directly (expect permission denied):
select * from shops;
\echo T7 storefront products:
select jsonb_array_length(get_storefront('rose')->'products'), get_storefront('rose')->'shop'->>'name';
\echo T8 place order 2 x Sweet Obsession:
set role authenticated; set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select (place_order('rose', '{"name":"Eden","phone":"0809","mode":"delivery","address":"Yaba, Herbert Macaulay"}', jsonb_build_array(jsonb_build_object('product_id', (select (p->>'id') from jsonb_array_elements(get_storefront('rose')->'products') p where p->>'name' like 'Sweet%'), 'qty', 2))))->>'items_total';
set role anon; reset request.jwt.claim.sub;
\echo T9 second order for the sold-out item (expect "has only 0 left"):
set role authenticated; set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select place_order('rose', '{"name":"Ada","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', (select (p->>'id') from jsonb_array_elements(get_storefront('rose')->'products') p where p->>'name' like 'Sweet%'), 'qty', 1)));
set role anon; reset request.jwt.claim.sub;
\echo T10 anon tries to confirm a payment (expect permission denied):
select confirm_payment(1);
-- vendor 1 works the order
reset role; select public_token as tok from orders where id = 1 \gset
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo T11 confirm before delivery fee (expect "Set the delivery fee first"):
select confirm_payment(1);
select set_delivery_fee(1, 2000);
\echo T12 part payment while part payments are off (expect error):
select confirm_payment(1, 'tap', 5000);
\echo T13 full payment, then with rider (name, number, time), then delivered:
select confirm_payment(1)->>'paid';
\o /dev/null
select pack_item(id, true) from order_items where order_id = 1;
\o
select hand_to_rider(1, 'Musa', '0803 123 4567', now() + interval '1 day'); select advance_order(1);
\echo T14 vendor2 tries to touch vendor1 order (expect "Order not found"):
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select cancel_order(1);
-- the customer's view of their own order
set role anon; reset request.jwt.claim.sub;
\echo T15 customer order page (status, to_pay):
select get_order_public(:'tok')->>'status', get_order_public(:'tok')->>'to_pay';
-- cancel restores stock
set role authenticated; set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select (place_order('rose', '{"name":"Kola","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', (select (p->>'id') from jsonb_array_elements(get_storefront('rose')->'products') p where p->>'name' like 'Amouage%'), 'qty', 3))))->>'order_id' as oid \gset
set role anon; reset request.jwt.claim.sub;
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo T16 stock after holding 3 Amouage, then after cancelling (expect 2 then 5):
select stock from products where name like 'Amouage%'; select cancel_order(:oid); select stock from products where name like 'Amouage%';
\echo T17 storage: own folder ok, another shop folder refused:
select my_shop_id() as s1 \gset
insert into storage.objects (bucket_id, name) values ('product-photos', :'s1' || '/p.jpg');
insert into storage.objects (bucket_id, name) values ('product-photos', 'aaaaaaaa-0000-0000-0000-000000000000/p.jpg');
\echo T18 vendor calls admin overview (expect Not allowed):
select admin_overview();
-- a customer reports the shop (signed in: visitors can't report)
set role authenticated; set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select report_shop('rose', 'Paid but no delivery after 5 days', '0809 000 0000');
reset role; reset request.jwt.claim.sub;
\echo V9 approved shop changes its payment account: logged and flagged (expect t):
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update shops set account_number = '8000000099', account_name = 'SOMEONE ELSE'; select details_changed_at is not null from shops;
-- owner
reset role;
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo T19 owner overview: shops, orders_7d, paid value, reports open, shop list has no customer names:
select o->>'shops_total', o->>'orders_7d', o->>'paid_value_7d', o->>'reports_open', (o->'shops')::text like '%Eden%' from (select admin_overview() o) x;
\echo T20 owner reads customers table directly (expect 0 rows: RLS):
select count(*) from orders;
\echo T21 support view without a reason (expect error), then with one:
select admin_support_view((select id from shops where false), 'x');
select jsonb_array_length(admin_support_view(:'s1', 'Customer reported non-delivery; checking order times'));
\echo T22 suspend the shop: order page closes:
select admin_set_shop_status(:'s1', 'suspended', 'Under review after a report');
set role anon; reset request.jwt.claim.sub;
select coalesce(get_storefront('rose')::text, 'closed');
set role authenticated; set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select place_order('rose', '{"name":"X","mode":"pickup"}', '[]');
set role anon; reset request.jwt.claim.sub;
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo V10 shop list flags the account change:
select (select x->>'details_changed_at' is not null from jsonb_array_elements(admin_overview()->'shops') x where x->>'slug' = 'rose');
\echo T23 audit log actions:
select string_agg(x->>'action', ',') from jsonb_array_elements(admin_audit_log()) x;
-- ===== running ShopDesk as a business =====
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_set_shop_status(:'s1', 'active', 'Report checked, all fine');
\echo N1 settings start with a 30-day trial, 7 grace days, unpaid shops close (expect 30 7 true):
select s->>'trial_days', s->>'grace_days', s->>'close_unpaid' from (select admin_billing()->'settings' s) x;
\echo N2 approval started the free trial for Rose (expect t):
reset role; select paid_until > now() + interval '29 days' from shops where slug = 'rose';
\echo N3 customer taps I have sent the money, it shows on their page; a paid order refuses it (expect t, error):
set role anon; reset request.jwt.claim.sub;
set role authenticated; set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select (place_order('rose', '{"name":"Bisi","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', (select (p->>'id') from jsonb_array_elements(get_storefront('rose')->'products') p where p->>'name' like 'Amouage%'), 'qty', 1))))->>'token' as tok2 \gset
-- the customer's own account says it has paid
select customer_says_paid(:'tok2'); select get_order_public(:'tok2')->>'customer_says_paid';
select customer_says_paid(:'tok');
\echo N4 a day later with no confirmation, it is in Needs attention with the bank change and the report (expect bank_changed,reports,says_paid):
reset role; update orders set customer_says_paid_at = now() - interval '2 days' where public_token = :'tok2';
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select string_agg(x->>'kind', ',' order by x->>'kind') from jsonb_array_elements(admin_attention()) x where x->>'slug' = 'rose';
\echo N5 vendor tries to unhide or create hidden-flag products itself (expect permission denied twice):
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update products set hidden_by_admin = false;
insert into products (shop_id, name, price, stock, photo_path, hidden_by_admin) values (my_shop_id(), 'Sneaky', 100, 1, 'x/s.jpg', false);
\echo N6 owner hides a product: needs a reason; then it leaves the order page even if the vendor shows it (expect error, 2 then 1, 1, error):
reset role; select id as amouage from products where name like 'Amouage%' \gset
set role anon; reset request.jwt.claim.sub; select jsonb_array_length(get_storefront('rose')->'products');
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_hide_product(:'amouage', true, 'no'); select admin_hide_product(:'amouage', true, 'Looks counterfeit; send proof of supplier');
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111'; update products set active = true where id = :'amouage';
set role anon; reset request.jwt.claim.sub; select jsonb_array_length(get_storefront('rose')->'products');
set role authenticated; set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select place_order('rose', '{"name":"Z","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'amouage', 'qty', 1)));
set role anon; reset request.jwt.claim.sub;
\echo N7 vendor sees why it is hidden (expect t + reason):
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select hidden_by_admin, hidden_reason from products where id = :'amouage';
\echo N8 vendors cannot touch plans, settings or other owner tools (expect Not allowed x3, permission denied):
select admin_billing(); select admin_record_payment(:'s1', 0, 12); select admin_shop_detail(:'s1');
select * from settings;
\echo N8b with no price set, a run-out plan does not close the shop (expect open):
reset role; update shops set paid_until = now() - interval '10 days' where slug = 'rose';
set role anon; reset request.jwt.claim.sub; select case when get_storefront('rose') is null then 'closed' else 'open' end;
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo N9 plan runs out past the grace days: order page closes and it shows in Needs attention (expect closed, plan):
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_save_settings('{"monthly_price": 3000, "pay_bank": "Moniepoint", "pay_account_number": "70 1234 5678", "pay_account_name": "SHOPDESK EDEN", "admin_whatsapp": "08090000000"}');
reset role; update shops set paid_until = now() - interval '10 days' where slug = 'rose';
set role anon; reset request.jwt.claim.sub; select coalesce(get_storefront('rose')::text, 'closed');
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select x->>'kind' from jsonb_array_elements(admin_attention()) x where x->>'kind' = 'plan';
\echo N10 vendor sees their plan and where to pay (expect 3000, SHOPDESK EDEN, 7012345678, f):
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select my_plan()->>'monthly_price', my_plan()->>'pay_account_name', my_plan()->>'pay_account_number', my_plan()->>'open';
\echo N11 owner records 1 month: shop reopens, paid a month ahead, income counted (expect t, open, 3000, 3000):
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_record_payment(:'s1', 3000, 1, 'Transfer from Rose') > now() + interval '27 days';
set role anon; reset request.jwt.claim.sub; select case when get_storefront('rose') is null then 'closed' else 'open' end;
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select (select (m->>'income') from jsonb_array_elements(admin_billing()->'months') m order by m->>'month' desc limit 1), (select (s->>'paid_total') from jsonb_array_elements(admin_billing()->'shops') s where s->>'slug' = 'rose');
\echo N12 announcements: vendors see live ones; visitors cannot; ending one removes it (expect 1, permission denied, 0):
select admin_post_announcement('New: bank alerts', 'From Monday ShopDesk can read your OPay alerts.', 7);
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222'; select jsonb_array_length(get_announcements());
set role anon; reset request.jwt.claim.sub; select get_announcements();
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_end_announcement((select (a->>'id')::bigint from jsonb_array_elements(admin_announcements()) a limit 1));
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222'; select jsonb_array_length(get_announcements());
\echo N13 growth: 12 weeks, Rose is a top shop (expect 12, t):
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select jsonb_array_length(admin_growth()->'weeks'), (admin_growth()->'top_shops')::text like '%Rose Perfumes%';
\echo N14 shop page: products and history, no customer names or addresses from orders (expect 2, t, f, f):
select jsonb_array_length(admin_shop_detail(:'s1')->'products'), jsonb_array_length(admin_shop_detail(:'s1')->'log') > 3, admin_shop_detail(:'s1')::text like '%Bisi%', admin_shop_detail(:'s1')::text like '%Herbert Macaulay%';
\echo N15 visitors cannot open owner tools (expect permission denied):
set role anon; reset request.jwt.claim.sub; select admin_attention();

-- ===== order tracking and customer accounts =====
reset role; insert into auth.users values ('44444444-4444-4444-4444-444444444444', 'buyer@example.com'), ('55555555-5555-5555-5555-555555555555', 'other@example.com');
select id as tolu_p from products where name like 'Amouage%' \gset
reset role; update products set hidden_by_admin = false, stock = 20 where id = :'tolu_p';
\echo R1 order page and storefront no longer carry the shop WhatsApp (expect f f):
set role anon; reset request.jwt.claim.sub;
select (get_storefront('rose')->'shop') ? 'whatsapp', (get_order_public(:'tok')->'shop') ? 'whatsapp';
\echo R2 a signed-in customer orders: saved to their account and their details remembered (expect t, Bisi Ade, 1):
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select (place_order('rose', '{"name":"Bisi Ade","phone":"0802 000 1111","mode":"delivery","address":"12 Ojuelegba Road, Surulere"}', jsonb_build_array(jsonb_build_object('product_id', :'tolu_p', 'qty', 1))))->>'token' as tok3 \gset
select get_order_public(:'tok3')->>'mine'; select name from customers; select jsonb_array_length(my_orders());
\echo R3 nobody else sees that customer details: other customer, vendor (expect 0 0):
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555'; select count(*) from customers;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111'; select count(*) from customers;
\echo R4 vendor confirms: customer pays delivery so the fee is needed first (expect error, then confirmed t):
reset role; select id as o3 from orders where public_token = :'tok3' \gset
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select confirm_order(:o3); select set_delivery_fee(:o3, 1500);
set role anon; reset request.jwt.claim.sub; select get_order_public(:'tok3')->>'confirmed_at' is not null;
\echo R5 hand to rider before payment, without a number, with a past time (expect 3 errors):
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select hand_to_rider(:o3, 'Musa', '08031234567', now() + interval '3 hours');
select confirm_payment(:o3);
\o /dev/null
select pack_item(id, true) from order_items where order_id = :o3;
\o
select hand_to_rider(:o3, 'Musa', '', now() + interval '3 hours');
select hand_to_rider(:o3, 'Musa', '08031234567', now() - interval '1 day');
\echo R6 with the rider: customer sees rider, number and promised time; the shop cannot skip to delivered without a rider on other orders (expect out Musa 08031234567 t):
select hand_to_rider(:o3, 'Musa', '08031234567', now() + interval '3 hours');
set role anon; reset request.jwt.claim.sub;
select x->>'status', x->>'rider_name', x->>'rider_phone', x->>'deliver_by' is not null from (select get_order_public(:'tok3') x) y;
\echo R7 moving the promised time is logged (expect delivery_moved):
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select hand_to_rider(:o3, 'Musa', '08031234567', now() + interval '1 day');
reset role; select action from audit_log where action = 'delivery_moved' limit 1;
\echo R8 past the promised time it shows in Needs attention (expect late):
update orders set deliver_by = now() - interval '5 hours' where id = :o3;
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select x->>'kind' from jsonb_array_elements(admin_attention()) x where x->>'kind' = 'late';
\echo R9 customer confirms they got it; it cannot be confirmed twice (expect delivered customer, error):
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select customer_received(:'tok3'); select get_order_public(:'tok3')->>'status', get_order_public(:'tok3')->>'received_by';
select customer_received(:'tok3');
\echo R10 shop marks delivered, then the customer confirms too (expect shop, customer):
set role authenticated; set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select (place_order('rose', '{"name":"Kemi","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'tolu_p', 'qty', 1))))->>'token' as tok4 \gset
set role anon; reset request.jwt.claim.sub;
reset role; select id as o4 from orders where public_token = :'tok4' \gset
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select confirm_payment(:o4);
\o /dev/null
select pack_item(id, true) from order_items where order_id = :o4;
\o
select mark_ready(:o4, now() + interval '1 hour'); select advance_order(:o4);
set role authenticated; set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666'; select get_order_public(:'tok4')->>'received_by'; select customer_received(:'tok4'); select get_order_public(:'tok4')->>'received_by';
\echo R11 every order already belongs to the account that placed it; nobody else can take it (expect 0, 0, 1):
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select claim_orders(array[:'tok4']::uuid[]);
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555'; select claim_orders(array[:'tok4']::uuid[]);
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444'; select jsonb_array_length(my_orders());
\echo R12 visitors cannot list orders or claim them; customers can forget their saved details (expect permission denied x2, 0):
set role anon; reset request.jwt.claim.sub; select my_orders(); select claim_orders(array[:'tok4']::uuid[]);
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444'; delete from customers; select count(*) from customers;
\echo R13 a shop cannot take a ShopDesk page name as its link (expect check violation):
set role authenticated; set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
insert into shops (owner_id, name, slug) values (auth.uid(), 'Sneaky Orders', 'orders');
\echo R14 visitors who are not signed in cannot place an order (expect permission denied):
set role anon; reset request.jwt.claim.sub;
select place_order('rose', '{"name":"Guest","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'tolu_p', 'qty', 1)));
\echo R15 shop accounts cannot order, whether their shop is open (Rose) or turned down (Tunde) (expect 2 errors):
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select place_order('rose', '{"name":"Rose","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'tolu_p', 'qty', 1)));
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select place_order('rose', '{"name":"Tunde","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'tolu_p', 'qty', 1)));
\echo R16 shop accounts cannot claim orders or save customer details (expect 2 errors, then 0 saved):
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select claim_orders(array[:'tok4']::uuid[]);
insert into customers (user_id, name) values (auth.uid(), 'Rose');
reset role; select count(*) from customers where user_id = '11111111-1111-1111-1111-111111111111';
\echo R17 emails that have shopped cannot open a shop: one with orders, one with only saved details (expect 2 errors):
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
insert into shops (owner_id, name, slug) values (auth.uid(), 'Bisi Bags', 'bisibags');
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
insert into customers (user_id, name) values (auth.uid(), 'Ola');
insert into shops (owner_id, name, slug) values (auth.uid(), 'Ola Shoes', 'olashoes');
\echo R18 the app can ask what the account is: shop, customer (expect vendor t customer f, then vendor f customer t):
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111'; select my_account()->>'vendor', my_account()->>'customer';
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444'; select my_account()->>'vendor', my_account()->>'customer';
\echo R19 a brand-new email can still open a shop, and then it cannot order (expect f f, pending, error):
reset role; insert into auth.users values ('77777777-7777-7777-7777-777777777777', 'newvendor@example.com');
set role authenticated; set request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
select my_account()->>'vendor', my_account()->>'customer';
insert into shops (owner_id, name, slug) values (auth.uid(), 'Ade Gadgets', 'adegadgets'); select status from shops;
select place_order('rose', '{"name":"Ade","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'tolu_p', 'qty', 1)));
\echo R20 nobody can call the role checks directly, and visitors cannot ask what an account is (expect permission denied x3):
select has_shop('11111111-1111-1111-1111-111111111111'); select has_shopped('44444444-4444-4444-4444-444444444444');
set role anon; reset request.jwt.claim.sub; select my_account();
\echo R21 only the customer who placed an order can say they paid or got it: not a visitor with the link, not the shop, not another customer (expect 6 errors, then t, delivered customer):
set role authenticated; set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select (place_order('rose', '{"name":"Kemi","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'tolu_p', 'qty', 1))))->>'token' as tok5 \gset
set role anon; reset request.jwt.claim.sub; select customer_says_paid(:'tok5');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111'; select customer_says_paid(:'tok5');
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555'; select customer_says_paid(:'tok5');
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666'; select customer_says_paid(:'tok5'); select get_order_public(:'tok5')->>'customer_says_paid';
reset role; select id as o5 from orders where public_token = :'tok5' \gset
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111'; select confirm_payment(:o5) is not null;
\o /dev/null
select pack_item(id, true) from order_items where order_id = :o5;
\o
select mark_ready(:o5, now() + interval '1 hour');
select customer_received(:'tok5');
set role anon; reset request.jwt.claim.sub; select customer_received(:'tok5');
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444'; select customer_received(:'tok5');
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666'; select customer_received(:'tok5'); select get_order_public(:'tok5')->>'status', get_order_public(:'tok5')->>'received_by';
\echo R22 close for good: the shop page closes, and that email still cannot shop (expect banned, f, null, then 1 error):
reset role; select id as roseid from shops where slug = 'rose' \gset
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_set_shop_status(:'roseid', 'banned', 'Took money and never delivered, three reports');
reset role; select status, public.shop_open(s) from shops s where slug = 'rose';
set role anon; reset request.jwt.claim.sub; select get_storefront('rose');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select place_order('tolu', '{"name":"Rose","mode":"pickup"}', '[]');
\echo R23 delete is only for you, and only with the link name typed and a reason (expect 4 errors):
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111'; select admin_delete_shop(:'roseid', 'rose', 'my own shop please');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_delete_shop(:'roseid', 'roses', 'Vendor asked us to remove the shop');
select admin_delete_shop(:'roseid', 'rose', 'ok');
set role anon; reset request.jwt.claim.sub; select admin_delete_shop(:'roseid', 'rose', 'Vendor asked us to remove the shop');
\echo R24 delete removes the shop and everything that belongs to it, keeps a note in the log (expect counts, then 0 0 0 0 0 0 0, then a log line, f):
reset role;
select (select count(*) from products where shop_id = :'roseid') > 0 as had_products, (select count(*) from orders where shop_id = :'roseid') > 0 as had_orders,
  (select count(*) from payments where shop_id = :'roseid') > 0 as had_payments, (select count(*) from plan_payments where shop_id = :'roseid') > 0 as had_plan_payments;
select count(*) as items_before from order_items i join orders o on o.id = i.order_id where o.shop_id = :'roseid' \gset
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select (r->>'orders')::int > 0, (r->>'products')::int > 0, jsonb_typeof(r->'photos') from (select admin_delete_shop(:'roseid', ' ROSE ', 'Vendor asked us to remove the shop') r) x;
reset role;
select (select count(*) from shops where id = :'roseid'), (select count(*) from products where shop_id = :'roseid'), (select count(*) from orders where shop_id = :'roseid'),
  (select count(*) from payments where shop_id = :'roseid'), (select count(*) from reports where shop_id = :'roseid'), (select count(*) from plan_payments where shop_id = :'roseid'),
  (select count(*) from order_items i where not exists (select 1 from orders o where o.id = i.order_id));
select action, detail like 'Deleted Rose Perfumes (/rose, %Reason: Vendor asked us to remove the shop. Removed %' from audit_log where action = 'delete_shop';
select public.has_shop('11111111-1111-1111-1111-111111111111');
\echo R25 the admin log still shows the deletion after the shop is gone (expect 1):
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select count(*) from jsonb_array_elements(admin_audit_log()) a where a->>'action' = 'delete_shop' and a->>'detail' like 'Deleted Rose Perfumes%';
