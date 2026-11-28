\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Shop news: following shops, announcements to followers and past customers, the feed.
reset role;
insert into auth.users values ('f0110000-0000-4000-8000-000000000001', 'ngozi@example.com'), ('f0110000-0000-4000-8000-000000000002', 'bayo@example.com'),
  ('f0110000-0000-4000-8000-000000000003', 'sade@example.com'), ('f0110000-0000-4000-8000-000000000004', 'chuka@example.com') on conflict do nothing;
insert into shops (owner_id, name, slug, sells, location, status, reviewed_at, bank, account_number, account_name, delivery_paid_by) values
  ('f0110000-0000-4000-8000-000000000001', 'Ngozi Hair', 'ngozihair', 'Hair', 'Ikeja, Lagos', 'active', now(), 'OPay', '0123456784', 'NGOZI H', 'vendor');
select id || '/' as pic from shops where slug = 'ngozihair' \gset
set role authenticated; set request.jwt.claim.sub = 'f0110000-0000-4000-8000-000000000001';
select save_product(null, jsonb_build_object('name', 'Bone straight wig', 'photo_path', :'pic' || 'w.jpg', 'price', 80000, 'stock', 5)) as wig \gset
select save_product(null, jsonb_build_object('name', 'Edge control', 'photo_path', :'pic' || 'e.jpg', 'price', 3000, 'stock', 40)) as edge \gset
select save_coupon(null, 'HAIR10', 'percent', 10, 0, null, null, true) as code \gset

\echo N1 Bayo orders, so he hears the shop news; Sade follows; Chuka does neither (expect t 2, t 2, f 2):
set request.jwt.claim.sub = 'f0110000-0000-4000-8000-000000000002';
select place_order('ngozihair', '{"name":"Bayo","phone":"08031234567","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'edge', 'qty', 1))) is not null;
set request.jwt.claim.sub = 'f0110000-0000-4000-8000-000000000003';
select f->>'following', f->>'followers' from follow_shop('ngozihair', true) f;
set request.jwt.claim.sub = 'f0110000-0000-4000-8000-000000000002';
select f->>'following', f->>'followers' from shop_follow('ngozihair') f;
set request.jwt.claim.sub = 'f0110000-0000-4000-8000-000000000004';
select f->>'following', f->>'followers' from shop_follow('ngozihair') f;

\echo N2 the owner can't follow their own shop, and signed-out people can't follow (expect 2 errors):
set request.jwt.claim.sub = 'f0110000-0000-4000-8000-000000000001';
select follow_shop('ngozihair', true);
set request.jwt.claim.sub = '';
select follow_shop('ngozihair', true);

\echo N3 the shop sees who will hear its news, then announces: bad posts get a plain reason (expect 2, then 4 errors):
set request.jwt.claim.sub = 'f0110000-0000-4000-8000-000000000001';
select my_news()->>'audience';
select post_news('party', '', array[:'wig']::uuid[], null, null);
select post_news('sale', '', array[]::uuid[], null, null);
select post_news('sale', 'Call 08031234567 to order', array[:'wig']::uuid[], null, null);
select post_news('sale', '', array[:'wig']::uuid[], null, current_date - 1);

\echo N4 a Black Friday announcement with a code reaches both, as a phone alert (expect the line, 2, then 2 alerts):
select n->>'line', n->>'sent' from post_news('black_friday', 'This weekend only.', array[:'wig', :'edge']::uuid[], :'code', null) n;
reset role;
select count(*) from notifications where kind = 'shop_news' and url = '/ngozihair'
  and user_id in ('f0110000-0000-4000-8000-000000000002', 'f0110000-0000-4000-8000-000000000003') and body like 'Black Friday: 10% off with code HAIR10. This weekend only.';

\echo N5 one announcement a day (expect an error):
set role authenticated; set request.jwt.claim.sub = 'f0110000-0000-4000-8000-000000000001';
select post_news('new', '', array[:'wig']::uuid[], null, null);

\echo N6 the news shows on the shop page for anyone, and in the feeds of the two who hear it, not for Chuka (expect the line twice, 1, 1, 0):
set role anon; set request.jwt.claim.sub = '';
select shop_follow('ngozihair')->'news'->>'line';
set role authenticated;
set request.jwt.claim.sub = 'f0110000-0000-4000-8000-000000000003';
select my_feed()->0->>'line';
select jsonb_array_length(my_feed());
set request.jwt.claim.sub = 'f0110000-0000-4000-8000-000000000002';
select jsonb_array_length(my_feed());
set request.jwt.claim.sub = 'f0110000-0000-4000-8000-000000000004';
select jsonb_array_length(my_feed());

\echo N7 Bayo unfollows: he stops hearing the shop even though he ordered (expect f 1, then 0 in his feed):
set request.jwt.claim.sub = 'f0110000-0000-4000-8000-000000000002';
select f->>'following', f->>'followers' from follow_shop('ngozihair', false) f;
select jsonb_array_length(my_feed());

\echo N9 Shops near you says the shop is on sale and new this week (expect 10% OFF and true):
set role anon; set request.jwt.claim.sub = '';
select x->>'deal', x->>'fresh' from jsonb_array_elements(shops_near()) x where x->>'slug' = 'ngozihair';
set role authenticated;

\echo N8 nobody reads the tables directly (expect permission denied twice):
select * from shop_news;
select * from shop_follows;
reset role;
