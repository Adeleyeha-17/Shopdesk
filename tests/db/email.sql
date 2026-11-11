\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Email backup: what you missed, by email, without flooding anyone's inbox. Runs after the other test files.
reset role;
insert into auth.users values ('e0000000-0000-4000-8000-000000000001', 'tola@example.com'), ('e0000000-0000-4000-8000-000000000002', 'mail-shop@example.com') on conflict do nothing;
set role authenticated; set request.jwt.claim.sub = 'e0000000-0000-4000-8000-000000000002';
insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location) values (auth.uid(), 'Mail Shop', 'mailshop', 'OPay', '0111222339', 'MAIL', '08000000006', 'Things', 'Ikeja');
reset role; update shops set status = 'active' where slug = 'mailshop';
-- clear older test alerts so only these count
update notifications set emailed_at = now() where emailed_at is null;
insert into orders (shop_id, customer_id, customer_name, customer_phone, mode, items_total, delivery_paid_by)
  select id, 'e0000000-0000-4000-8000-000000000001', 'Tola', '08020000001', 'pickup', 5000, 'customer' from shops where slug = 'mailshop' returning id as om \gset
create or replace function pg_temp.alert(p_user uuid, p_kind text, p_title text, p_body text, p_ago interval) returns bigint language sql as $$
  insert into notifications (user_id, order_id, kind, title, body, url, created_at)
  values (p_user, (select max(id) from orders where customer_name = 'Tola'), p_kind, p_title, p_body, '/o/x#chat', now() - p_ago) returning id;
$$;
\set tola '''e0000000-0000-4000-8000-000000000001'''
\set shopu '''e0000000-0000-4000-8000-000000000002'''

\echo E1 nothing goes out in the first 10 minutes (expect 0):
select pg_temp.alert(:tola, 'message', 'Mail Shop', 'Your order is ready', '3 minutes') is not null as x \gset
select jsonb_array_length(email_claim());
\echo E2 after 10 minutes one email holds everything waiting for that person, newest too; each alert goes once (expect 1, tola@example.com|customer|2, then 0):
update notifications set created_at = now() - interval '12 minutes' where user_id = :tola and emailed_at is null;
select pg_temp.alert(:tola, 'confirmed', 'Mail Shop', 'MS-1 confirmed. Pay ₦5,000.', '1 minute') is not null as x \gset
select email_claim() as c \gset
select jsonb_array_length(:'c'::jsonb);
select (:'c'::jsonb)->0->>'email' || '|' || ((:'c'::jsonb)->0->>'who') || '|' || jsonb_array_length((:'c'::jsonb)->0->'alerts');
update email_settings set sent_at = now() - interval '2 hours' where user_id = :tola;
select jsonb_array_length(email_claim());
\echo E3 no more than one email every 30 minutes (expect 0, then 1):
select pg_temp.alert(:tola, 'message', 'Mail Shop', 'Are you coming?', '15 minutes') is not null as x \gset
update email_settings set sent_at = now() - interval '20 minutes' where user_id = :tola;
select jsonb_array_length(email_claim());
update email_settings set sent_at = now() - interval '31 minutes' where user_id = :tola;
select jsonb_array_length(email_claim());
\echo E4 if you had ShopDesk open after it happened, or read it, no email (expect 0, 0):
update email_settings set sent_at = now() - interval '2 hours' where user_id = :tola;
select pg_temp.alert(:tola, 'message', 'Mail Shop', 'Seen in the app', '15 minutes') is not null as x \gset
set role authenticated; set request.jwt.claim.sub = 'e0000000-0000-4000-8000-000000000001';
select seen_app();
reset role; select jsonb_array_length(email_claim());
select pg_temp.alert(:tola, 'message', 'Mail Shop', 'Read in the app', '15 minutes') as rid \gset
update email_settings set seen_at = now() - interval '1 hour' where user_id = :tola;
update notifications set read_at = now() where id = :rid;
update notifications set emailed_at = now() where user_id = :tola and body = 'Seen in the app';
select jsonb_array_length(email_claim());
\echo E5 nothing older than a day; 10 emails a day at most (expect 0, then 0):
select pg_temp.alert(:tola, 'message', 'Mail Shop', 'Old news', '25 hours') is not null as x \gset
select jsonb_array_length(email_claim());
select pg_temp.alert(:tola, 'message', 'Mail Shop', 'Eleventh email today', '15 minutes') is not null as x \gset
update email_settings set sent_today = 10, sent_day = (now() at time zone 'Africa/Lagos')::date where user_id = :tola;
select jsonb_array_length(email_claim());
\echo E6 an email that failed waits for the next one (expect 1, then 0, then 1 with the same alert):
update email_settings set sent_today = 0 where user_id = :tola;
select email_claim() as c \gset
select jsonb_array_length(:'c'::jsonb);
select email_unclaim(:tola, array(select (x->>'id')::bigint from jsonb_array_elements((:'c'::jsonb)->0->'alerts') x));
select jsonb_array_length(email_claim());
update email_settings set sent_at = now() - interval '31 minutes' where user_id = :tola;
select jsonb_array_length(email_claim()->0->'alerts');
\echo E7 the switch in the app, and the stop link without signing in (expect t, false, then 0 emails, then t***@example.com|false, true, error):
set role authenticated; set request.jwt.claim.sub = 'e0000000-0000-4000-8000-000000000001';
select (my_email_settings()->>'on')::boolean;
select set_email_alerts(false); select my_email_settings()->>'on';
reset role; update email_settings set sent_at = null where user_id = :tola;
select pg_temp.alert(:tola, 'message', 'Mail Shop', 'Emails are off', '15 minutes') is not null as x \gset
select jsonb_array_length(email_claim());
select token as tok from email_settings where user_id = :tola \gset
set role anon; reset request.jwt.claim.sub;
select (email_by_token(:'tok')->>'email') || '|' || (email_by_token(:'tok')->>'on');
select email_by_token(:'tok', true)->>'on';
select email_by_token('00000000-0000-4000-8000-000000000000', false);
\echo E8 a shop gets its own emails with its name (expect shop|Mail Shop):
reset role; update notifications set emailed_at = now() where emailed_at is null;
select pg_temp.alert(:shopu, 'new_order', 'New order MS-2', 'Tola · ₦5,000', '12 minutes') is not null as x \gset
select email_claim() as c \gset
select ((:'c'::jsonb)->0->>'who') || '|' || ((:'c'::jsonb)->0->>'shop');
\echo E9 rights: only the push sender can take emails; nobody reads the settings table (expect f, f, f, t, t, t, then permission denied):
select has_function_privilege('authenticated', 'public.email_claim(int)', 'execute'), has_function_privilege('anon', 'public.email_claim(int)', 'execute'),
  has_function_privilege('authenticated', 'public.email_unclaim(uuid, bigint[])', 'execute'), has_function_privilege('anon', 'public.email_by_token(uuid, boolean)', 'execute'),
  has_function_privilege('authenticated', 'public.seen_app()', 'execute'), has_function_privilege('authenticated', 'public.set_email_alerts(boolean)', 'execute');
set role authenticated; set request.jwt.claim.sub = 'e0000000-0000-4000-8000-000000000001'; select count(*) from email_settings;
