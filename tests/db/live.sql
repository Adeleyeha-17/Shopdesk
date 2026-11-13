\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Live tracking: the shop's own rider shares their location from a private link; the customer and the shop see it.
reset role;
insert into auth.users values ('c4000000-0000-4000-8000-000000000001', 'liveshop@example.com'), ('c4000000-0000-4000-8000-000000000002', 'livebuyer@example.com'),
  ('c4000000-0000-4000-8000-000000000003', 'othershop@example.com') on conflict do nothing;
insert into shops (owner_id, name, slug, sells, location, status, reviewed_at, paid_until) values
  ('c4000000-0000-4000-8000-000000000001', 'Live Cakes', 'livecakes', 'Cakes', 'Yaba, Lagos', 'active', now(), now() + interval '30 days'),
  ('c4000000-0000-4000-8000-000000000003', 'Other Cakes', 'othercakes', 'Cakes', 'Yaba, Lagos', 'active', now(), now() + interval '30 days');
insert into products (shop_id, name, price, stock, photo_path) select id, 'Cake', 9000, 10, 'x/cake.jpg' from shops where slug = 'livecakes';
select id as cake from products where name = 'Cake' and shop_id = (select id from shops where slug = 'livecakes') \gset
set role authenticated; set request.jwt.claim.sub = 'c4000000-0000-4000-8000-000000000002';
select place_order('livecakes', '{"name":"Funmi Adebayo","phone":"08030000000","mode":"delivery","address":"4 Admiralty Way, Lekki Phase 1","area":"Lekki Phase 1"}',
  jsonb_build_array(jsonb_build_object('product_id', :'cake', 'qty', 1)))->>'token' as tok \gset
reset role; select id as oid from orders where public_token = :'tok' \gset
set role authenticated; set request.jwt.claim.sub = 'c4000000-0000-4000-8000-000000000001';
select set_delivery_fee(:oid, 1500) \g /dev/null
select confirm_payment(:oid) \g /dev/null
\echo L1 no rider link before the order goes out (expect an error):
select rider_link(:oid);
reset role; update order_items set packed = true where order_id = :oid;
set role authenticated; set request.jwt.claim.sub = 'c4000000-0000-4000-8000-000000000001';
select hand_to_rider(:oid, 'Musa', '08031234567', now() + interval '3 hours') \g /dev/null
\echo L2 another shop cannot get the link; this shop can, and gets the same one twice (expect an error, then t):
set request.jwt.claim.sub = 'c4000000-0000-4000-8000-000000000003';
select rider_link(:oid);
set request.jwt.claim.sub = 'c4000000-0000-4000-8000-000000000001';
select rider_link(:oid) as rt \gset
select rider_link(:oid) = :'rt';
\echo L3 the rider page shows the job; nothing is shared yet, so the customer sees no map (expect the job, then sharing false):
set role anon; reset request.jwt.claim.sub;
select j->>'shop', j->>'customer', j->>'address', j->>'rider', j->>'done' from rider_job(:'rt') j;
select order_live(:'tok')->>'sharing';
\echo L4 the rider shares; the customer and the shop see where (expect t, then 6.5|3.4|Musa twice):
select rider_ping(:'rt', 6.5, 3.4, 20);
select l->>'lat', l->>'lng', l->>'rider' from order_live(:'tok') l;
set role authenticated; set request.jwt.claim.sub = 'c4000000-0000-4000-8000-000000000001';
select l->>'lat', l->>'lng', l->>'rider' from order_live(null, :oid) l;
\echo L5 another shop sees nothing; a wrong link does nothing (expect null, f):
set request.jwt.claim.sub = 'c4000000-0000-4000-8000-000000000003';
select coalesce(order_live(null, :oid)::text, 'null');
set role anon; reset request.jwt.claim.sub;
select rider_ping('00000000-0000-4000-8000-000000000000', 6.5, 3.4);
\echo L6 once delivered, the rider page says done and sharing stops (expect delivered, f, null):
set role authenticated; set request.jwt.claim.sub = 'c4000000-0000-4000-8000-000000000001';
select advance_order(:oid) \g /dev/null
set role anon; reset request.jwt.claim.sub;
select rider_job(:'rt')->>'status';
select rider_ping(:'rt', 6.6, 3.5);
select coalesce(order_live(:'tok')::text, 'null');
\echo L7 nobody reads positions directly (expect permission denied):
select * from rider_spots;
reset role;
