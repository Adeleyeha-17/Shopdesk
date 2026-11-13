\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Pay online and ShopDesk Delivery. The money server function connects as the database owner and says who is asking
-- (request.jwt.claim.sub), so these steps do the same.
reset role;
insert into auth.users values ('c9000000-0000-4000-8000-000000000001', 'moneyshop@example.com'), ('c9000000-0000-4000-8000-000000000002', 'payer@example.com'),
  ('c9000000-0000-4000-8000-000000000003', 'stranger@example.com'), ('c9000000-0000-4000-8000-000000000009', 'moneyboss@example.com') on conflict do nothing;
insert into admins values ('c9000000-0000-4000-8000-000000000009') on conflict do nothing;
set role authenticated; set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location)
  values (auth.uid(), 'Money Bags', 'moneybags', 'OPay', '0123456789', 'MONEY BAGS', '08031112222', 'Bags', 'Yaba, Lagos');
insert into products (shop_id, name, price, stock, photo_path) values (my_shop_id(), 'Leather bag', 10000, 10, 'x/bag.jpg');
\echo M1 the shop sets its pickup address, but not the checked address code (expect permission denied once):
update shops set pickup_address = '5 Herbert Macaulay Way, Yaba, Lagos';
update shops set pickup_code = 123;
reset role; update shops set status = 'active' where slug = 'moneybags';
select id as bag from products where name = 'Leather bag' \gset
set role authenticated; set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';
select place_order('moneybags', '{"name":"Ada Obi","phone":"08035556666","mode":"delivery","address":"12 Adeola Odeku Street, Victoria Island","area":"Victoria Island"}',
  jsonb_build_array(jsonb_build_object('product_id', :'bag', 'qty', 2)))->>'token' as tok \gset
reset role; select id as oid from orders where public_token = :'tok' \gset
\echo M2 both are off at first, and the shop cannot get courier prices yet (expect f f, then an error):
set role anon; select money_switches()->>'online', money_switches()->>'delivery';
reset role; set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select money_quote_info(:oid);
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000009';
select admin_save_settings('{"online_pay_on": true, "delivery_on": true, "delivery_margin": 200}');
\echo M3 now the shop gets what the courier service needs; someone else cannot (expect Order not found):
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select q->'shop'->>'pickup_address', q->'shop'->>'email', q->'order'->>'area', jsonb_array_length(q->'items'), q->>'margin' from money_quote_info(:oid) q;
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000003';
select money_quote_info(:oid);
\echo M4 the prices are kept on the order; a courier not on the list is refused, a listed one sets the fee:
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select money_save_quotes(:oid, '[{"courier_id":"dellyman","service_code":"dellyman","name":"Dellyman","cost":1800,"price":2200,"eta":"2030-01-02T12:00:00Z","token":"tok1"}]');
select money_pick_quote(:oid, 'madeup', 'madeup');
select money_pick_quote(:oid, 'dellyman', 'dellyman')->>'name';
reset role; select delivery_fee, delivery_by, confirmed_at is not null from orders where id = :oid;
\echo M5 the order page: it can be paid online, with ShopDesk Delivery, and the customer sees the card fee on top (expect 440):
set role anon; select m->>'online', m->>'delivery_by', m->>'courier', coalesce(m->>'shipment', 'none'), m->>'fee' from order_money(:'tok') m;
\echo M6 only the customer can start paying; they pay goods and delivery plus the card fee, and the delivery part goes to ShopDesk (expect an error, then 22200, 2200 and 440):
reset role; set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000003';
select money_start_payment(:'tok', 'SDTEST-0001');
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';
select r->>'amount', r->>'delivery_part', r->>'fee', r->>'email', r->'shop'->>'bank' from money_start_payment(:'tok', 'SDTEST-0002') r;
\echo M7 too little is refused, and so is the amount without the card fee; the right amount marks the order paid with what was due, once (expect two errors, then 22200, then already):
select money_paid('SDTEST-0002', 100);
select money_paid('SDTEST-0002', 2220000);
select money_paid('SDTEST-0002', 2264000)->>'credited';
select money_paid('SDTEST-0002', 2264000)->>'already';
reset role; select status, amount_paid, (select method from payments where order_id = :oid) from orders where id = :oid;
\echo M8 booking needs every item packed; then the order goes out with the courier:
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select money_book_info(:oid);
reset role; update order_items set packed = true where order_id = :oid;
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select (money_book_info(:oid))->'quote'->>'courier_id';
select money_save_shipment(:oid, '{"sb_order":"SB-TEST1","courier":"Dellyman","courier_phone":"08000000000","status":"pending","tracking_url":"https://example.com/t/1","cost":1800,"eta":"2030-01-02T12:00:00Z"}');
reset role; select o.status, o.rider_name, sh.paid_online, sh.price, sh.cost from orders o join shipments sh on sh.order_id = o.id where o.id = :oid;
\echo M9 booking twice is refused:
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select money_book_info(:oid);
\echo M10 the courier picks it up, then delivers it; the order is delivered and the customer is asked to confirm:
reset role;
select money_ship_update('SB-TEST1', '{"status":"picked_up","steps":[{"status":"Picked up","at":"2030-01-01T10:00:00Z"}]}')->>'status';
select money_ship_update('SB-TEST1', '{"status":"completed"}')->>'status';
select o.status, o.received_by, sh.status from orders o join shipments sh on sh.order_id = o.id where o.id = :oid;
select money_ship_update('SB-NOPE', '{"status":"completed"}')->>'found';
\echo M11 the order page shows the delivery:
set role anon; select m->'shipment'->>'courier', m->'shipment'->>'status', m->'shipment'->>'tracking_url', m->>'online' from order_money(:'tok') m;
\echo M12 a second order paid to the shop by transfer: the delivery goes on the delivery bill of the shop, until Admin marks it paid:
reset role; set role authenticated; set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';
select place_order('moneybags', '{"name":"Ada Obi","phone":"08035556666","mode":"delivery","address":"12 Adeola Odeku Street, Victoria Island","area":"Victoria Island"}',
  jsonb_build_array(jsonb_build_object('product_id', :'bag', 'qty', 1)))->>'token' as tok2 \gset
