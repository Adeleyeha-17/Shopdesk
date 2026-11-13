\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- The ShopDesk chat: each shop and ShopDesk talk inside the app, and the shop only ever sees "ShopDesk".
-- Approving, not approving, suspending and reopening a shop tell it there. And "I want this" on features coming soon.
reset role;
insert into auth.users values ('c6000000-0000-4000-8000-000000000001', 'chatshop@example.com'), ('c6000000-0000-4000-8000-000000000002', 'othershop@example.com'),
  ('c6000000-0000-4000-8000-000000000009', 'boss@example.com') on conflict do nothing;
insert into admins values ('c6000000-0000-4000-8000-000000000009') on conflict do nothing;
insert into shops (owner_id, name, slug, sells, location, status) values
  ('c6000000-0000-4000-8000-000000000001', 'Chat Fabrics', 'chatfabrics', 'Fabrics', 'Aba', 'pending'),
  ('c6000000-0000-4000-8000-000000000002', 'Other Bags', 'otherbags', 'Bags', 'Ikeja, Lagos', 'active');
select id as chat_shop from shops where slug = 'chatfabrics' \gset
select id as other_shop from shops where slug = 'otherbags' \gset

\echo S1 ShopDesk asks a waiting shop for photos; the shop hears it as ShopDesk (expect the message, then the alert):
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000009';
select sender || '|' || body from jsonb_to_record(admin_shop_send(:'chat_shop', 'Please send 3 photos of your fabrics.')) as x(sender text, body text);
reset role; select kind || '|' || title || '|' || body || '|' || url from notifications where user_id = 'c6000000-0000-4000-8000-000000000001' and kind = 'shopdesk';

\echo S2 the shop has 1 unread, opens the chat (no names, no admin), then has 0 and the alert is read (expect 1, the chat, 0, t):
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000001';
select shopdesk_unread();
select shopdesk_thread()::text !~ 'c6000000|boss' as no_admin_shown, jsonb_array_length(shopdesk_thread());
select shopdesk_unread();
reset role; select bool_and(read_at is not null) from notifications where user_id = 'c6000000-0000-4000-8000-000000000001' and kind = 'shopdesk';

\echo S3 the shop replies with a photo in its own folder; a photo from another folder is refused; Admin hears (expect the reply, the error, the admin alert):
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000001';
select sender || '|' || coalesce(body, '') || '|' || (photo is not null) from jsonb_to_record(shopdesk_send('Here they are', 'shop-' || :'chat_shop' || '/m-11111111-2222-4333-8444-555555555555.jpg')) as x(sender text, body text, photo text);
select shopdesk_send('', 'shop-' || :'other_shop' || '/m-11111111-2222-4333-8444-555555555555.jpg');
reset role; select kind || '|' || title || '|' || body || '|' || url from notifications where user_id = 'c6000000-0000-4000-8000-000000000009' and kind = 'admin_message';

\echo S4 who may add and see photos in a shop folder: the shop and admins only (expect t, t, f, t, f):
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000001';
select order_photo_access('shop-' || :'chat_shop' || '/m-x.jpg', true);
select order_photo_access('shop-' || :'chat_shop' || '/m-x.jpg', false);
set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000002';
select order_photo_access('shop-' || :'chat_shop' || '/m-x.jpg', false);
set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000009';
select order_photo_access('shop-' || :'chat_shop' || '/m-x.jpg', false);
select order_photo_access('shop-' || :'chat_shop' || '/pack-x.jpg', true);

\echo S5 the admin list shows the shop with 1 unread from it; opening the chat reads them (expect Chat Fabrics|shop|1, then 2 messages, then 0):
select (t->>'name') || '|' || (t->>'from') || '|' || (t->>'unread') from jsonb_array_elements(admin_shop_threads()) t where t->>'slug' = 'chatfabrics';
select jsonb_array_length(admin_shop_thread(:'chat_shop')->'messages');
select t->>'unread' from jsonb_array_elements(admin_shop_threads()) t where t->>'slug' = 'chatfabrics';

\echo S6 nobody else reads the chat: another shop sees only its own (empty), a shop cannot use the admin, nobody reads the table (expect 0, Not allowed x2, permission denied):
set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000002';
select jsonb_array_length(shopdesk_thread());
select admin_shop_threads();
select admin_shop_send(:'chat_shop', 'hello');
select * from shop_messages;

\echo S7 approving tells the shop in its chat; suspending and reopening too, without your private reason (expect 3 messages):
set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000009';
select admin_review_shop(:'chat_shop', true, null);
select admin_set_shop_status(:'chat_shop', 'suspended', 'Customer complaints about fake fabric');
select admin_set_shop_status(:'chat_shop', 'active', 'Sorted with the customer');
reset role; select body from shop_messages where shop_id = :'chat_shop' and sender = 'shopdesk' order by id offset 1;

\echo S8 not approving says why; setting the same status twice sends nothing new (expect the message, then still 1):
reset role; update shops set status = 'pending' where id = :'other_shop';
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000009';
select admin_review_shop(:'other_shop', false, 'Add a photo for every product first.');
reset role; select body from shop_messages where shop_id = :'other_shop';
update shops set status = 'active' where id = :'other_shop';
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000009';
select admin_set_shop_status(:'other_shop', 'active', 'Already open, nothing changes');
reset role; select count(*) from shop_messages where shop_id = :'other_shop';

\echo F1 shops tap I want this (twice counts once); Admin sees how many (expect pay_online for the shop, then 2|1):
set role authenticated; set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000001';
select want_feature('pay_online'); select want_feature('pay_online'); select want_feature('delivery');
set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000002';
select want_feature('pay_online'); select want_feature('nothing');
select array_to_string(my_feature_wants(), ',');
set request.jwt.claim.sub = 'c6000000-0000-4000-8000-000000000009';
select (admin_feature_wants()->>'pay_online') || '|' || (admin_feature_wants()->>'delivery');

\echo F2 switching Pay online on tells the shops that asked, and only them (expect 2 alerts with the shop tab link):
reset role;
update settings set online_pay_on = true where id = 1;
select count(*) || '|' || min(title) || '|' || min(url) from notifications where kind = 'feature';
update settings set online_pay_on = false where id = 1;
