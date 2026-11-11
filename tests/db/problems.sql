\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Order codes, packing checklist, packing photo, problems and order photos. Runs after tests.sql in the same database.
reset role;
insert into auth.users values ('aaaaaaaa-0000-4000-8000-000000000001', 'kemi@example.com'), ('aaaaaaaa-0000-4000-8000-000000000002', 'ola@example.com'),
  ('cccccccc-0000-4000-8000-000000000001', 'c1@example.com'), ('cccccccc-0000-4000-8000-000000000002', 'c2@example.com') on conflict do nothing;
insert into admins values ('33333333-3333-3333-3333-333333333333') on conflict do nothing;
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location) values (auth.uid(), 'Kemi''s Kitchen Store', 'kemi', 'OPay', '0123456789', 'KEMI A', '08000000000', 'Pots and pans', 'Ikeja');
insert into products (shop_id, name, price, stock, photo_path) values (my_shop_id(), 'Frying pan', 8000, 20, 'x/pan.jpg'), (my_shop_id(), 'Pot set', 15000, 20, 'x/pot.jpg');
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000002';
insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location) values (auth.uid(), 'Ola Shoes', 'olashoes', 'OPay', '0123456780', 'OLA B', '08000000001', 'Shoes', 'Yaba');
reset role; update shops set status = 'active' where slug in ('kemi', 'olashoes');
select id as pan from products where name = 'Frying pan' \gset
select id as pot from products where name = 'Pot set' \gset

\echo P1 a new shop gets its initials for order codes, and the vendor can’t change them (expect KK OS, then permission denied):
select string_agg(order_prefix, ' ' order by slug) from shops where slug in ('kemi', 'olashoes');
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
update shops set order_prefix = 'ZZ';

