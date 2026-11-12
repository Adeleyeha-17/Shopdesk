\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Ratings and Shops near you: one rating per customer per shop, only after a delivered order; everyone can read them.
reset role;
insert into auth.users values ('c7000000-0000-4000-8000-000000000001', 'starshop@example.com'), ('c7000000-0000-4000-8000-000000000002', 'rater@example.com'),
  ('c7000000-0000-4000-8000-000000000003', 'nosy@example.com') on conflict do nothing;
set role authenticated; set request.jwt.claim.sub = 'c7000000-0000-4000-8000-000000000001';
insert into shops (owner_id, name, slug, sells, location) values (auth.uid(), 'Star Bags', 'starbags', 'Bags and purses', 'Yaba, Lagos');
insert into products (shop_id, name, price, stock, photo_path) values (my_shop_id(), 'Tote bag', 5000, 10, 'x/tote.jpg');
reset role;
select id as tote from products where name = 'Tote bag' \gset
\echo R1 a shop waiting for approval is not in Shops near you (expect f):
set role anon; reset request.jwt.claim.sub;
select shops_near()::text like '%starbags%';
reset role; update shops set status = 'active' where slug = 'starbags';
\echo R2 once open, anyone sees it with what it sells, where it is, a photo and no rating yet:
set role anon;
select x->>'name', x->>'sells', x->>'location', x->>'photo_path', x->>'ratings', coalesce(x->>'rating', 'none')
  from jsonb_array_elements(shops_near()) x where x->>'slug' = 'starbags';
set role authenticated; set request.jwt.claim.sub = 'c7000000-0000-4000-8000-000000000002';
select place_order('starbags', '{"name":"Funmi Adebayo","phone":"08030000000","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'tote', 'qty', 1)))->>'token' as tok \gset
\echo R3 rating before delivery (expect error):
select rate_shop(:'tok', 5, 'Lovely');
reset role; update orders set status = 'delivered', done_at = now() where public_token = :'tok';
set role authenticated; set request.jwt.claim.sub = 'c7000000-0000-4000-8000-000000000003';
\echo R4 someone else rates with that order (expect error):
select rate_shop(:'tok', 1, 'Bad');
set request.jwt.claim.sub = 'c7000000-0000-4000-8000-000000000002';
\echo R5 six stars (expect error), then 4 stars with a comment:
select rate_shop(:'tok', 6, '');
select rate_shop(:'tok', 4, '  Neat bag, came on time  ') - 'comment', rate_shop(:'tok', 4, '  Neat bag, came on time  ')->>'comment';
\echo R6 what they gave, seen from their order:
select my_shop_rating(:'tok') - 'at';
\echo R7 changing it keeps one rating (expect 5, 1 rating):
select rate_shop(:'tok', 5, 'Even better the second time')->>'rating';
reset role; select count(*) || ' rating' from shop_ratings where customer_id = 'c7000000-0000-4000-8000-000000000002';
\echo R8 the shop owner was told:
select title, body, url from notifications where kind = 'rating' order by id desc limit 1;
\echo R9 nobody reads or writes the ratings table directly (expect permission denied twice):
set role authenticated; set request.jwt.claim.sub = 'c7000000-0000-4000-8000-000000000002';
select * from shop_ratings;
insert into shop_ratings (shop_id, customer_id, stars) select id, auth.uid(), 5 from shops limit 1;
\echo R10 the ratings page: average, stars, first name and initial, what they bought:
set role anon; reset request.jwt.claim.sub;
select r->>'rating', r->>'ratings', r->'stars'->>'5', x->>'who', x->>'stars', x->>'comment', x->>'bought'
  from shop_reviews('starbags') r, jsonb_array_elements(r->'reviews') x;
\echo R11 the shop page shows the rating too:
select get_storefront('starbags')->'shop'->>'rating', get_storefront('starbags')->'shop'->>'ratings';
\echo R12 a rating ShopDesk hides stops counting:
reset role; update shop_ratings set hidden_by_admin = true where shop_id = (select id from shops where slug = 'starbags');
set role anon;
select coalesce(get_storefront('starbags')->'shop'->>'rating', 'none'), jsonb_array_length(shop_reviews('starbags')->'reviews');
\echo R13 names are shortened:
reset role; select short_name('Funmi Adebayo'), short_name('  tobi   kunle  ade '), short_name('Ngozi'), short_name('');