reset role; select id as oid2 from orders where public_token = :'tok2' \gset
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select money_save_quotes(:oid2, '[{"courier_id":"gig","service_code":"gig-std","name":"GIG","cost":3000,"price":3400,"eta":null,"token":"tok2"}]');
select money_pick_quote(:oid2, 'gig', 'gig-std')->>'price';
set role authenticated; select confirm_payment(:oid2) is not null;
reset role; update order_items set packed = true where order_id = :oid2;
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select money_save_shipment(:oid2, '{"sb_order":"SB-TEST2","courier":"GIG","status":"pending","cost":3000}');
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000009';
select x->>'shop', x->>'owed', x->>'deliveries' from jsonb_array_elements(admin_money()->'owed') x where x->>'shop' = 'Money Bags';
select admin_money()->'online'->>'delivery';
select admin_delivery_paid((select id from shops where slug = 'moneybags'));
select count(*) from jsonb_array_elements(admin_money()->'owed') x where x->>'shop' = 'Money Bags';
\echo M13 a cancelled courier puts the order back to paid so the shop can book again:
select money_ship_update('SB-TEST2', '{"status":"cancelled"}')->>'status';
select o.status, (select count(*) from shipments where order_id = :oid2) from orders o where o.id = :oid2;
\echo M15 typing a fee means the shop rider takes it; once the customer paid ShopDesk for delivery, the shop cannot switch to its own rider:
reset role; set role authenticated; set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';
select place_order('moneybags', '{"name":"Ada Obi","phone":"08035556666","mode":"delivery","address":"12 Adeola Odeku Street, Victoria Island","area":"Victoria Island"}',
  jsonb_build_array(jsonb_build_object('product_id', :'bag', 'qty', 1)))->>'token' as tok3 \gset
reset role; select id as oid3 from orders where public_token = :'tok3' \gset
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select money_save_quotes(:oid3, '[{"courier_id":"gig","service_code":"gig-std","name":"GIG","cost":3000,"price":3400,"eta":null,"token":"tok3"}]');
select money_pick_quote(:oid3, 'gig', 'gig-std')->>'price';
set role authenticated; select set_delivery_fee(:oid3, 1500);
reset role; select delivery_fee, delivery_by, coalesce(delivery_quote->>'name', 'none') from orders where id = :oid3;
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select money_pick_quote(:oid3, 'gig', 'gig-std')->>'price';
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';
select money_start_payment(:'tok3', 'SDTEST-0003')->>'delivery_part';
select money_paid('SDTEST-0003', 1370600)->>'credited';
set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000001';
select money_own_rider(:oid3);
\echo M14 nobody calls the payment steps from the app directly (expect permission denied):
set role authenticated; set request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';
select money_paid('SDTEST-0002', 2264000);
select * from online_payments;
reset role;
select admin_save_settings('{"online_pay_on": false, "delivery_on": false}') from (select set_config('request.jwt.claim.sub', 'c9000000-0000-4000-8000-000000000009', false)) x;
