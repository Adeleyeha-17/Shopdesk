-- 011: reserve "account" as a shop link name. shopdesk.com.ng/account is the customer's Account page.
-- Safe to run more than once. Stops with an error if a shop already uses the link name "account".
alter table public.shops drop constraint if exists shops_slug_reserved;
alter table public.shops add constraint shops_slug_reserved check (slug not in ('admin', 'privacy', 'orders', 'order', 'login', 'signin', 'shopdesk', 'help', 'support', 'api', 'app', 'email-off', 'account'));
