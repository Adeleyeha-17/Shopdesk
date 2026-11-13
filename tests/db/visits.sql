\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Shops hear when someone looks at their shop (at most every 2 hours, in the day); the Sales tab counts visitors.
-- And every order is paid in full: shops cannot switch part payments on.
reset role;
insert into auth.users values ('c3000000-0000-4000-8000-000000000001', 'seenshop@example.com'), ('c3000000-0000-4000-8000-000000000002', 'looker@example.com') on conflict do nothing;
insert into shops (owner_id, name, slug, sells, location, status, reviewed_at) values
  ('c3000000-0000-4000-8000-000000000001', 'Seen Shoes', 'seenshoes', 'Shoes', 'Yaba, Lagos', 'active', now());
\echo V1 a visitor at noon: counted, and the shop is told (expect t, then the alert):
set role anon; select note_visit('seenshoes', 'visitor-aaaa-1111', 12);
reset role; select title || '|' || body || '|' || url from notifications where user_id = 'c3000000-0000-4000-8000-000000000001' and kind = 'visit';
\echo V2 the same visitor again, and a second visitor within 2 hours: counted once each, no new alert (expect f, f, 1 alert):
set role anon; select note_visit('seenshoes', 'visitor-aaaa-1111', 12); select note_visit('seenshoes', 'visitor-bbbb-2222', 13);
reset role; select count(*) from notifications where user_id = 'c3000000-0000-4000-8000-000000000001' and kind = 'visit';
\echo V3 the owner looking at their own shop does not count; at night nobody is woken (expect f, f):
set role authenticated; set request.jwt.claim.sub = 'c3000000-0000-4000-8000-000000000001'; select note_visit('seenshoes', 'whatever-owner-id', 12);
reset role; update notifications set created_at = now() - interval '3 hours' where user_id = 'c3000000-0000-4000-8000-000000000001' and kind = 'visit';
set role anon; reset request.jwt.claim.sub; select note_visit('seenshoes', 'visitor-cccc-3333', 23);
\echo V4 a signed-in visitor counts as one person, and in the day the shop is told again with the count (expect t, the alert with 4 people):
set role authenticated; set request.jwt.claim.sub = 'c3000000-0000-4000-8000-000000000002'; select note_visit('seenshoes', 'device-dddd-4444', 15);
reset role; select body from notifications where user_id = 'c3000000-0000-4000-8000-000000000001' and kind = 'visit' order by id desc limit 1;
\echo V5 the shop sees its numbers; others see nothing; nobody reads visits directly (expect 4|4, then 0|0, then permission denied):
set role authenticated; set request.jwt.claim.sub = 'c3000000-0000-4000-8000-000000000001';
select my_visits()->>'today', my_visits()->>'week';
set request.jwt.claim.sub = 'c3000000-0000-4000-8000-000000000002';
select coalesce(my_visits()->>'today', '0') || '|' || coalesce(my_visits()->>'week', '0');
select * from shop_visits;
\echo V6 every order is paid in full: a shop cannot switch part payments on (expect permission denied):
set request.jwt.claim.sub = 'c3000000-0000-4000-8000-000000000001';
update shops set allow_part_payment = true;
reset role;
