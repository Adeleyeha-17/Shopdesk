\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Invites: a shop's invite link brings a new shop; when that shop pays its first month, both get free months (only while invites are on).
reset role;
insert into auth.users values ('c8000000-0000-4000-8000-000000000001', 'inviter@example.com'), ('c8000000-0000-4000-8000-000000000002', 'invited@example.com'),
  ('c8000000-0000-4000-8000-000000000003', 'late@example.com'), ('c8000000-0000-4000-8000-000000000009', 'boss@example.com') on conflict do nothing;
insert into admins values ('c8000000-0000-4000-8000-000000000009') on conflict do nothing;
set role authenticated; set request.jwt.claim.sub = 'c8000000-0000-4000-8000-000000000001';
insert into shops (owner_id, name, slug, sells, location) values (auth.uid(), 'Inviter Wigs', 'inviterwigs', 'Wigs', 'Yaba, Lagos');
reset role; update shops set status = 'active', paid_until = '2030-01-15' where slug = 'inviterwigs';
set role authenticated; set request.jwt.claim.sub = 'c8000000-0000-4000-8000-000000000002';
insert into shops (owner_id, name, slug, sells, location) values (auth.uid(), 'Invited Bags', 'invitedbags', 'Bags', 'Ikeja');
\echo I1 a new shop claims an unknown link, its own link, then the inviter link (expect f f t), then again (expect f):
select claim_invite('nosuchshop'), claim_invite('invitedbags'), claim_invite('inviterwigs');
select claim_invite('inviterwigs');
\echo I2 the shop owner cannot set who invited them (expect permission denied):
update shops set invited_by = null;
\echo I3 with invites off the Shop tab shows nothing (expect empty):
set request.jwt.claim.sub = 'c8000000-0000-4000-8000-000000000001';
select coalesce(my_invites()::text, '');
\echo I4 only Admin sees invites or switches them on (expect Not allowed twice):
select admin_invites();
select admin_save_settings('{"invites_on": true}');
set request.jwt.claim.sub = 'c8000000-0000-4000-8000-000000000009';
select admin_save_settings('{"invites_on": true, "invite_months": 1, "invited_months": 2}');
\echo I5 the Shop tab of the inviter: on, its link, the reward, and the shop waiting for approval:
set request.jwt.claim.sub = 'c8000000-0000-4000-8000-000000000001';
select m->>'on', m->>'slug', m->>'months', m->>'new_months', m->>'rewarded', x->>'name', x->>'state' from my_invites() m, jsonb_array_elements(m->'shops') x;
\echo I6 approved and paid: the invited shop gets 1 paid + 2 free months, the inviter 1 free month (expect 3 months, t):
reset role; update shops set status = 'active', reviewed_at = now(), paid_until = null where slug = 'invitedbags';
select id as bags from shops where slug = 'invitedbags' \gset
set role authenticated; set request.jwt.claim.sub = 'c8000000-0000-4000-8000-000000000009';
select admin_record_payment(:'bags', 5000, 1) is not null;
reset role;
select (select round(extract(epoch from paid_until - now()) / 86400 / 30) from shops where slug = 'invitedbags') || ' months',
  (select paid_until = '2030-02-15'::timestamptz from shops where slug = 'inviterwigs');
\echo I7 both were told:
select string_agg(title || ' | ' || regexp_replace(body, '[0-9]{1,2} [A-Z][a-z]+ [0-9]{4}', '(a date)'), E'\n' order by id) from notifications where kind like 'invite%' and user_id in ('c8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000002');
\echo I8 a second payment gives no second reward (expect t):
set role authenticated; set request.jwt.claim.sub = 'c8000000-0000-4000-8000-000000000009';
select admin_record_payment(:'bags', 5000, 1) is not null;
reset role; select paid_until = '2030-02-15'::timestamptz from shops where slug = 'inviterwigs';
\echo I9 Admin sees the invite, paid and rewarded:
set role authenticated; set request.jwt.claim.sub = 'c8000000-0000-4000-8000-000000000009';
select x->>'name', x->>'by', x->>'status', x->>'paid', (x->>'rewarded_at') is not null from admin_invites() a, jsonb_array_elements(a->'rows') x;
\echo I10 with invites switched off, the payment of an invited shop gives nothing (expect t, f, t):
select admin_save_settings('{"invites_on": false}');
set request.jwt.claim.sub = 'c8000000-0000-4000-8000-000000000003';
insert into shops (owner_id, name, slug) values (auth.uid(), 'Late Shoes', 'lateshoes');
select claim_invite('inviterwigs');
reset role; update shops set status = 'active', reviewed_at = now() where slug = 'lateshoes';
select id as shoes from shops where slug = 'lateshoes' \gset
set role authenticated; set request.jwt.claim.sub = 'c8000000-0000-4000-8000-000000000009';
select admin_record_payment(:'shoes', 5000, 1) is not null;
reset role; select invite_rewarded_at is not null from shops where slug = 'lateshoes'; select paid_until = '2030-02-15'::timestamptz from shops where slug = 'inviterwigs';
\echo I11 an approved shop cannot claim an invite later (expect f):
reset role; update shops set invited_by = null where slug = 'lateshoes';
set role authenticated; set request.jwt.claim.sub = 'c8000000-0000-4000-8000-000000000003';
select claim_invite('inviterwigs');
