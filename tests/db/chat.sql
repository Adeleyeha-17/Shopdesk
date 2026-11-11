\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Chat, alerts, refunds you order, reports with their order, phones with alerts on. Runs after tests.sql and tests-problems.sql.
reset role;
insert into auth.users values ('dddddddd-0000-4000-8000-000000000001', 'tola@example.com'), ('dddddddd-0000-4000-8000-000000000002', 'femi@example.com'),
  ('eeeeeeee-0000-4000-8000-000000000001', 'ada@example.com'), ('eeeeeeee-0000-4000-8000-000000000002', 'bayo@example.com') on conflict do nothing;
insert into admins values ('33333333-3333-3333-3333-333333333333') on conflict do nothing;
set role authenticated; set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';
insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location) values (auth.uid(), 'Tola Tailoring', 'tola', 'OPay', '0123456781', 'TOLA C', '08000000002', 'Clothes', 'Surulere');
insert into products (shop_id, name, price, stock, photo_path) values (my_shop_id(), 'Ankara gown', 20000, 20, 'x/gown.jpg');
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000002';
insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location) values (auth.uid(), 'Femi Phones', 'femiphones', 'OPay', '0123456782', 'FEMI D', '08000000003', 'Phones', 'Ikeja');
reset role; update shops set status = 'active' where slug in ('tola', 'femiphones');
select id as gown from products where name = 'Ankara gown' \gset
\echo C1 you hear about new shops waiting (expect 2 new_shop alerts for you, none for anyone else):
select count(*) from notifications where user_id = '33333333-3333-3333-3333-333333333333' and kind = 'new_shop' and body in ('Tola Tailoring', 'Femi Phones');

