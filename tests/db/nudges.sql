\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Nudges that bring shops back: orders waiting, nothing for sale, gone quiet. Spaced out, limited, only at sensible hours.
reset role;
insert into auth.users values ('c5000000-0000-4000-8000-000000000001', 'busyshop@example.com'), ('c5000000-0000-4000-8000-000000000002', 'emptyshop@example.com'),
  ('c5000000-0000-4000-8000-000000000003', 'quietshop@example.com'), ('c5000000-0000-4000-8000-000000000004', 'nudgebuyer@example.com'),
  ('c5000000-0000-4000-8000-000000000009', 'nudgeboss@example.com') on conflict do nothing;
insert into admins values ('c5000000-0000-4000-8000-000000000009') on conflict do nothing;
insert into shops (owner_id, name, slug, sells, location, status, reviewed_at, paid_until) values
  ('c5000000-0000-4000-8000-000000000001', 'Busy Bags', 'busybags', 'Bags', 'Yaba, Lagos', 'active', now() - interval '10 days', now() + interval '30 days'),
  ('c5000000-0000-4000-8000-000000000002', 'Empty Wigs', 'emptywigs', 'Wigs', 'Ikeja, Lagos', 'active', now() - interval '2 days', now() + interval '30 days'),
  ('c5000000-0000-4000-8000-000000000003', 'Quiet Shoes', 'quietshoes', 'Shoes', 'Lekki, Lagos', 'active', now() - interval '30 days', now() + interval '30 days');
insert into products (shop_id, name, price, stock, photo_path) select id, 'Bag', 5000, 10, 'x/bag.jpg' from shops where slug = 'busybags';
insert into products (shop_id, name, price, stock, photo_path) select id, 'Shoe', 8000, 10, 'x/shoe.jpg' from shops where slug = 'quietshoes';
select id as bag from products where name = 'Bag' and shop_id = (select id from shops where slug = 'busybags') \gset
set role authenticated; set request.jwt.claim.sub = 'c5000000-0000-4000-8000-000000000004';
select place_order('busybags', '{"name":"Bola","phone":"08035556666","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'bag', 'qty', 1))) is not null from generate_series(1, 2) \g /dev/null
reset role;
update orders set created_at = now() - interval '5 hours' where shop_id = (select id from shops where slug = 'busybags');
update shops set last_active_at = now() - interval '6 hours' where slug = 'busybags';
update shops set last_active_at = now() - interval '2 days' where slug = 'emptywigs';
update shops set last_active_at = now() - interval '9 days' where slug = 'quietshoes';
delete from notifications where user_id::text like 'c5000000%';
\echo U1 at 2am nothing goes out (expect 0):
select nudge_shops(2);
\echo U2 at noon: the busy shop hears about 2 orders waiting, the empty shop to add a product, the quiet shop to share its link (expect 3 and the three alerts):
select nudge_shops(12);
select s.slug, n.title, n.url from notifications n join shops s on s.owner_id = n.user_id where n.user_id::text like 'c5000000%' and n.kind = 'nudge' order by s.slug;
\echo U3 an hour later, nothing new (expect 0):
select nudge_shops(13);
\echo U4 a shop that opens ShopDesk is not nudged about waiting orders (expect 0 waiting nudges after the time limit passes):
update shop_nudges set sent_at = sent_at - interval '1 day' where kind = 'orders_waiting';
update shops set last_active_at = now() where slug = 'busybags';
select nudge_shops(12) >= 0;
select count(*) from shop_nudges sn join shops s on s.id = sn.shop_id where s.slug = 'busybags' and sn.sent_at > now() - interval '1 hour';
\echo U5 the empty shop is reminded at most 3 times, 2 days apart (expect 3):
update shop_nudges set sent_at = sent_at - interval '3 days' where kind = 'no_products'; select nudge_shops(12) \g /dev/null
update shop_nudges set sent_at = sent_at - interval '3 days' where kind = 'no_products'; select nudge_shops(12) \g /dev/null
update shop_nudges set sent_at = sent_at - interval '3 days' where kind = 'no_products'; select nudge_shops(12) \g /dev/null
select count(*) from shop_nudges sn join shops s on s.id = sn.shop_id where s.slug = 'emptywigs';
\echo U6 Admin sees the quiet shop in Needs attention, level 3 (expect the text):
set role authenticated; set request.jwt.claim.sub = 'c5000000-0000-4000-8000-000000000009';
select x->>'level', x->>'text' from jsonb_array_elements(admin_attention()) x where x->>'kind' = 'quiet' and x->>'slug' = 'quietshoes';
\echo U7 shops cannot run nudges or read them (expect permission denied twice):
select nudge_shops(12);
select * from shop_nudges;
reset role;
