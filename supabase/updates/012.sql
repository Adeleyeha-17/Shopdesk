-- 012: reserve "shops" as a shop link name. shopdesk.com.ng/shops is the customer's Shops tab.
-- Safe to run more than once. Stops with an error if a shop already uses the link name "shops".
alter table public.shops drop constraint if exists shops_slug_reserved;
alter table public.shops add constraint shops_slug_reserved check (slug not in ('admin', 'privacy', 'orders', 'order', 'login', 'signin', 'shopdesk', 'help', 'support', 'api', 'app', 'email-off', 'account', 'shops'));
