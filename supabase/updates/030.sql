-- 030: reserve "carts", "legal", "terms" and "prohibited" as shop link names. They are now ShopDesk pages:
-- shopdesk.com.ng/carts (every shop's cart), /legal, /terms (Terms of Use) and /prohibited (prohibited items).
-- Safe to run more than once. Stops with an error if a shop already uses one of these link names.
alter table public.shops drop constraint if exists shops_slug_reserved;
alter table public.shops add constraint shops_slug_reserved check (slug not in ('admin', 'privacy', 'orders', 'order', 'login', 'signin', 'shopdesk', 'help', 'support', 'api', 'app', 'email-off', 'account', 'shops', 'carts', 'legal', 'terms', 'prohibited'));