set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
select place_order('tola', '{"name":"Ada","phone":"08055556666","mode":"delivery","address":"3 Bode Thomas"}', jsonb_build_array(jsonb_build_object('product_id', :'gown', 'qty', 1)))->>'token' as ta \gset
reset role;
select id as oa from orders where public_token = :'ta' \gset
\echo C2 a new order alerts the shop, not the customer (expect 1|New order TT-<n>|Ada · ₦20,000|/?order=<n>#orders, then 0):
select count(*) || '|' || (title = 'New order TT-' || :oa) || '|' || body || '|' || (url = '/?order=' || :oa || '#orders') from notifications where kind = 'new_order' and order_id = :oa and user_id = 'dddddddd-0000-4000-8000-000000000001' group by title, body, url;
select count(*) from notifications where order_id = :oa and user_id = 'eeeeeeee-0000-4000-8000-000000000001';

\echo C3 the order moving alerts the customer: confirmed, paid, on its way, delivered (expect confirmed paid out delivered, and the bodies):
set role authenticated; set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';
\o /dev/null
select set_delivery_fee(:oa, 1500); select confirm_payment(:oa); select pack_item(id, true) from order_items where order_id = :oa;
select hand_to_rider(:oa, 'Musa', '08031234567', now() + interval '3 hours'); select advance_order(:oa);
\o
reset role;
select string_agg(kind, ' ' order by id) from notifications where order_id = :oa and user_id = 'eeeeeeee-0000-4000-8000-000000000001';
select string_agg(regexp_replace(body, 'By .*$', 'By <time>.'), ' / ' order by id) from notifications where order_id = :oa and user_id = 'eeeeeeee-0000-4000-8000-000000000001';
\echo C4 the shop hears when the customer says they paid and when they got it, and nobody hears about their own action (expect says_paid received, 0):
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
select place_order('tola', '{"name":"Ada","phone":"08055556666","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'gown', 'qty', 1)))->>'token' as tb \gset
\o /dev/null
select customer_says_paid(:'tb'); select customer_received(:'ta');
\o
reset role;
select id as ob from orders where public_token = :'tb' \gset
select string_agg(kind, ' ' order by id) from notifications where user_id = 'dddddddd-0000-4000-8000-000000000001' and kind in ('says_paid', 'received');
set role authenticated; set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';
\o /dev/null
select mark_customer_says_paid(:ob);
\o
reset role;
select count(*) from notifications where user_id = 'dddddddd-0000-4000-8000-000000000001' and kind = 'says_paid' and order_id = :ob;

\echo C5 chat: the shop and the customer write; another customer, another shop and visitors can’t (expect customer, the trimmed text, shop, 2, then 2 errors, then permission denied):
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
select send_message(:ob, '  Can I collect at 5?  ')->>'sender';
select body from messages where order_id = :ob order by id desc limit 1;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';
select send_message(:ob, 'Yes, 5pm is fine')->>'sender';
select count(*) from messages where order_id = :ob;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000002'; select send_message(:ob, 'hello');
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000002'; select send_message(:ob, 'hello');
set role anon; reset request.jwt.claim.sub; select send_message(:ob, 'hello');
\echo C6 who reads a chat: the shop and the customer see 2, another customer and another shop see 0, nobody writes directly (expect 2 2 0 0, then permission denied x2):
set role authenticated;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001'; select count(*) from messages where order_id = :ob;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001'; select count(*) from messages where order_id = :ob;
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000002'; select count(*) from messages;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000002'; select count(*) from messages;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';
insert into messages (order_id, shop_id, sender, body) values (:ob, my_shop_id(), 'shop', 'x');
delete from messages where order_id = :ob;
\echo C7 messages alert the other side with a link to the chat (expect the shop: Ada · TT-<n>|Can I collect at 5?|/?chat=<n>#orders; the customer: Tola Tailoring|Yes, 5pm is fine|/o/<token>#chat):
reset role;
select title = 'Ada · TT-' || :ob, body, url = '/?chat=' || :ob || '#orders' from notifications where kind = 'message' and user_id = 'dddddddd-0000-4000-8000-000000000001' and order_id = :ob;
select title, body, url = '/o/' || :'tb' || '#chat' from notifications where kind = 'message' and user_id = 'eeeeeeee-0000-4000-8000-000000000001' and order_id = :ob;
\echo C8 empty messages, bad photo paths and floods are refused; a good photo path works (expect 3 errors, then t, then the flood error once):
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
select send_message(:ob, '   ');
select send_message(:ob, '', :ob || '/c-11111111-2222-3333-4444-555555555555.jpg');
select send_message(:ob, '', :oa || '/m-11111111-2222-3333-4444-555555555555.jpg');
select send_message(:ob, '', :ob || '/m-11111111-2222-3333-4444-555555555555.jpg')->>'photo' is not null;
\o /dev/null
select send_message(:ob, 'spam ' || g) from generate_series(1, 18) g;
\o
select send_message(:ob, 'one too many');
\echo C9 chat photos: both sides may add m- photos to their order; nobody else (expect t t f f f):
reset role;
select order_photo_access(:ob || '/m-x.jpg', true) from (select set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000001', true)) x;
select order_photo_access(:ob || '/m-x.jpg', true) from (select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-4000-8000-000000000001', true)) x;
select order_photo_access(:ob || '/m-x.jpg', true) from (select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-4000-8000-000000000002', true)) x;
select order_photo_access(:ob || '/m-x.jpg', true) from (select set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000002', true)) x;
select order_photo_access(:ob || '/c-x.jpg', true) from (select set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000001', true)) x;
\echo C10 chat closes 7 days after the order is done (expect t, then f and the closed error):
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
select (get_order_public(:'ta')->>'can_chat')::boolean;
reset role; update orders set done_at = now() - interval '8 days' where id = :oa;
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
select (get_order_public(:'ta')->>'can_chat')::boolean;
select send_message(:oa, 'still there?');
reset role; update orders set done_at = now() where id = :oa;
\echo C11 alerts: everyone reads only their own; nobody writes or edits them directly; mark_read marks only yours (expect t t, permission denied x2, then 0 and t):
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
select count(*) > 0 and bool_and(user_id = auth.uid()) from notifications;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';
select count(*) > 0 and bool_and(user_id = auth.uid()) from notifications;
insert into notifications (user_id, kind, title) values (auth.uid(), 'x', 'x');
update notifications set read_at = now();
\o /dev/null
select mark_read(:ob, 'message');
\o
reset role;
select count(*) from notifications where user_id = 'dddddddd-0000-4000-8000-000000000001' and order_id = :ob and kind = 'message' and read_at is null;
select count(*) > 0 from notifications where user_id = 'eeeeeeee-0000-4000-8000-000000000001' and read_at is null;

\echo C12 a refund you order: decide for the customer with ₦15,000; wrong amounts and a refund for the shop are refused (expect 3 errors, then decided|15000|t):
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
\o /dev/null
select report_problem(:'ta', 'damaged', 'The gown arrived torn at the side.', array[:oa || '/c-41111111-2222-4333-8444-555555555555.jpg']);
select problem_customer(:'ta', 'sorted');
\o
reset role; update problems set status = 'with_shopdesk', escalated_at = now(), escalated_by = 'customer', closed_at = null where order_id = :oa;
select id as pa from problems where order_id = :oa \gset
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_decide_problem(:pa, 'shop', 'The photo shows no damage.', 5000);
select admin_decide_problem(:pa, 'customer', 'Torn on arrival.', 0);
select admin_decide_problem(:pa, 'customer', 'Torn on arrival.', 9999999);
\o /dev/null
select admin_decide_problem(:pa, 'customer', 'Torn on arrival. Refund the gown.', 15000);
\o
reset role;
select status || '|' || owed_amount || '|' || (owed_by between now() + interval '47 hours' and now() + interval '49 hours') from problems where id = :pa;
\echo C13 both sides hear the decision (expect the customer: You were right. Tola Tailoring must refund ₦15,000 by <time>.; the shop: Refund ₦15,000 by <time> or your page pauses.):
select regexp_replace(body, 'by .*\.$', 'by <time>.') from notifications where kind = 'decided' and user_id = 'eeeeeeee-0000-4000-8000-000000000001';
select regexp_replace(body, 'by .* or', 'by <time> or') from notifications where kind = 'decided' and user_id = 'dddddddd-0000-4000-8000-000000000001';
\echo C14 the shop still takes orders before the deadline; after it, its page closes and orders are refused (expect t, then t and the closed error):
set role anon; reset request.jwt.claim.sub;
select get_storefront('tola') is not null;
reset role; update problems set owed_by = now() - interval '1 minute' where id = :pa;
set role anon; select get_storefront('tola') is null;
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000002';
select place_order('tola', '{"name":"Bayo","phone":"08077778888","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'gown', 'qty', 1)));
\echo C15 Needs attention shows the overdue refund (expect 1):
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select count(*) from jsonb_array_elements(admin_attention()) x where x->>'kind' = 'refund_overdue' and x->>'slug' = 'tola';
\echo C16 the shop says it sent the refund; another shop can’t; the customer hears (expect error, then 1 refund_sent alert):
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000002'; select refund_sent(:oa, :oa || '/r-51111111-2222-4333-8444-555555555555.jpg');
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';
\o /dev/null
select refund_sent(:oa, :oa || '/r-51111111-2222-4333-8444-555555555555.jpg');
\o
reset role; select count(*) from notifications where kind = 'refund_sent' and user_id = 'eeeeeeee-0000-4000-8000-000000000001' and body like '%₦15,000%';
\echo C17 the customer confirms it arrived: the page opens again and the shop hears (expect customer|t, t, 1):
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
\o /dev/null
select problem_customer(:'ta', 'refund_received');
\o
reset role; select owed_cleared_by || '|' || (owed_paid_at is not null) from problems where id = :pa;
set role anon; reset request.jwt.claim.sub; select get_storefront('tola') is not null;
reset role; select count(*) from notifications where kind = 'refund_ok' and user_id = 'dddddddd-0000-4000-8000-000000000001';
\echo C18 the customer’s problem page shows the refund (expect 15000|t):
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
select (get_order_public(:'ta')->'problem'->>'owed_amount') || '|' || (get_order_public(:'ta')->'problem'->>'owed_paid_at' is not null);

\echo C19 reports name their order: from the customer’s own order it’s linked, someone else’s order isn’t (expect t|t, then f|t):
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
\o /dev/null
select report_shop('tola', 'The shop is rude in chat.', '', :'tb');
\o
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000002';
\o /dev/null
select report_shop('tola', 'Somebody else''s order.', '', :'tb');
\o
reset role;
select (order_id = :ob) || '|' || (reporter_id = 'eeeeeeee-0000-4000-8000-000000000001') from reports where reason = 'The shop is rude in chat.';
select (order_id is not null) || '|' || (reporter_id = 'eeeeeeee-0000-4000-8000-000000000002') from reports where reason = 'Somebody else''s order.';
\echo C20 visitors can’t report; a signed-in customer can report without an order, and the 3-value call still works (expect error, then 1):
set role anon; reset request.jwt.claim.sub;
select report_shop('tola', 'Anonymous report here.', '');
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000002';
\o /dev/null
select report_shop(p_slug => 'femiphones', p_reason => 'Named arguments report.', p_contact => '');
\o
reset role; select count(*) from reports where reason in ('Anonymous report here.', 'Named arguments report.') and order_id is null;
\echo C21 Reports show the order: what was ordered, money and times; your alert came in (expect TT-<n>|Ankara gown|t, then 2 report alerts):
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select (x->'order'->>'code' = 'TT-' || :ob) || '|' || (x->'order'->'items'->0->>'name') || '|' || (x->'order'->>'created_at' is not null)
  from jsonb_array_elements(admin_reports()) x where x->>'reason' = 'The shop is rude in chat.';
reset role; select count(*) from notifications where kind = 'report' and title = 'Report · Tola Tailoring' and user_id = '33333333-3333-3333-3333-333333333333';
\echo C22 you read a chat only with a report or a problem with you (Bayo reported Femi Phones, so his order there opens), and it’s logged; shops and customers can’t (expect t, the chat, 1 log line, then 2 errors):
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select jsonb_array_length(admin_order_chat(:ob)->'messages') >= 3;
reset role; insert into products (shop_id, name, price, stock, photo_path) select id, 'Charger', 3000, 5, 'x/c.jpg' from shops where slug = 'femiphones';
select id as charger from products where name = 'Charger' \gset
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000002';
select place_order('femiphones', '{"name":"Bayo","phone":"08077778888","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'charger', 'qty', 1)))->>'token' as tc \gset
reset role; select id as oc from orders where public_token = :'tc' \gset
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_order_chat(:oc);
reset role; select count(*) from audit_log where action = 'chat_view' and detail = 'Order TT-' || :ob;
set role authenticated; set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001'; select admin_order_chat(:ob);
set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001'; select admin_order_chat(:ob);
\echo C23 you can clear a refund yourself, with a reason (expect error, then admin):
reset role; update problems set owed_paid_at = null, owed_cleared_by = null where id = :pa;
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select admin_clear_owed(:pa, 'ok');
\o /dev/null
select admin_clear_owed(:pa, 'Customer showed the alert on a call.');
\o
reset role; select owed_cleared_by from problems where id = :pa;

\echo C24 phones with alerts on: saved for your account, bad ones refused, up to 10 kept, only you remove yours (expect 1, error, 10, 10, 9):
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
\o /dev/null
select save_push_sub('https://push.example.com/sub/1', repeat('B', 87), repeat('a', 22));
\o
reset role; select count(*) from push_subs where user_id = 'eeeeeeee-0000-4000-8000-000000000001';
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
select save_push_sub('http://push.example.com/insecure', repeat('B', 87), repeat('a', 22));
\o /dev/null
select save_push_sub('https://push.example.com/sub/' || g, repeat('B', 87), repeat('a', 22)) from generate_series(2, 12) g;
\o
reset role; select count(*) from push_subs where user_id = 'eeeeeeee-0000-4000-8000-000000000001';
set role authenticated; set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';
\o /dev/null
select delete_push_sub('https://push.example.com/sub/12');
\o
reset role; select count(*) from push_subs where user_id = 'eeeeeeee-0000-4000-8000-000000000001';
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
\o /dev/null
select delete_push_sub('https://push.example.com/sub/12');
\o
reset role; select count(*) from push_subs where user_id = 'eeeeeeee-0000-4000-8000-000000000001';
\echo C25 the push sender’s functions and the tables behind them are closed to the app (expect f f f f f f, then permission denied x3):
reset role;
select has_function_privilege('authenticated', 'public.push_claim(int)', 'execute'), has_function_privilege('authenticated', 'public.push_drop(text[])', 'execute'),
  has_function_privilege('authenticated', 'public.push_key()', 'execute'), has_function_privilege('authenticated', 'public.push_key_init(text, jsonb)', 'execute'),
  has_function_privilege('anon', 'public.push_claim(int)', 'execute'), has_function_privilege('anon', 'public.push_key()', 'execute');
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
select count(*) from push_subs; select count(*) from push_keys; select push_claim(10);
\echo C26 push_claim hands over each unsent alert once, with the phones it goes to (expect t|t, then 0):
reset role;
update notifications set pushed_at = now() where pushed_at is null and user_id <> 'eeeeeeee-0000-4000-8000-000000000001';
select (jsonb_array_length(c) > 0) || '|' || bool_and(jsonb_array_length(x->'subs') = 9) from (select push_claim(500) c) q, jsonb_array_elements(c) x group by c;
select jsonb_array_length(push_claim(500));
\echo C27 the key is made once and kept (expect t, t):
select (push_key_init('pub1', '{"k":1}')->>'public_key') = 'pub1';
select (push_key_init('pub2', '{"k":2}')->>'public_key') = 'pub1';
\echo C28 the helpers aren’t callable from the app (expect f x10):
select has_function_privilege('authenticated', 'public.notify(uuid, bigint, text, text, text, text)', 'execute'), has_function_privilege('authenticated', 'public.notify_admins(text, text, text, text)', 'execute'),
  has_function_privilege('authenticated', 'public.shop_owes(uuid)', 'execute'), has_function_privilege('authenticated', 'public.can_chat(public.orders)', 'execute'),
  has_function_privilege('authenticated', 'public.admin_order_json(bigint)', 'execute'), has_function_privilege('authenticated', 'public.orders_notify()', 'execute'),
  has_function_privilege('authenticated', 'public.shops_notify_admins()', 'execute'), has_function_privilege('authenticated', 'public.naira(int)', 'execute'),
  has_function_privilege('authenticated', 'public.lagos_time(timestamptz)', 'execute'), has_function_privilege('anon', 'public.send_message(bigint, text, text)', 'execute');
\echo C29 the app’s new functions need an account (expect t x7):
select has_function_privilege('authenticated', 'public.send_message(bigint, text, text)', 'execute'), has_function_privilege('authenticated', 'public.mark_read(bigint, text)', 'execute'),
  has_function_privilege('authenticated', 'public.save_push_sub(text, text, text)', 'execute'), has_function_privilege('authenticated', 'public.refund_sent(bigint, text)', 'execute'),
  has_function_privilege('authenticated', 'public.admin_clear_owed(bigint, text)', 'execute'), has_function_privilege('authenticated', 'public.admin_order_chat(bigint, text)', 'execute'),
  has_function_privilege('anon', 'public.report_shop(text, text, text, uuid)', 'execute');
\echo C30 deleting a shop keeps its chats in your copy, photos included (expect t):
reset role; select id as tola_id from shops where slug = 'tola' \gset
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\o /dev/null
select admin_delete_shop(:'tola_id', 'tola', 'Testing the delete');
\o
reset role; select data::text like '%' || :ob || '/m-11111111-2222-3333-4444-555555555555.jpg%' from archives where slug = 'tola';