-- customer 1 orders twice, customer 2 once
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001';
select place_order('kemi', '{"name":"Chioma","phone":"08011112222","mode":"delivery","address":"12 Allen Avenue"}', jsonb_build_array(jsonb_build_object('product_id', :'pan', 'qty', 1), jsonb_build_object('product_id', :'pot', 'qty', 1)))->>'token' as t1 \gset
select place_order('kemi', '{"name":"Chioma","phone":"08011112222","mode":"delivery","address":"12 Allen Avenue"}', jsonb_build_array(jsonb_build_object('product_id', :'pan', 'qty', 2)))->>'token' as t2 \gset
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000002';
select place_order('kemi', '{"name":"Tunde","phone":"08033334444","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'pot', 'qty', 1)))->>'token' as t3 \gset
reset role;
select id as o1 from orders where public_token = :'t1' \gset
select id as o2 from orders where public_token = :'t2' \gset
select id as o3 from orders where public_token = :'t3' \gset
\echo P2 the order page and My orders show the code (expect t t):
set role anon; reset request.jwt.claim.sub;
select get_order_public(:'t1')->>'code' = 'KK-' || :o1;
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001';
select (select count(*) from jsonb_array_elements(my_orders()) x where x->>'code' = 'KK-' || :o1) = 1;

\echo P3 packing: can’t send before every item is ticked; another shop can’t tick; then it goes (expect 3 errors, then out):
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
select set_delivery_fee(:o1, 2000); select confirm_payment(:o1) is not null;
select hand_to_rider(:o1, 'Musa', '08031234567', now() + interval '3 hours');
select id as i1 from order_items where order_id = :o1 order by id limit 1 \gset
select id as i2 from order_items where order_id = :o1 order by id desc limit 1 \gset
\o /dev/null
select pack_item(:i1, true);
\o
select hand_to_rider(:o1, 'Musa', '08031234567', now() + interval '3 hours');
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000002'; select pack_item(:i2, true);
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
\o /dev/null
select pack_item(:i2, true); select hand_to_rider(:o1, 'Musa', '08031234567', now() + interval '3 hours');
\o
select status from orders where id = :o1;
\echo P4 ticks are locked once it’s gone; pick-ups need ticks too (expect 2 errors):
select pack_item(:i2, false);
\o /dev/null
select confirm_payment(:o3);
\o
select mark_ready(:o3, now() + interval '1 hour');

\echo P5 packing photo: wrong name refused, right name kept; a customer can’t set it (expect error, t, error):
select set_packing_photo(:o1, 'somewhere/else.jpg');
\o /dev/null
select set_packing_photo(:o1, :o1 || '/pack-11111111-2222-4333-8444-555555555555.jpg');
\o
select packing_photo like :o1 || '/pack-%' from orders where id = :o1;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001'; select set_packing_photo(:o1, null);

\echo P6 before delivery (and not late) nobody can report yet (expect f, error):
select get_order_public(:'t1')->>'can_report';
select report_problem(:'t1', 'damaged', 'The pan handle came off.', '{}');
\echo P7 delivered: only the customer who ordered can report; checks on what they send (expect t f f, then 6 errors):
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; \o /dev/null
select advance_order(:o1);
\o
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001'; select get_order_public(:'t1')->>'can_report';
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000002'; select get_order_public(:'t1')->>'can_report';
set role anon; reset request.jwt.claim.sub; select get_order_public(:'t1')->>'can_report';
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000002'; select report_problem(:'t1', 'damaged', 'The pan handle came off.', '{}');
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; select report_problem(:'t1', 'damaged', 'The pan handle came off.', '{}');
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001';
select report_problem(:'t1', 'angry', 'The pan handle came off.', '{}');
select report_problem(:'t1', 'damaged', 'Bad', '{}');
select report_problem(:'t1', 'damaged', 'The pan handle came off.', array['elsewhere/c-11111111-2222-4333-8444-555555555555.jpg']);
select report_problem(:'t1', 'damaged', 'The pan handle came off.', array[:o1 || '/v-11111111-2222-4333-8444-555555555555.jpg']);
\echo P8 a proper report goes in, once (expect t, error):
\o /dev/null
select report_problem(:'t1', 'damaged', '  The pan handle came off when I lifted it.  ', array[:o1 || '/c-11111111-2222-4333-8444-555555555555.jpg']);
\o
select x->>'status' = 'open' and x->>'details' = 'The pan handle came off when I lifted it.' and x->'photos'->>0 like :o1 || '/c-%' from (select get_order_public(:'t1')->'problem' x) y;
select report_problem(:'t1', 'damaged', 'The pan handle came off when I lifted it.', '{}');
\echo P9 the shop sees its problem; another shop doesn’t; the public sees only that there is one (expect 1 0, then true and an empty problem):
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; select count(*) from problems;
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000002'; select count(*) from problems;
set role anon; reset request.jwt.claim.sub; select get_order_public(:'t1')->>'has_problem', coalesce(get_order_public(:'t1')->>'problem', '(none)');
set role authenticated;
\echo P10 the customer can’t go to ShopDesk while the shop still has time (expect error with a time):
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001'; select problem_customer(:'t1', 'escalate');
\echo P11 the shop answers: checks, then a refund of 3000 (expect 4 errors, then answered refund 3000):
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
select answer_problem(:o1, 'ignore', '', null, '{}');
select answer_problem(:o1, 'explain', 'No', null, '{}');
select answer_problem(:o1, 'refund', 'Sorry about that', 999999, '{}');
select answer_problem(:o1, 'refund', 'Sorry about that', 3000, array[:o1 || '/c-11111111-2222-4333-8444-555555555555.jpg']);
\o /dev/null
select answer_problem(:o1, 'refund', 'Sorry about that, I sent part of it back', 3000, array[:o1 || '/pack-11111111-2222-4333-8444-555555555555.jpg']);
\o
select status, reply, refund_amount from problems where order_id = :o1;
\echo P12 only one answer (expect error):
select answer_problem(:o1, 'explain', 'Changed my mind about this', null, '{}');
\echo P13 the customer says the refund arrived: sorted and closed (expect sorted t t):
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001';
\o /dev/null
select problem_customer(:'t1', 'refund_received');
\o
reset role; select status, refund_received_at is not null, closed_at is not null from problems where order_id = :o1;
set role authenticated;

\echo P14 send it again: the order goes back to packing, and when it arrives the problem is sorted (expect paid f f, error, then sorted delivered):
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
\o /dev/null
select set_delivery_fee(:o2, 2000); select confirm_payment(:o2); select pack_item(id, true) from order_items where order_id = :o2;
select hand_to_rider(:o2, 'Musa', '08031234567', now() + interval '3 hours'); select advance_order(:o2);
\o
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001';
\o /dev/null
select report_problem(:'t2', 'wrong_item', 'I got one pan, not two pans.', array[:o2 || '/c-21111111-2222-4333-8444-555555555555.jpg']);
\o
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
\o /dev/null
select answer_problem(:o2, 'resend', 'Sending the second pan today', null, '{}');
\o
select o.status, bool_or(i.packed), o.done_at is not null from orders o join order_items i on i.order_id = o.id where o.id = :o2 group by o.id;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001'; select customer_received(:'t2');
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
\o /dev/null
select pack_item(id, true) from order_items where order_id = :o2; select hand_to_rider(:o2, 'Musa', '08031234567', now() + interval '2 hours');
\o
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001';
\o /dev/null
select customer_received(:'t2');
\o
reset role; select p.status, o.status from problems p join orders o on o.id = p.order_id where p.order_id = :o2;

\echo P15 no answer in 48 hours: it goes to ShopDesk by itself; a late answer is kept but it stays with ShopDesk (expect with_shopdesk no_reply, attention t, with_shopdesk explain):
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
\o /dev/null
select pack_item(id, true) from order_items where order_id = :o3; select mark_ready(:o3, now() + interval '1 hour'); select advance_order(:o3);
\o
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000002';
\o /dev/null
select report_problem(:'t3', 'damaged', 'One of the pots was dented badly.', array[:o3 || '/c-31111111-2222-4333-8444-555555555555.jpg']);
\o
reset role; update problems set created_at = now() - interval '49 hours' where order_id = :o3;
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000002';
select x->>'status', x->>'escalated_by' from (select get_order_public(:'t3')->'problem' x) y;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select exists (select 1 from jsonb_array_elements(admin_attention()) a where a->>'kind' = 'problems' and a->>'slug' = 'kemi');
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
\o /dev/null
select answer_problem(:o3, 'explain', 'It left the shop in perfect condition, see the packing photo.', null, '{}');
\o
reset role; select status, reply from problems where order_id = :o3;

\echo P16 your Problems list: problems with you show the customer’s email and phone, others don’t; only you can open it (expect with_shopdesk c2@example.com 08033334444, sorted null null, error):
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select x->>'status', x->'customer'->>'email', x->'customer'->>'phone' from jsonb_array_elements(admin_problems()) x where (x->'order'->>'id')::bigint = :o3;
select x->>'status', x->'customer'->>'email', x->'customer'->>'phone' from jsonb_array_elements(admin_problems()) x where (x->'order'->>'id')::bigint = :o1;
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; select admin_problems();
\echo P17 you decide: only you, with a note, once; both sides see it, and it’s logged (expect 2 errors, decided shop, customer sees it, log line, error):
select admin_decide_problem((select id from problems where order_id = :o3), 'shop', 'Packing photo shows the pots were fine.');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
reset role; select id as pr3 from problems where order_id = :o3 \gset
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_decide_problem(:pr3, 'shop', 'ok');
\o /dev/null
select admin_decide_problem(:pr3, 'shop', 'The packing photo shows the pots were fine.');
\o
reset role; select status, decision from problems where id = :pr3;
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000002';
select x->>'status', x->>'decision', x->>'decision_note' from (select get_order_public(:'t3')->'problem' x) y;
reset role; select detail from audit_log where action = 'problem_decided';
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_decide_problem(:pr3, 'customer', 'Changing my decision here');

\echo P18 three complaints decided against a shop in 30 days flag it (expect t):
reset role;
\o /dev/null
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001';
select place_order('kemi', '{"name":"Chioma","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'pan', 'qty', 1))) from generate_series(1, 3);
\o
reset role;
insert into problems (order_id, shop_id, customer_id, kind, details, status, decision, decided_at, closed_at)
select o.id, o.shop_id, o.customer_id, 'other', 'Made up for this test only', 'decided', 'customer', now(), now()
from orders o where o.shop_id = (select id from shops where slug = 'kemi') and not exists (select 1 from problems p where p.order_id = o.id);
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select exists (select 1 from jsonb_array_elements(admin_attention()) a where a->>'kind' = 'upheld' and a->>'slug' = 'kemi');

\echo P19 order photos: who may add and see them (expect insert ok ok, then 4 errors, then reads 1 1 0 1 and anon error):
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001';
insert into storage.objects (bucket_id, name) values ('order-photos', :o1 || '/c-aaaaaaaa-2222-4333-8444-555555555555.jpg');
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
insert into storage.objects (bucket_id, name) values ('order-photos', :o1 || '/pack-aaaaaaaa-2222-4333-8444-555555555555.jpg');
insert into storage.objects (bucket_id, name) values ('order-photos', :o1 || '/c-bbbbbbbb-2222-4333-8444-555555555555.jpg');
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001';
insert into storage.objects (bucket_id, name) values ('order-photos', :o1 || '/v-bbbbbbbb-2222-4333-8444-555555555555.jpg');
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000002';
insert into storage.objects (bucket_id, name) values ('order-photos', :o1 || '/c-cccccccc-2222-4333-8444-555555555555.jpg');
insert into storage.objects (bucket_id, name) values ('order-photos', 'notanumber/c-cccccccc-2222-4333-8444-555555555555.jpg');
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; select count(*) from storage.objects where bucket_id = 'order-photos' and name like :o1 || '/c-%';
set request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001'; select count(*) from storage.objects where bucket_id = 'order-photos' and name like :o1 || '/pack-%';
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000002'; select count(*) from storage.objects where bucket_id = 'order-photos';
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; select count(*) from storage.objects where bucket_id = 'order-photos' and name like :o1 || '/c-%';
set role anon; reset request.jwt.claim.sub; select count(*) from storage.objects;

\echo P20 function rights: customers’ and shops’ new functions need an account; the helpers aren’t callable (expect f f f f f f f, t t t t t t t, f f f f f):
reset role;
select has_function_privilege('anon', 'public.report_problem(uuid, text, text, text[])', 'execute'), has_function_privilege('anon', 'public.problem_customer(uuid, text)', 'execute'),
  has_function_privilege('anon', 'public.pack_item(bigint, boolean)', 'execute'), has_function_privilege('anon', 'public.set_packing_photo(bigint, text)', 'execute'),
  has_function_privilege('anon', 'public.answer_problem(bigint, text, text, int, text[])', 'execute'), has_function_privilege('anon', 'public.admin_problems()', 'execute'),
  has_function_privilege('anon', 'public.admin_decide_problem(bigint, text, text, int)', 'execute');
select has_function_privilege('authenticated', 'public.report_problem(uuid, text, text, text[])', 'execute'), has_function_privilege('authenticated', 'public.problem_customer(uuid, text)', 'execute'),
  has_function_privilege('authenticated', 'public.pack_item(bigint, boolean)', 'execute'), has_function_privilege('authenticated', 'public.set_packing_photo(bigint, text)', 'execute'),
  has_function_privilege('authenticated', 'public.answer_problem(bigint, text, text, int, text[])', 'execute'), has_function_privilege('authenticated', 'public.admin_problems()', 'execute'),
  has_function_privilege('authenticated', 'public.admin_decide_problem(bigint, text, text, int)', 'execute');
select has_function_privilege('authenticated', 'public.order_prefix_for(text)', 'execute'), has_function_privilege('authenticated', 'public.order_code(text, bigint)', 'execute'),
  has_function_privilege('authenticated', 'public.problem_status(public.problems)', 'execute'), has_function_privilege('authenticated', 'public.can_report(public.orders)', 'execute'),
  has_function_privilege('authenticated', 'public.shops_set_prefix()', 'execute');
\echo P21 the shop can’t write to problems directly (expect permission denied x2):
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
update problems set status = 'sorted';
delete from problems;

\echo P22 deleting the shop keeps a copy for you, and its order photos stay (expect t, then 1 copy with the orders):
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
reset role; select id as kemiid from shops where slug = 'kemi' \gset
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select r->'order_photos' is null and (r->>'orders')::int > 0 from (select admin_delete_shop(:'kemiid', 'kemi', 'Test: remove the shop') r) x;
reset role; select count(*) || '|' || bool_and(jsonb_array_length(data->'orders') > 0 and reason = 'Test: remove the shop') from archives where slug = 'kemi';
