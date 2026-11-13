-- ShopDesk database: run once in Supabase (SQL Editor → New query → paste all → Run).
-- Every shop's data is fenced off by row-level security: a vendor can only ever read or change their own shop.
-- Customers never read tables directly; they go through a few functions that return only what an order page needs.
-- The owner (you) gets counts and a shop list from admin functions, with no customer details unless a support
-- view is opened with a written reason, and every admin action is written to the audit log.
--
-- What's in this file, in order:
--   1. tables ............................ shops, products, orders, payments, reports, admins, audit log, settings, plans, notices, customers, problems,
--                                          chat messages, alerts, phones with alerts on, blocked customers, deleted shops' copies, email backup
--   2. upgrades .......................... extra columns for databases made with an older version of this file (order codes, packing ticks,
--                                          reports about an order or a message, refunds you order, cancel reasons)
--   3. helpers ........................... is_admin, my_shop_id, one email one role (has_shop, has_shopped, my_account), shop_open,
--                                          order codes, problem state, money and time words, refund owed, chat open, alerts,
--                                          fair use (who may report, blocked accounts), tidy-up (unpaid orders, refunds)
--   4. row-level security ................ who may read or change which rows, and which columns
--   5. vetted shops ...................... log changes to name, link or bank details after approval
--   6. one email, one role ............... a shop's email can't shop; an email that has shopped can't open a shop
--      alerts ............................ what the other side hears when an order moves
--   7. customers ......................... shop page, place an order, the order page, I've sent the money, I've received it, my orders,
--                                          report a shop, report a problem, answer the shop, cancel an unpaid order
--      chat and alerts ................... send a message, report a message, mark as read, phones with alerts on,
--                                          the push sender's functions
--      email backup ...................... an email with what you missed when you haven't opened ShopDesk for 10 minutes
--   8. vendors ........................... delivery fee, confirm, packing checklist and photo, hand to rider, ready for pick-up, money in,
--                                          delivered, cancel, stock, answer a problem, refund sent
--   9. you, the admin .................... overview, vetting, suspend, close for good, delete a shop, support view, needs attention,
--                                          growth, shop page, plans, announcements, problems (with refunds), reports with their order, chats,
--                                          block a customer
--      records ........................... a private copy of any shop before it's deleted, find any order by its code
--  12. live updates ...................... new alerts and chat messages reach the app the moment they're written
--  13. tidy-up every 10 minutes .......... unpaid orders cancel after 48 hours; refunds with a receipt count as received after 48 hours;
--                                          the email backup goes out every 5 minutes
--  10. function rights ................... who may call which function
--  11. photos ............................ product photos (public), and order photos (private: packing, problem and chat photos)

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,30}$'),
  bank text not null default 'OPay' check (char_length(bank) <= 30),
  account_number text not null default '' check (char_length(account_number) <= 20),
  account_name text not null default '' check (char_length(account_name) <= 60),
  whatsapp text not null default '' check (char_length(whatsapp) <= 20),
  allow_part_payment boolean not null default false,
  delivery_paid_by text not null default 'customer' check (delivery_paid_by in ('customer', 'vendor')),
  sells text not null default '' check (char_length(sells) <= 120),
  location text not null default '' check (char_length(location) <= 80),
  social text not null default '' check (char_length(social) <= 80),
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'banned', 'rejected')),
  reviewed_at timestamptz,
  review_note text not null default '' check (char_length(review_note) <= 300),
  details_changed_at timestamptz,
  accepted_rules_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  price integer not null check (price > 0 and price <= 100000000),
  stock integer not null default 0 check (stock >= 0),
  low_at integer not null default 2 check (low_at >= 0),
  photo_path text not null check (char_length(photo_path) between 5 and 200),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists products_shop on public.products (shop_id);

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  public_token uuid not null unique default gen_random_uuid(),
  customer_name text not null check (char_length(customer_name) between 1 and 60),
  customer_phone text not null default '' check (char_length(customer_phone) <= 20),
  mode text not null check (mode in ('delivery', 'pickup')),
  address text not null default '' check (char_length(address) <= 160),
  items_total integer not null check (items_total >= 0),
  delivery_fee integer check (delivery_fee >= 0 and delivery_fee <= 1000000),
  delivery_paid_by text not null check (delivery_paid_by in ('customer', 'vendor')),
  amount_paid integer not null default 0 check (amount_paid >= 0),
  status text not null default 'awaiting' check (status in ('awaiting', 'part', 'paid', 'out', 'delivered', 'cancelled')),
  customer_says_paid boolean not null default false,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  done_at timestamptz,
  customer_details_purged boolean not null default false
);
create index if not exists orders_shop_time on public.orders (shop_id, created_at desc);

create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  price integer not null,
  qty integer not null check (qty between 1 and 99)
);
create index if not exists order_items_order on public.order_items (order_id);

create table if not exists public.payments (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  amount integer not null check (amount > 0),
  method text not null check (method in ('tap', 'alert', 'notification', 'online')),
  created_at timestamptz not null default now()
);
create index if not exists payments_shop_time on public.payments (shop_id, created_at desc);

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 500),
  contact text not null default '' check (char_length(contact) <= 80),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_note text
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  shop_id uuid,
  detail text not null default '',
  created_at timestamptz not null default now()
);

-- Running ShopDesk as a business: your settings (one row), vendors' plan payments to you, and notices to all vendors.
create table if not exists public.settings (
  id integer primary key default 1 check (id = 1),
  monthly_price integer not null default 0 check (monthly_price between 0 and 10000000),
  trial_days integer not null default 30 check (trial_days between 0 and 365),
  grace_days integer not null default 7 check (grace_days between 0 and 60),
  close_unpaid boolean not null default true,
  pay_bank text not null default '' check (char_length(pay_bank) <= 30),
  pay_account_number text not null default '' check (char_length(pay_account_number) <= 20),
  pay_account_name text not null default '' check (char_length(pay_account_name) <= 60),
  admin_whatsapp text not null default '' check (char_length(admin_whatsapp) <= 20),
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;
-- Invites (update 015): on or off, the free months for each side; which shop invited a shop, and when the reward was given.
alter table public.settings add column if not exists invites_on boolean not null default false;
alter table public.settings add column if not exists invite_months integer not null default 1 check (invite_months between 0 and 12);
alter table public.settings add column if not exists invited_months integer not null default 1 check (invited_months between 0 and 12);
alter table public.shops add column if not exists invited_by uuid references public.shops(id) on delete set null;
alter table public.shops add column if not exists invite_rewarded_at timestamptz;
create index if not exists shops_invited_by on public.shops (invited_by) where invited_by is not null;

create table if not exists public.plan_payments (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  amount integer not null check (amount between 0 and 100000000),
  months integer not null check (months between 1 and 24),
  note text not null default '' check (char_length(note) <= 200),
  paid_until timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists plan_payments_shop on public.plan_payments (shop_id, created_at desc);

create table if not exists public.announcements (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 3 and 80),
  body text not null default '' check (char_length(body) <= 600),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Customers who make an account: their saved details for the next order. Their order history comes from orders.customer_id.
create table if not exists public.customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 60),
  phone text not null default '' check (char_length(phone) <= 20),
  address text not null default '' check (char_length(address) <= 160),
  updated_at timestamptz not null default now()
);

-- Problems ("confirm or complain"): up to 3 days after delivery (or once the promised delivery time has passed) the customer
-- can report one problem with an order. The shop has 48 hours to answer: refund, send it again, or explain. The customer then
-- says it's sorted or asks ShopDesk (you) to decide. If the shop doesn't answer in 48 hours, it comes to you automatically.
--   status: open (waiting for the shop) -> answered (waiting for the customer) -> sorted, or with_shopdesk -> decided
create table if not exists public.problems (
  id bigint generated always as identity primary key,
  order_id bigint not null unique references public.orders(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('not_arrived', 'wrong_item', 'damaged', 'missing_item', 'other')),
  details text not null check (char_length(details) between 10 and 600),
  photos text[] not null default '{}' check (cardinality(photos) <= 3),
  status text not null default 'open' check (status in ('open', 'answered', 'with_shopdesk', 'sorted', 'decided')),
  reply text check (reply in ('refund', 'resend', 'explain')),
  reply_note text not null default '' check (char_length(reply_note) <= 600),
  reply_photos text[] not null default '{}' check (cardinality(reply_photos) <= 3),
  refund_amount integer check (refund_amount > 0),
  refund_received_at timestamptz,
  answered_at timestamptz,
  escalated_at timestamptz,
  escalated_by text check (escalated_by in ('customer', 'no_reply')),
  decision text check (decision in ('customer', 'shop')),
  decision_note text not null default '' check (char_length(decision_note) <= 600),
  decided_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists problems_shop on public.problems (shop_id, created_at desc);
create index if not exists problems_customer on public.problems (customer_id, created_at desc);

-- Chat inside an order, between the shop and the customer who placed it. Nobody can edit or delete a message, so the chat is
-- the record if a problem comes to you. You read a chat only when the order has a problem with you, or a report.
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid references auth.users(id) on delete set null,
  sender text not null check (sender in ('shop', 'customer')),
  body text not null default '' check (char_length(body) <= 1000),
  photo text check (char_length(photo) <= 200),
  created_at timestamptz not null default now(),
  check (char_length(body) > 0 or photo is not null)
);
create index if not exists messages_order on public.messages (order_id, id);

-- Alerts: one row for each thing someone should hear about (a new order, money in, on its way, a message...).
-- The app shows them straight away; the push sender sends them to phones that turned alerts on.
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id bigint references public.orders(id) on delete cascade,
  kind text not null check (char_length(kind) <= 30),
  title text not null check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 300),
  url text not null default '/' check (char_length(url) <= 200),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz,
  emailed_at timestamptz
);
create index if not exists notifications_user on public.notifications (user_id, id desc);
create index if not exists notifications_email_wait on public.notifications (created_at) where emailed_at is null and read_at is null;
create index if not exists notifications_unpushed on public.notifications (id) where pushed_at is null;

-- Phones that turned alerts on (web push), and the key ShopDesk signs alerts with. Only the push sender reads these.
create table if not exists public.push_subs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subs_user on public.push_subs (user_id);
-- Customers you block for abuse: they can't order, write, or report. (A shop that misbehaves is suspended instead.)
create table if not exists public.blocked_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 300),
  created_by uuid,
  created_at timestamptz not null default now()
);
-- Your private copy of a shop that was deleted (by you, or with its account): the shop, its products, every order with
-- its items, payments, chat and problem, its reports and plan payments. Only you can open it, and each look is logged.
create table if not exists public.archives (
  id bigint generated always as identity primary key,
  shop_id uuid not null,
  shop_name text not null,
  slug text not null,
  owner_email text,
  reason text not null default '',
  deleted_by uuid,
  data jsonb not null,
  purged boolean not null default false,
  created_at timestamptz not null default now()
);
-- Email backup: when you last had ShopDesk open, whether you want the emails, and the secret in each email's
-- "Stop these emails" link. Only the database's own functions read it.
create table if not exists public.email_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  emails_on boolean not null default true,
  token uuid not null unique default gen_random_uuid(),
  seen_at timestamptz,
  sent_at timestamptz,
  sent_day date,
  sent_today int not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.push_keys (
  id integer primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- upgrades for databases made with an earlier version of this file ----------
-- Vetting: new shops wait for your approval before their order page opens.
alter table public.shops add column if not exists sells text not null default '' check (char_length(sells) <= 120);
alter table public.shops add column if not exists location text not null default '' check (char_length(location) <= 80);
alter table public.shops add column if not exists social text not null default '' check (char_length(social) <= 80);
alter table public.shops add column if not exists reviewed_at timestamptz;
alter table public.shops add column if not exists review_note text not null default '' check (char_length(review_note) <= 300);
alter table public.shops add column if not exists details_changed_at timestamptz;
alter table public.shops drop constraint if exists shops_status_check;
alter table public.shops add constraint shops_status_check check (status in ('pending', 'active', 'suspended', 'banned', 'rejected'));
alter table public.shops alter column status set default 'pending';
-- Link names ShopDesk uses for its own pages can't be taken by a shop.
alter table public.shops drop constraint if exists shops_slug_reserved;
alter table public.shops add constraint shops_slug_reserved check (slug not in ('admin', 'privacy', 'orders', 'order', 'login', 'signin', 'shopdesk', 'help', 'support', 'api', 'app', 'email-off', 'account', 'shops'));
-- Plans: a shop is open until paid_until (plus the grace days in settings).
alter table public.shops add column if not exists paid_until timestamptz;
update public.shops set paid_until = coalesce(reviewed_at, created_at) + make_interval(days => (select trial_days from public.settings where id = 1))
  where status = 'active' and paid_until is null;
-- Products you hide stay hidden: vendors can't show them again.
alter table public.products add column if not exists hidden_by_admin boolean not null default false;
alter table public.products add column if not exists hidden_reason text not null default '' check (char_length(hidden_reason) <= 200);
-- When a customer tapped "I've sent the money".
alter table public.orders add column if not exists customer_says_paid_at timestamptz;
-- Order tracking: who ordered (if signed in), when the shop confirmed, the rider and the promised delivery time, and who confirmed receipt.
alter table public.orders add column if not exists customer_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists confirmed_at timestamptz;
alter table public.orders add column if not exists out_at timestamptz;
alter table public.orders add column if not exists rider_name text not null default '' check (char_length(rider_name) <= 60);
alter table public.orders add column if not exists rider_phone text not null default '' check (char_length(rider_phone) <= 20);
alter table public.orders add column if not exists deliver_by timestamptz;
alter table public.orders add column if not exists received_at timestamptz;
alter table public.orders add column if not exists received_by text check (received_by in ('customer', 'shop'));
create index if not exists orders_customer on public.orders (customer_id, created_at desc);
-- Order codes: the shop's initials plus the order number (Bimpe's Beauty -> BB-1043), for customers' transfer notes.
-- Set once when the shop is made and never changed, so codes in old transfers still match.
alter table public.shops add column if not exists order_prefix text not null default '' check (order_prefix ~ '^[A-Z]{0,3}$');
create or replace function public.order_prefix_for(p_name text) returns text
language sql immutable set search_path = public as $$
  select coalesce(nullif(case when coalesce(array_length(w, 1), 0) >= 2 then upper(left(w[1], 1) || left(w[2], 1)) else upper(left(coalesce(w[1], ''), 2)) end, ''), 'SD')
  from (select array_remove(regexp_split_to_array(regexp_replace(coalesce(p_name, ''), '[^A-Za-z ]', '', 'g'), '\s+'), '') w) x;
$$;
update public.shops set order_prefix = public.order_prefix_for(name) where order_prefix = '';
-- Packing checklist: every item is ticked as packed before the order goes to a rider or is collected. An optional packing photo.
alter table public.order_items add column if not exists packed boolean not null default false;
alter table public.orders add column if not exists packing_photo text check (char_length(packing_photo) <= 200);
-- Reports can name the order they're about, and who sent them (when signed in).
alter table public.reports add column if not exists order_id bigint references public.orders(id) on delete set null;
alter table public.reports add column if not exists reporter_id uuid references auth.users(id) on delete set null;
-- Refunds you order: when you decide a customer was right, the shop has 48 hours to refund or its page stops taking orders.
alter table public.problems add column if not exists owed_amount integer check (owed_amount > 0);
alter table public.problems add column if not exists owed_by timestamptz;
alter table public.problems add column if not exists owed_sent_at timestamptz;
alter table public.problems add column if not exists owed_paid_at timestamptz;
alter table public.problems add column if not exists owed_cleared_by text check (owed_cleared_by in ('customer', 'admin', 'auto'));
-- The shop's proof that it sent the refund (a photo of the transfer), and when the customer said it didn't arrive.
alter table public.problems add column if not exists owed_receipt text check (char_length(owed_receipt) <= 200);
alter table public.problems add column if not exists owed_disputed_at timestamptz;
-- Reports can be about one chat message, and about the customer (a shop reporting a rude customer) as well as the shop.
alter table public.reports add column if not exists message_id bigint references public.messages(id) on delete set null;
alter table public.reports add column if not exists about text not null default 'shop' check (about in ('shop', 'customer'));
-- Why an order was cancelled (the customer sees it): not paid in 48 hours, by the customer, or the shop's reason.
alter table public.orders add column if not exists cancel_reason text check (cancel_reason in ('unpaid', 'customer', 'out_of_stock', 'cant_deliver', 'customer_asked', 'other'));
alter table public.orders add column if not exists cancel_note text not null default '' check (char_length(cancel_note) <= 200);
-- A shop message with an account number that isn't the shop's: a payment-scam warning sign, shown to you.
alter table public.messages add column if not exists flag text check (flag in ('other_account'));
-- What the customer saw: each order line keeps the product photo from the moment of the order (older orders get today's).
alter table public.order_items add column if not exists photo_path text check (char_length(photo_path) <= 200);
update public.order_items i set photo_path = p.photo_path from public.products p where i.product_id = p.id and i.photo_path is null;
-- Sale prices: what the customer pays instead of the price, until the shop takes it off.
alter table public.products add column if not exists sale_price integer;
alter table public.products drop constraint if exists products_sale_price_check;
alter table public.products add constraint products_sale_price_check check (sale_price is null or (sale_price > 0 and sale_price < price));
-- Choices: a product can come in sizes (or colours, packs...), one list per product, each with its own price, sale price and
-- stock. What the list is called ("Size") is the product's option_label. A product with choices takes its price (the lowest)
-- and its stock (all of them added up) from them; see product_options_sync.
alter table public.products add column if not exists option_label text not null default '' check (char_length(option_label) <= 20);
create table if not exists public.product_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  price integer not null check (price > 0 and price <= 100000000),
  sale_price integer check (sale_price is null or (sale_price > 0 and sale_price < price)),
  stock integer not null default 0 check (stock >= 0),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists product_options_product on public.product_options (product_id, sort_order);
-- Each order line keeps the choice it was for (the line's name says it too: "Sweet Obsession · 50ml").
alter table public.order_items add column if not exists option_id uuid references public.product_options(id) on delete set null;
alter table public.order_items add column if not exists option_name text not null default '' check (char_length(option_name) <= 30);
-- The customer's map pin, when they tap "Use my current location". It goes with the address after 180 days.
alter table public.orders add column if not exists delivery_lat double precision check (delivery_lat between -90 and 90);
alter table public.orders add column if not exists delivery_lng double precision check (delivery_lng between -180 and 180);
-- The sales report (update 013): the customer's area, where they came from (Instagram, TikTok, a WhatsApp link...),
-- the price before a sale on each line, and the shop's monthly goal.
alter table public.orders add column if not exists area text not null default '' check (char_length(area) <= 40);
alter table public.orders add column if not exists source text not null default 'direct'
  check (source in ('whatsapp', 'instagram', 'tiktok', 'facebook', 'snapchat', 'x', 'direct'));
alter table public.order_items add column if not exists was_price integer check (was_price > 0);
alter table public.customers add column if not exists area text not null default '' check (char_length(area) <= 40);
alter table public.shops add column if not exists monthly_goal integer not null default 0 check (monthly_goal between 0 and 2000000000);
-- Money out: what a shop spends to run (restock, packaging, transport...), so Sales shows what's left.
-- ShopDesk plan payments are added here automatically (money_out_from_plan below).
create table if not exists public.money_out (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  amount integer not null check (amount > 0 and amount <= 1000000000),
  kind text not null default 'other' check (kind in ('restock', 'packaging', 'transport', 'data', 'rent', 'staff', 'ads', 'shopdesk', 'other')),
  note text not null default '' check (char_length(note) <= 80),
  spent_on date not null default ((now() at time zone 'Africa/Lagos')::date) check (spent_on >= date '2020-01-01'),
  created_at timestamptz not null default now()
);
create index if not exists money_out_shop on public.money_out (shop_id, spent_on);

-- ---------- helpers ----------
-- owner-lock.sql later pins is_admin() to your one owner account. If you run this file again, run owner-lock.sql again too.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.my_shop_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.shops where owner_id = auth.uid();
$$;

-- One email, one role. An account that has a shop (waiting, open, closed or turned down) can't shop,
-- and an account that has shopped can't open a shop. They use a different email for the other role.
create or replace function public.has_shop(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.shops where owner_id = p_user);
$$;

create or replace function public.has_shopped(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders where customer_id = p_user) or exists (select 1 from public.customers where user_id = p_user);
$$;

-- What the signed-in account is, so the app can explain before anyone fills in a form.
create or replace function public.my_account() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('vendor', public.has_shop(auth.uid()), 'customer', public.has_shopped(auth.uid()));
$$;

-- A shop takes orders when you've approved it and (once you charge a price and close unpaid shops) its plan hasn't run out past the grace days.
create or replace function public.shop_open(s public.shops) returns boolean
language sql stable security definer set search_path = public as $$
  select s.status = 'active' and coalesce((select not st.close_unpaid or st.monthly_price = 0 or s.paid_until is null or s.paid_until + make_interval(days => st.grace_days) > now()
    from public.settings st where st.id = 1), true);
$$;

-- An order's code, as customers and the shop see it (BB-1043).
create or replace function public.order_code(p_prefix text, p_id bigint) returns text
language sql immutable set search_path = public as $$
  select coalesce(nullif(p_prefix, ''), 'SD') || '-' || p_id;
$$;

-- A problem the shop hasn't answered within 48 hours goes to you, even before anyone opens it.
create or replace function public.problem_status(p public.problems) returns text
language sql stable set search_path = public as $$
  select case when p.status = 'open' and p.created_at < now() - interval '48 hours' then 'with_shopdesk' else p.status end;
$$;

-- Can the customer still report a problem? Up to 3 days after delivery, or once the promised delivery time has passed.
create or replace function public.can_report(o public.orders) returns boolean
language sql stable security definer set search_path = public as $$
  select ((o.status = 'delivered' and o.done_at > now() - interval '3 days') or (o.status = 'out' and o.deliver_by < now()))
    and not exists (select 1 from public.problems p where p.order_id = o.id);
$$;

-- Money and times the way people read them: ₦12,500 and Sat 8 Nov, 3pm (Lagos time).
create or replace function public.naira(p int) returns text
language sql immutable set search_path = public as $$
  select '₦' || to_char(coalesce(p, 0), 'FM999,999,999,990');
$$;
create or replace function public.lagos_time(p timestamptz) returns text
language sql stable set search_path = public as $$
  select replace(to_char(p at time zone 'Africa/Lagos', 'Dy FMDD Mon, FMHH12:MIam'), ':00', '');
$$;
create or replace function public.kind_text(p text) returns text
language sql immutable set search_path = public as $$
  select case p when 'not_arrived' then 'Didn''t arrive' when 'wrong_item' then 'Wrong item' when 'damaged' then 'Damaged'
    when 'missing_item' then 'Something missing' else 'Something else' end;
$$;

-- A shop that owes a refund past its deadline takes no new orders until it sends it with a receipt and the customer
-- doesn't say otherwise (or you clear it). A customer can't keep a shop paused by staying silent: see tidy().
create or replace function public.shop_owes(p_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.problems where shop_id = p_shop and owed_amount is not null and owed_paid_at is null and owed_by < now()
    and (owed_sent_at is null or owed_disputed_at is not null));
$$;

-- Chat stays open while the order is moving, for 7 days after it's done, and while a problem or a refund is open.
create or replace function public.can_chat(o public.orders) returns boolean
language sql stable security definer set search_path = public as $$
  select o.customer_id is not null and (o.status in ('awaiting', 'part', 'paid', 'out') or coalesce(o.done_at, o.created_at) > now() - interval '7 days'
    or exists (select 1 from public.problems p where p.order_id = o.id and (p.closed_at is null or (p.owed_amount is not null and p.owed_paid_at is null))));
$$;

-- Fair use. Blocked customers can't order, write or report.
create or replace function public.is_blocked(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocked_users where user_id = p_user);
$$;
-- Why a customer can't report a problem right now (null if they can): too many open, too many this month,
-- or too many decided against them lately.
create or replace function public.report_block(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.is_blocked(p_user) then 'Your account is blocked. Contact ShopDesk.'
    when (select count(*) from public.problems where customer_id = p_user and decision = 'shop' and decided_at > now() - interval '90 days') >= 2
      and (select max(decided_at) from public.problems where customer_id = p_user and decision = 'shop') > now() - interval '30 days'
      then 'Reporting is paused on your account for now. Contact ShopDesk.'
    when (select count(*) from public.problems where customer_id = p_user and status not in ('sorted', 'decided')) >= 2
      then 'You have 2 open problems. Wait for them to be sorted.'
    when (select count(*) from public.problems where customer_id = p_user and created_at > now() - interval '30 days') >= 3
      then 'You''ve reported 3 orders this month. Contact ShopDesk.'
  end;
$$;
-- The reason the customer sees for a cancelled order.
create or replace function public.cancel_text(p text) returns text
language sql immutable set search_path = public as $$
  select case p when 'unpaid' then 'not paid in 48 hours' when 'customer' then 'you cancelled it' when 'out_of_stock' then 'out of stock'
    when 'cant_deliver' then 'can''t deliver there' when 'customer_asked' then 'you asked to cancel' else 'cancelled by the shop' end;
$$;

-- Alerts. Nobody gets an alert about their own action.
create or replace function public.notify(p_user uuid, p_order bigint, p_kind text, p_title text, p_body text, p_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- you don't hear about your own actions; the automatic clean-up (tidy) tells everyone
  if p_user is null or (p_user = auth.uid() and coalesce(current_setting('shopdesk.system', true), '') <> 'on') then return; end if;
  insert into public.notifications (user_id, order_id, kind, title, body, url)
  values (p_user, p_order, p_kind, left(coalesce(p_title, ''), 120), left(coalesce(p_body, ''), 300), left(coalesce(p_url, '/'), 200));
end $$;
create or replace function public.notify_admins(p_kind text, p_title text, p_body text, p_url text) returns void
language sql security definer set search_path = public as $$
  select public.notify(user_id, null, p_kind, p_title, p_body, p_url) from public.admins;
$$;

-- ---------- row-level security ----------
alter table public.shops enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.reports enable row level security;
alter table public.admins enable row level security;
alter table public.audit_log enable row level security;
alter table public.settings enable row level security;
alter table public.plan_payments enable row level security;
alter table public.announcements enable row level security;
alter table public.customers enable row level security;
alter table public.problems enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subs enable row level security;
alter table public.push_keys enable row level security;
alter table public.blocked_users enable row level security;
alter table public.archives enable row level security;
alter table public.email_settings enable row level security;
alter table public.money_out enable row level security;
alter table public.product_options enable row level security;

drop policy if exists shops_owner_read on public.shops;
create policy shops_owner_read on public.shops for select to authenticated using (owner_id = auth.uid());
drop policy if exists shops_owner_insert on public.shops;
create policy shops_owner_insert on public.shops for insert to authenticated with check (owner_id = auth.uid() and status = 'pending');
drop policy if exists shops_owner_update on public.shops;
create policy shops_owner_update on public.shops for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists products_owner_all on public.products;
create policy products_owner_all on public.products for all to authenticated using (shop_id = public.my_shop_id()) with check (shop_id = public.my_shop_id());
-- A shop reads its products' choices. They're only changed through save_product, add_option_stock and orders.
drop policy if exists product_options_owner_read on public.product_options;
create policy product_options_owner_read on public.product_options for select to authenticated using (shop_id = public.my_shop_id());

drop policy if exists orders_owner_read on public.orders;
create policy orders_owner_read on public.orders for select to authenticated using (shop_id = public.my_shop_id());
drop policy if exists items_owner_read on public.order_items;
create policy items_owner_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.shop_id = public.my_shop_id()));
drop policy if exists money_out_owner on public.money_out;
create policy money_out_owner on public.money_out for all to authenticated using (shop_id = public.my_shop_id()) with check (shop_id = public.my_shop_id());
drop policy if exists payments_owner_read on public.payments;
create policy payments_owner_read on public.payments for select to authenticated using (shop_id = public.my_shop_id());
drop policy if exists customers_own on public.customers;
create policy customers_own on public.customers for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- A shop reads the problems reported on its own orders. Nobody writes to problems directly; the functions below do.
drop policy if exists problems_owner_read on public.problems;
create policy problems_owner_read on public.problems for select to authenticated using (shop_id = public.my_shop_id());
-- A chat is read by the shop and by the customer who placed the order. Messages are only added through send_message.
drop policy if exists messages_parties_read on public.messages;
create policy messages_parties_read on public.messages for select to authenticated using (shop_id = public.my_shop_id() or customer_id = auth.uid());
-- Everyone reads only their own alerts.
drop policy if exists notifications_own_read on public.notifications;
create policy notifications_own_read on public.notifications for select to authenticated using (user_id = auth.uid());
-- reports, admins, audit_log, push_subs, push_keys, blocked_users, archives and email_settings have no policies: nobody reads them directly; functions do.

-- Table rights: customers (anon) get nothing directly. Vendors can't change a shop's status or move money fields by hand.
revoke all on public.shops, public.products, public.orders, public.order_items, public.payments, public.reports, public.admins, public.audit_log, public.settings, public.plan_payments, public.announcements, public.customers, public.problems,
  public.messages, public.notifications, public.push_subs, public.push_keys, public.blocked_users, public.archives, public.email_settings, public.product_options,
  public.money_out from anon, authenticated;
grant select on public.shops to authenticated;
-- Vendors fill in these columns only; status, review fields and dates are set by the database and by you.
grant insert (owner_id, name, slug, bank, account_number, account_name, whatsapp, allow_part_payment, delivery_paid_by, sells, location, social) on public.shops to authenticated;
grant update (name, slug, bank, account_number, account_name, whatsapp, allow_part_payment, delivery_paid_by, sells, location, social, last_active_at, monthly_goal) on public.shops to authenticated;
-- Vendors hide a product instead of deleting it, so orders and your records keep it.
-- Changes to a product (name, photo, prices, choices, stock) go through save_product, which checks them; only hiding is direct.
grant select on public.products, public.product_options to authenticated;
grant insert (shop_id, name, price, stock, low_at, photo_path, active) on public.products to authenticated;
grant update (active) on public.products to authenticated;
grant select on public.orders, public.order_items, public.payments, public.problems, public.messages, public.notifications to authenticated;
-- A customer reads, saves and deletes only their own saved details (the policy above).
grant select, delete on public.customers to authenticated;
grant insert (user_id, name, phone, address, area) on public.customers to authenticated;
grant update (name, phone, address, area, updated_at) on public.customers to authenticated;
-- A shop keeps its own money out: adds, reads and removes (the policy above keeps it to its own rows).
grant select, delete on public.money_out to authenticated;
grant insert (shop_id, amount, kind, note, spent_on) on public.money_out to authenticated;

-- ---------- vetted shops: watch what changes after approval ----------
-- Once a shop has been approved, a change of name, link or payment account goes in your audit log,
-- and a changed payment account is flagged on your dashboard for two weeks (the usual way a scam starts).
create or replace function public.shops_watch_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare d text := '';
begin
  if old.status = 'pending' then return new; end if;
  if new.name is distinct from old.name then d := d || 'name: ' || old.name || ' -> ' || new.name || '; '; end if;
  if new.slug is distinct from old.slug then d := d || 'link: ' || old.slug || ' -> ' || new.slug || '; '; end if;
  if new.bank is distinct from old.bank or new.account_number is distinct from old.account_number or new.account_name is distinct from old.account_name then
    d := d || 'payment account: ' || old.bank || ' ' || old.account_number || ' (' || old.account_name || ') -> ' || new.bank || ' ' || new.account_number || ' (' || new.account_name || '); ';
    new.details_changed_at := now();
  end if;
  if d <> '' then insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'shop_changed', new.id, left(d, 300)); end if;
  return new;
end $$;
drop trigger if exists shops_watch_changes on public.shops;
create trigger shops_watch_changes before update on public.shops for each row execute function public.shops_watch_changes();

-- ---------- one email, one role ----------
create or replace function public.shops_one_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.has_shopped(new.owner_id) then
    raise exception 'This email is a customer account. Use another email for your shop.';
  end if;
  return new;
end $$;
drop trigger if exists shops_one_role on public.shops;
create trigger shops_one_role before insert on public.shops for each row execute function public.shops_one_role();

-- A new shop gets its order-code initials from its name.
create or replace function public.shops_set_prefix() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.order_prefix := public.order_prefix_for(new.name);
  return new;
end $$;
drop trigger if exists shops_set_prefix on public.shops;
create trigger shops_set_prefix before insert on public.shops for each row execute function public.shops_set_prefix();

create or replace function public.customers_one_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.has_shop(new.user_id) then
    raise exception 'This email runs a shop. Use another email to order.';
  end if;
  return new;
end $$;
drop trigger if exists customers_one_role on public.customers;
create trigger customers_one_role before insert or update on public.customers for each row execute function public.customers_one_role();

-- ---------- alerts: what the other side hears when an order moves ----------
-- The customer hears when the shop confirms, gets the money, sends it or marks it delivered;
-- the shop hears when the customer says they've paid or got it. (New orders, messages and problems alert from their own functions.)
create or replace function public.orders_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.shops; c text; cu text; su text; due int;
begin
  select * into s from public.shops where id = new.shop_id;
  c := public.order_code(s.order_prefix, new.id);
  cu := '/o/' || new.public_token;
  su := '/?order=' || new.id || '#orders';
  due := new.items_total + case when new.delivery_paid_by = 'customer' then coalesce(new.delivery_fee, 0) else 0 end - new.amount_paid;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform public.notify(new.customer_id, new.id, 'cancelled', s.name, c || ' was cancelled: ' || public.cancel_text(new.cancel_reason) || '.', cu);
    if new.cancel_reason = 'customer' then
      perform public.notify(s.owner_id, new.id, 'cancelled', new.customer_name || ' cancelled ' || c, 'The items are back in stock.', su);
    elsif new.cancel_reason = 'unpaid' then
      perform public.notify(s.owner_id, new.id, 'cancelled', c || ' cancelled', 'Not paid in 48 hours. The items are back in stock.', su);
    end if;
  elsif new.status = 'paid' and old.status in ('awaiting', 'part') then
    perform public.notify(new.customer_id, new.id, 'paid', s.name, c || ': payment received. Packing now.', cu);
  elsif new.status = 'part' and new.amount_paid > old.amount_paid then
    perform public.notify(new.customer_id, new.id, 'part_paid', s.name, c || ': ' || public.naira(new.amount_paid - old.amount_paid) || ' received. ' || public.naira(due) || ' left.', cu);
  elsif new.status in ('awaiting', 'part') and old.confirmed_at is null and new.confirmed_at is not null then
    perform public.notify(new.customer_id, new.id, 'confirmed', s.name, c || ' confirmed. Pay ' || public.naira(due) || '.', cu);
  elsif new.status in ('awaiting', 'part') and new.delivery_fee is distinct from old.delivery_fee then
    perform public.notify(new.customer_id, new.id, 'fee', s.name, c || ': delivery is now ' || public.naira(new.delivery_fee) || '. Pay ' || public.naira(due) || '.', cu);
  elsif new.status = 'out' and old.status <> 'out' then
    if new.mode = 'pickup' then
      perform public.notify(new.customer_id, new.id, 'ready', s.name, c || ' is ready. Collect from ' || public.lagos_time(new.deliver_by) || '.', cu);
    else
      perform public.notify(new.customer_id, new.id, 'out', s.name, c || ' is on its way with ' || new.rider_name || ', ' || new.rider_phone || '. By ' || public.lagos_time(new.deliver_by) || '.', cu);
    end if;
  elsif new.status = 'out' and new.deliver_by is distinct from old.deliver_by then
    perform public.notify(new.customer_id, new.id, 'moved', s.name, c || ': new time ' || public.lagos_time(new.deliver_by) || '.', cu);
  elsif new.status = 'delivered' and old.status <> 'delivered' and new.received_by = 'shop' then
    perform public.notify(new.customer_id, new.id, 'delivered', s.name, c || ' delivered. Got everything?', cu);
  elsif new.received_by = 'customer' and old.received_by is distinct from 'customer' then
    perform public.notify(s.owner_id, new.id, 'received', new.customer_name || ' got ' || c, 'Confirmed ' || public.lagos_time(now()) || '.', su);
  elsif new.customer_says_paid and not old.customer_says_paid then
    perform public.notify(s.owner_id, new.id, 'says_paid', new.customer_name || ' says they paid', c || ' · ' || public.naira(due) || '. Check your bank app.', su);
  end if;
  return null;
end $$;
drop trigger if exists orders_notify on public.orders;
create trigger orders_notify after update on public.orders for each row execute function public.orders_notify();

-- You hear about new shops waiting for approval.
create or replace function public.shops_notify_admins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_admins('new_shop', 'New shop waiting', new.name, '/admin#applications');
  return null;
end $$;
drop trigger if exists shops_notify_admins on public.shops;
create trigger shops_notify_admins after insert on public.shops for each row execute function public.shops_notify_admins();

-- ---------- ratings and Shops near you ----------
-- One rating per customer per shop (1 to 5 stars and a comment), only after a delivered order; everyone can read them.
create table if not exists public.shop_ratings (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  order_id bigint references public.orders(id) on delete set null,
  stars smallint not null check (stars between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 400),
  hidden_by_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, customer_id)
);
create index if not exists shop_ratings_shop on public.shop_ratings (shop_id, updated_at desc);
-- read and written only through the functions below
alter table public.shop_ratings enable row level security;
revoke all on public.shop_ratings from anon, authenticated;

-- "Funmi Adebayo" -> "Funmi A."
create or replace function public.short_name(p text) returns text
language sql immutable set search_path = public as $$
  select case when coalesce(trim(p), '') = '' then 'A customer'
    else (regexp_split_to_array(trim(p), '\s+'))[1] ||
      coalesce(' ' || upper(left((regexp_split_to_array(trim(p), '\s+'))[2], 1)) || '.', '') end;
$$;

-- A shop's average and number of ratings (ratings ShopDesk hid don't count).
create or replace function public.shop_rating(p_shop uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('rating', round(avg(stars)::numeric, 1), 'ratings', count(*))
  from public.shop_ratings where shop_id = p_shop and not hidden_by_admin;
$$;

-- The customer rates the shop from one of their delivered orders. A second order lets them change it; it stays one rating.
create or replace function public.rate_shop(p_token uuid, p_stars int, p_comment text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; s public.shops; v_new boolean; v_comment text;
begin
  if auth.uid() is null then raise exception 'Sign in to rate this shop.'; end if;
  select * into o from public.orders where public_token = p_token and customer_id = auth.uid();
  if not found then raise exception 'Only the customer who placed this order can rate the shop.'; end if;
  if o.status <> 'delivered' then raise exception 'You can rate the shop once your order is delivered.'; end if;
  if p_stars is null or p_stars not between 1 and 5 then raise exception 'Pick 1 to 5 stars.'; end if;
  if public.is_blocked(auth.uid()) then raise exception 'Your account can''t rate shops. Contact ShopDesk.'; end if;
  v_comment := left(trim(coalesce(p_comment, '')), 400);
  select * into s from public.shops where id = o.shop_id;
  v_new := not exists (select 1 from public.shop_ratings where shop_id = o.shop_id and customer_id = auth.uid());
  insert into public.shop_ratings (shop_id, customer_id, order_id, stars, comment)
  values (o.shop_id, auth.uid(), o.id, p_stars, v_comment)
  on conflict (shop_id, customer_id) do update
    set stars = excluded.stars, comment = excluded.comment, order_id = excluded.order_id, updated_at = now();
  perform public.notify(s.owner_id, o.id, 'rating',
    case when v_new then 'New rating: ' else 'Rating changed: ' end || p_stars || ' star' || case when p_stars = 1 then '' else 's' end,
    public.short_name(o.customer_name) || case when v_comment <> '' then ': ' || v_comment else ' rated your shop.' end,
    '/' || s.slug || '/ratings');
  return public.shop_rating(o.shop_id) || jsonb_build_object('stars', p_stars, 'comment', v_comment);
end $$;

-- What this customer gave the shop of this order, or null if they haven't rated it.
create or replace function public.my_shop_rating(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('stars', r.stars, 'comment', r.comment, 'at', r.updated_at)
  from public.orders o join public.shop_ratings r on r.shop_id = o.shop_id and r.customer_id = o.customer_id
  where o.public_token = p_token and o.customer_id = auth.uid();
$$;

-- A shop's ratings page: the average, how many of each star, and the newest 50 comments.
create or replace function public.shop_reviews(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', s.name, 'slug', s.slug) || public.shop_rating(s.id) || jsonb_build_object(
    'stars', (select jsonb_object_agg(k, (select count(*) from public.shop_ratings r where r.shop_id = s.id and not r.hidden_by_admin and r.stars = k))
      from generate_series(1, 5) k),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('who', x.who, 'stars', x.stars, 'comment', x.comment, 'at', x.updated_at, 'bought', x.bought)
        order by x.updated_at desc)
      from (select public.short_name(coalesce(nullif(c.name, ''), o.customer_name)) who, r.stars, r.comment, r.updated_at,
              (select string_agg(i.name, ', ' order by i.id) from public.order_items i where i.order_id = r.order_id) bought
            from public.shop_ratings r
            left join public.customers c on c.user_id = r.customer_id
            left join public.orders o on o.id = r.order_id
            where r.shop_id = s.id and not r.hidden_by_admin
            order by r.updated_at desc limit 50) x), '[]'::jsonb))
  from public.shops s where s.slug = lower(p_slug) and s.status = 'active';
$$;

-- Shops near you: every shop taking orders that has something to sell. The app sorts them by the customer's area.
create or replace function public.shops_near() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'slug', s.slug, 'sells', s.sells, 'location', s.location,
      'photo_path', (select p.photo_path from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin
        order by p.created_at desc limit 1)) || public.shop_rating(s.id) order by s.created_at), '[]'::jsonb)
  from public.shops s
  where public.shop_open(s) and not public.shop_owes(s.id)
    and exists (select 1 from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin);
$$;

-- ---------- customers: the order page ----------
create or replace function public.get_storefront(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shop', jsonb_build_object('name', s.name, 'slug', s.slug, 'bank', s.bank, 'account_number', s.account_number, 'account_name', s.account_name,
      'allow_part_payment', s.allow_part_payment, 'delivery_paid_by', s.delivery_paid_by) || public.shop_rating(s.id),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price, 'sale_price', p.sale_price, 'stock', p.stock,
        'photo_path', p.photo_path, 'option_label', p.option_label,
        'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price', o.price, 'sale_price', o.sale_price, 'stock', o.stock)
          order by o.sort_order, o.created_at) from public.product_options o where o.product_id = p.id), '[]'::jsonb)) order by p.created_at desc)
      from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin), '[]'::jsonb))
  from public.shops s where s.slug = lower(p_slug) and public.shop_open(s) and not public.shop_owes(s.id);
$$;

-- Places an order in one step: checks every item belongs to the shop, holds the stock, and returns a private token
-- the customer uses to see their order. Stock is locked row by row, so two customers can't take the last piece.
-- Customers must be signed in: every order belongs to an account, so it shows in their order history.
-- Each item is { product_id, qty } plus option_id for a product with choices; it costs the sale price when there is one.
-- A delivery can come with a map pin (p_customer lat and lng, from "Use my current location"); then the address may be left out.
create or replace function public.place_order(p_slug text, p_customer jsonb, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shop public.shops; v_order public.orders; v_item jsonb; v_prod public.products; v_opt public.product_options; v_qty int; v_total int := 0;
  v_mode text; v_price int; v_full int; v_addr text; v_lat float8; v_lng float8; v_area text; v_source text;
begin
  if auth.uid() is null then raise exception 'Sign in to order.'; end if;
  if public.has_shop(auth.uid()) then raise exception 'This email runs a shop. Use another email to order.'; end if;
  if public.is_blocked(auth.uid()) then raise exception 'Your account can''t place orders. Contact ShopDesk.'; end if;
  select * into v_shop from public.shops where slug = lower(p_slug);
  if not found or not public.shop_open(v_shop) or public.shop_owes(v_shop.id) then raise exception 'This shop isn''t taking orders right now.'; end if;
  perform public.tidy(v_shop.id);
  -- no holding a shop's stock with orders you don't pay for
  if (select count(*) from public.orders where shop_id = v_shop.id and customer_id = auth.uid() and status = 'awaiting' and amount_paid = 0) >= 3 then
    raise exception 'You have 3 unpaid orders here. Pay or cancel one first.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then raise exception 'Pick between 1 and 30 items.'; end if;
  v_mode := coalesce(p_customer->>'mode', 'delivery');
  if v_mode not in ('delivery', 'pickup') then raise exception 'Choose delivery or pick-up.'; end if;
  if char_length(trim(coalesce(p_customer->>'name', ''))) = 0 then raise exception 'Add your name.'; end if;
  if v_mode = 'delivery' and jsonb_typeof(p_customer->'lat') = 'number' and jsonb_typeof(p_customer->'lng') = 'number' then
    v_lat := round((p_customer->>'lat')::numeric, 6); v_lng := round((p_customer->>'lng')::numeric, 6);
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 or (v_lat = 0 and v_lng = 0) then v_lat := null; v_lng := null; end if;
  end if;
  v_addr := case when v_mode = 'delivery' then left(trim(coalesce(p_customer->>'address', '')), 160) else '' end;
  if v_mode = 'delivery' and char_length(v_addr) < 3 then
    if v_lat is null then raise exception 'Add a delivery address.'; end if;
    v_addr := 'Map pin ' || round(v_lat::numeric, 5) || ', ' || round(v_lng::numeric, 5);
  end if;
  -- the area picked at checkout (deliveries only), and where the customer came from (for the shop's report)
  v_area := case when v_mode = 'delivery' then left(trim(coalesce(p_customer->>'area', '')), 40) else '' end;
  v_source := case when p_customer->>'source' in ('whatsapp', 'instagram', 'tiktok', 'facebook', 'snapchat', 'x') then p_customer->>'source' else 'direct' end;
  -- no more than 10 orders a minute per shop from the order page, to stop floods
  if (select count(*) from public.orders where shop_id = v_shop.id and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Too many orders at once. Try again in a minute.';
  end if;
  insert into public.orders (shop_id, customer_id, customer_name, customer_phone, mode, address, items_total, delivery_paid_by, delivery_lat, delivery_lng, area, source)
  values (v_shop.id, auth.uid(), left(trim(p_customer->>'name'), 60), left(trim(coalesce(p_customer->>'phone', '')), 20), v_mode,
          v_addr, 0, v_shop.delivery_paid_by, v_lat, v_lng, v_area, v_source)
  returning * into v_order;
  -- signed-in customers: remember their details for next time (an address they typed, not a map pin)
  if auth.uid() is not null then
    insert into public.customers (user_id, name, phone, address, area)
    values (auth.uid(), v_order.customer_name, v_order.customer_phone, case when v_addr like 'Map pin %' then '' else v_addr end, v_area)
    on conflict (user_id) do update set name = excluded.name, phone = excluded.phone,
      address = case when excluded.address <> '' then excluded.address else public.customers.address end,
      area = case when excluded.area <> '' then excluded.area else public.customers.area end, updated_at = now();
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 99 then raise exception 'Each item needs a quantity from 1 to 99.'; end if;
    select * into v_prod from public.products where id = (v_item->>'product_id')::uuid and shop_id = v_shop.id and active and not hidden_by_admin for update;
    if not found then raise exception 'An item is no longer available.'; end if;
    v_opt := null;
    if exists (select 1 from public.product_options where product_id = v_prod.id) then
      select * into v_opt from public.product_options where id = nullif(v_item->>'option_id', '')::uuid and product_id = v_prod.id for update;
      if not found then raise exception 'Choose a % for %.', lower(coalesce(nullif(v_prod.option_label, ''), 'size')), v_prod.name; end if;
      if v_opt.stock = 0 then raise exception '% (%) is sold out.', v_prod.name, v_opt.name; end if;
      if v_opt.stock < v_qty then raise exception '% (%) has only % left.', v_prod.name, v_opt.name, v_opt.stock; end if;
      update public.product_options set stock = stock - v_qty where id = v_opt.id;
      v_price := coalesce(v_opt.sale_price, v_opt.price); v_full := v_opt.price;
    else
      if v_prod.stock = 0 then raise exception '% is sold out.', v_prod.name; end if;
      if v_prod.stock < v_qty then raise exception '% has only % left.', v_prod.name, v_prod.stock; end if;
      update public.products set stock = stock - v_qty where id = v_prod.id;
      v_price := coalesce(v_prod.sale_price, v_prod.price); v_full := v_prod.price;
    end if;
    insert into public.order_items (order_id, product_id, option_id, option_name, name, price, qty, photo_path, was_price)
    values (v_order.id, v_prod.id, v_opt.id, coalesce(v_opt.name, ''), v_prod.name || coalesce(' · ' || v_opt.name, ''), v_price, v_qty, v_prod.photo_path,
            case when v_price < v_full then v_full end);
    v_total := v_total + v_price * v_qty;
  end loop;
  update public.orders set items_total = v_total where id = v_order.id;
  perform public.notify(v_shop.owner_id, v_order.id, 'new_order', 'New order ' || public.order_code(v_shop.order_prefix, v_order.id),
    v_order.customer_name || ' · ' || public.naira(v_total) || case when v_mode = 'pickup' then ' · pick-up' else '' end, '/?order=' || v_order.id || '#orders');
  return jsonb_build_object('order_id', v_order.id, 'token', v_order.public_token, 'items_total', v_total,
    'delivery_pending', v_mode = 'delivery' and v_shop.delivery_paid_by = 'customer');
end $$;

-- What a customer sees about their own order (needs the private token from place_order).
create or replace function public.get_order_public(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('order_id', o.id, 'status', o.status, 'mode', o.mode, 'items_total', o.items_total, 'delivery_fee', o.delivery_fee,
    'delivery_paid_by', o.delivery_paid_by, 'amount_paid', o.amount_paid, 'customer_says_paid', o.customer_says_paid,
    'created_at', o.created_at, 'confirmed_at', o.confirmed_at, 'paid_at', o.paid_at, 'out_at', o.out_at, 'deliver_by', o.deliver_by,
    'received_at', o.received_at, 'received_by', o.received_by, 'done_at', o.done_at,
    'rider_name', case when o.status = 'out' or (o.status = 'delivered' and o.done_at > now() - interval '2 days') then o.rider_name end,
    'rider_phone', case when o.status = 'out' or (o.status = 'delivered' and o.done_at > now() - interval '2 days') then o.rider_phone end,
    'saved', o.customer_id is not null, 'mine', o.customer_id is not null and o.customer_id = auth.uid(),
    'to_pay', o.items_total + case when o.delivery_paid_by = 'customer' then coalesce(o.delivery_fee, 0) else 0 end,
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'price', i.price, 'qty', i.qty) order by i.id) from public.order_items i where i.order_id = o.id),
    'shop', jsonb_build_object('name', s.name, 'slug', s.slug, 'bank', s.bank, 'account_number', s.account_number, 'account_name', s.account_name),
    'code', public.order_code(s.order_prefix, o.id),
    'report_until', case when o.status = 'delivered' then o.done_at + interval '3 days' end,
    'can_report', coalesce(o.customer_id = auth.uid(), false) and public.can_report(o),
    'has_problem', exists (select 1 from public.problems p where p.order_id = o.id),
    'can_chat', coalesce(o.customer_id = auth.uid(), false) and public.can_chat(o),
    'report_block', case when o.customer_id = auth.uid() then public.report_block(auth.uid()) end,
    'pay_by', case when o.status = 'awaiting' and o.amount_paid = 0 and not o.customer_says_paid then o.created_at + interval '48 hours' end,
    'can_cancel', coalesce(o.customer_id = auth.uid(), false) and o.status = 'awaiting' and o.amount_paid = 0 and not o.customer_says_paid,
    'cancel_reason', o.cancel_reason, 'cancel_note', o.cancel_note,
    -- the problem itself, only for the customer who placed the order
    'problem', case when o.customer_id is not null and o.customer_id = auth.uid() then (select jsonb_build_object(
        'kind', p.kind, 'details', p.details, 'photos', to_jsonb(p.photos), 'status', public.problem_status(p),
        'escalated_by', coalesce(p.escalated_by, case when public.problem_status(p) = 'with_shopdesk' and p.status = 'open' then 'no_reply' end),
        'reply', p.reply, 'reply_note', p.reply_note, 'reply_photos', to_jsonb(p.reply_photos), 'refund_amount', p.refund_amount,
        'refund_received_at', p.refund_received_at, 'created_at', p.created_at, 'reply_by', p.created_at + interval '48 hours', 'answered_at', p.answered_at,
        'decision', p.decision, 'decision_note', p.decision_note, 'decided_at', p.decided_at,
        'owed_amount', p.owed_amount, 'owed_by', p.owed_by, 'owed_sent_at', p.owed_sent_at, 'owed_paid_at', p.owed_paid_at,
        'owed_receipt', p.owed_receipt, 'owed_disputed_at', p.owed_disputed_at, 'owed_cleared_by', p.owed_cleared_by)
      from public.problems p where p.order_id = o.id) end)
  from public.orders o join public.shops s on s.id = o.shop_id where o.public_token = p_token;
$$;

-- The customer taps "I've sent the money" on their order page. The shop still checks its bank app before marking it paid;
-- if it doesn't confirm within a day, the order shows up in your Needs attention list.
-- Only the account that placed an order can say they've paid or got it, so a shop can't confirm for its customer.
-- (Orders from before accounts have no owner: anyone with the link, except a shop account.)
create or replace function public.customer_order(p_token uuid) returns public.orders
language plpgsql stable security definer set search_path = public as $$
declare v public.orders;
begin
  select * into v from public.orders where public_token = p_token;
  if not found then raise exception 'Order not found.'; end if;
  if public.has_shop(auth.uid()) then raise exception 'This email runs a shop. Use another email to order.'; end if;
  if v.customer_id is not null and v.customer_id is distinct from auth.uid() then
    raise exception 'Sign in with the email you ordered with.';
  end if;
  return v;
end $$;

create or replace function public.customer_says_paid(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.customer_order(p_token);
begin
  update public.orders set customer_says_paid = true, customer_says_paid_at = coalesce(customer_says_paid_at, now())
  where id = v.id and status in ('awaiting', 'part');
  if not found then raise exception 'This order is already paid or closed.'; end if;
end $$;

-- The customer confirms they got it. Works once it's with the rider (or ready for pick-up), and also after the shop has marked it delivered.
create or replace function public.customer_received(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.customer_order(p_token);
begin
  update public.orders set status = 'delivered', done_at = coalesce(done_at, now()), received_at = now(), received_by = 'customer'
  where id = v.id and (status = 'out' or (status = 'paid' and mode = 'pickup') or (status = 'delivered' and received_by is distinct from 'customer'));
  if not found then raise exception 'This order can''t be marked received yet.'; end if;
  -- the shop sent it again after a problem, and now it's arrived: the problem is sorted
  update public.problems set status = 'sorted', closed_at = now() where order_id = v.id and status = 'answered' and reply = 'resend';
end $$;

-- A signed-in customer's order history, newest first.
create or replace function public.my_orders() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('token', o.public_token, 'order_id', o.id, 'code', public.order_code(s.order_prefix, o.id), 'shop', s.name, 'slug', s.slug,
      'status', o.status, 'mode', o.mode, 'created_at', o.created_at, 'deliver_by', o.deliver_by, 'received_by', o.received_by,
      'problem', (select public.problem_status(p) from public.problems p where p.order_id = o.id),
      'to_pay', o.items_total + case when o.delivery_paid_by = 'customer' then coalesce(o.delivery_fee, 0) else 0 end,
      'items', (select string_agg(i.qty || ' × ' || i.name, ', ' order by i.id) from public.order_items i where i.order_id = o.id)) order by o.created_at desc), '[]'::jsonb)
  from public.orders o join public.shops s on s.id = o.shop_id where auth.uid() is not null and o.customer_id = auth.uid();
$$;

-- Orders placed before signing in are saved to the account using their private links (kept on the customer's phone).
create or replace function public.claim_orders(p_tokens uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if public.has_shop(auth.uid()) then raise exception 'This email runs a shop. Use another email to order.'; end if;
  if p_tokens is null or array_length(p_tokens, 1) is null then return 0; end if;
  if array_length(p_tokens, 1) > 50 then raise exception 'Too many orders at once.'; end if;
  update public.orders set customer_id = auth.uid() where public_token = any(p_tokens) and customer_id is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- "Report this shop". From an order page (or with an order picked) the report names the order, so you see what was ordered and when.
drop function if exists public.report_shop(text, text, text);
create or replace function public.report_shop(p_slug text, p_reason text, p_contact text, p_token uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_shop public.shops; v_order bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to report a shop.'; end if;
  if public.is_blocked(auth.uid()) then raise exception 'Your account is blocked. Contact ShopDesk.'; end if;
  select * into v_shop from public.shops where slug = lower(p_slug);
  if not found then raise exception 'Shop not found.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Say what went wrong.'; end if;
  if exists (select 1 from public.reports where shop_id = v_shop.id and reporter_id = auth.uid() and resolved_at is null and message_id is null) then
    raise exception 'You''ve already reported this shop. ShopDesk is on it.'; end if;
  if (select count(*) from public.reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You''ve sent a few reports today. Try again tomorrow.'; end if;
  if (select count(*) from public.reports where shop_id = v_shop.id and created_at > now() - interval '1 hour') >= 20 then raise exception 'Too many reports for this shop right now.'; end if;
  if p_token is not null then
    select id into v_order from public.orders where public_token = p_token and shop_id = v_shop.id and (customer_id is null or customer_id = auth.uid());
  end if;
  insert into public.reports (shop_id, reason, contact, order_id, reporter_id)
  values (v_shop.id, left(trim(p_reason), 500), left(trim(coalesce(p_contact, '')), 80), v_order, auth.uid());
  perform public.notify_admins('report', 'Report · ' || v_shop.name, left(trim(p_reason), 200), '/admin#reports');
end $$;

-- The customer reports a problem: what went wrong, a sentence or two, and up to 3 photos they've uploaded to the order's folder.
create or replace function public.report_problem(p_token uuid, p_kind text, p_details text, p_photos text[] default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.customer_order(p_token); ph text; s public.shops; why text;
begin
  if auth.uid() is null or v.customer_id is distinct from auth.uid() then raise exception 'Sign in with the email you ordered with.'; end if;
  if exists (select 1 from public.problems where order_id = v.id) then raise exception 'You''ve already reported this order.'; end if;
  if not public.can_report(v) then raise exception 'You can report up to 3 days after delivery.'; end if;
  why := public.report_block(auth.uid());
  if why is not null then raise exception '%', why; end if;
  if p_kind is null or p_kind not in ('not_arrived', 'wrong_item', 'damaged', 'missing_item', 'other') then raise exception 'Choose what went wrong.'; end if;
  if char_length(trim(coalesce(p_details, ''))) < 10 then raise exception 'Say what happened.'; end if;
  if cardinality(coalesce(p_photos, '{}')) > 3 then raise exception 'Add up to 3 photos.'; end if;
  -- evidence: a photo of what arrived, for a wrong, damaged or missing item
  if p_kind in ('wrong_item', 'damaged', 'missing_item') and cardinality(coalesce(p_photos, '{}')) = 0 then raise exception 'Add a photo of what you got.'; end if;
  foreach ph in array coalesce(p_photos, '{}') loop
    if ph !~ ('^' || v.id || '/c-[0-9a-f-]{36}\.jpg$') then raise exception 'A photo didn''t attach. Add it again.'; end if;
  end loop;
  insert into public.problems (order_id, shop_id, customer_id, kind, details, photos)
  values (v.id, v.shop_id, auth.uid(), p_kind, left(trim(p_details), 600), coalesce(p_photos, '{}'));
  select * into s from public.shops where id = v.shop_id;
  perform public.notify(s.owner_id, v.id, 'problem', 'Problem · ' || public.order_code(s.order_prefix, v.id),
    public.kind_text(p_kind) || '. Answer by ' || public.lagos_time(now() + interval '48 hours') || '.', '/?order=' || v.id || '#orders');
end $$;

-- The customer answers the shop: it's sorted, the refund arrived, or ask ShopDesk to decide (once the shop has answered or 48 hours have passed).
create or replace function public.problem_customer(p_token uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.customer_order(p_token); pr public.problems; st text; s public.shops; c text; su text;
begin
  if auth.uid() is null or v.customer_id is distinct from auth.uid() then raise exception 'Sign in with the email you ordered with.'; end if;
  select * into pr from public.problems where order_id = v.id for update;
  if not found then raise exception 'There''s no problem on this order.'; end if;
  select * into s from public.shops where id = v.shop_id;
  c := public.order_code(s.order_prefix, v.id);
  su := '/?order=' || v.id || '#orders';
  st := public.problem_status(pr);
  -- a refund you ordered: the customer confirms it arrived (the shop's page takes orders again), or says it didn't (you look)
  if p_action = 'refund_received' and pr.owed_amount is not null and pr.owed_paid_at is null then
    update public.problems set owed_paid_at = now(), owed_cleared_by = 'customer', refund_received_at = coalesce(refund_received_at, now()) where id = pr.id;
    perform public.notify(s.owner_id, v.id, 'refund_ok', 'Refund confirmed · ' || c, v.customer_name || ' got the ' || public.naira(pr.owed_amount) || ' refund.', su);
    return;
  end if;
  if p_action = 'refund_missing' then
    if pr.owed_amount is null or pr.owed_sent_at is null then raise exception 'The shop hasn''t said it sent the refund yet.'; end if;
    if pr.owed_disputed_at is not null and pr.owed_paid_at is null then raise exception 'ShopDesk is already on it.'; end if;
    if pr.owed_paid_at is not null and (pr.owed_cleared_by <> 'auto' or pr.owed_paid_at < now() - interval '7 days') then raise exception 'This refund is closed. Contact ShopDesk.'; end if;
    update public.problems set owed_disputed_at = now(), owed_paid_at = null, owed_cleared_by = null where id = pr.id;
    perform public.notify(s.owner_id, v.id, 'refund_missing', 'Refund not received · ' || c, v.customer_name || ' says the refund didn''t arrive. ShopDesk will check.', su);
    perform public.notify_admins('admin_refund', 'Refund disputed · ' || c, s.name || ' · ' || public.naira(pr.owed_amount), '/admin#problems');
    return;
  end if;
  if st in ('sorted', 'decided') then raise exception 'This problem is already closed.'; end if;
  if p_action = 'sorted' then
    update public.problems set status = 'sorted', closed_at = now() where id = pr.id;
    perform public.notify(s.owner_id, v.id, 'problem_sorted', 'Sorted · ' || c, v.customer_name || ' says it''s sorted.', su);
  elsif p_action = 'refund_received' then
    if pr.reply is distinct from 'refund' then raise exception 'The shop hasn''t sent a refund.'; end if;
    update public.problems set status = 'sorted', refund_received_at = now(), closed_at = now() where id = pr.id;
    perform public.notify(s.owner_id, v.id, 'refund_ok', 'Refund confirmed · ' || c, v.customer_name || ' got the refund.', su);
  elsif p_action = 'escalate' then
    if st = 'open' then raise exception 'The shop has until % to answer.', public.lagos_time(pr.created_at + interval '48 hours'); end if;
    if st = 'with_shopdesk' then raise exception 'ShopDesk is already on it.'; end if;
    update public.problems set status = 'with_shopdesk', escalated_at = now(), escalated_by = 'customer' where id = pr.id;
    perform public.notify(s.owner_id, v.id, 'problem_escalated', 'ShopDesk is deciding · ' || c, 'The customer asked ShopDesk to decide.', su);
    perform public.notify_admins('admin_problem', 'Problem needs you · ' || c, s.name || ' · ' || public.kind_text(pr.kind), '/admin#problems');
  else
    raise exception 'Choose what to do.';
  end if;
end $$;

-- Cancelled orders: their items go back on sale. A line with a choice goes back to that choice; a line for a choice the
-- shop has since removed has nowhere to go. Lines are added up first, so the same product twice in one order counts twice.
-- The products are locked first, in the same order everything else locks them (product, then choice).
create or replace function public.restock(p_orders bigint[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.products where id in (select product_id from public.order_items where order_id = any(p_orders)) order by id for update;
  update public.product_options po set stock = po.stock + i.qty
  from (select option_id, sum(qty)::int qty from public.order_items where order_id = any(p_orders) and option_id is not null group by option_id) i
  where po.id = i.option_id;
  update public.products p set stock = p.stock + i.qty
  from (select product_id, sum(qty)::int qty from public.order_items
        where order_id = any(p_orders) and option_id is null and option_name = '' and product_id is not null group by product_id) i
  where p.id = i.product_id and not exists (select 1 from public.product_options o where o.product_id = p.id);
end $$;

-- The customer cancels an unpaid order (before saying they've paid). The items go back on sale.
create or replace function public.customer_cancel(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.customer_order(p_token);
begin
  if auth.uid() is null or v.customer_id is distinct from auth.uid() then raise exception 'Sign in with the email you ordered with.'; end if;
  if v.status <> 'awaiting' or v.amount_paid > 0 then raise exception 'Only unpaid orders can be cancelled.'; end if;
  if v.customer_says_paid then raise exception 'You said you''ve paid. Message the shop.'; end if;
  perform public.restock(array[v.id]);
  update public.orders set status = 'cancelled', done_at = now(), cancel_reason = 'customer' where id = v.id;
end $$;

-- ---------- chat and alerts ----------
-- Chat inside an order. The shop and the customer who placed it can write; photos go in the order's private folder.
create or replace function public.send_message(p_order bigint, p_body text, p_photo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders; s public.shops; who text; m public.messages; b text := left(trim(coalesce(p_body, '')), 1000); c text; f text;
begin
  select * into v from public.orders where id = p_order;
  if not found then raise exception 'Order not found.'; end if;
  select * into s from public.shops where id = v.shop_id;
  if s.owner_id = auth.uid() then who := 'shop';
  elsif v.customer_id is not null and v.customer_id = auth.uid() then who := 'customer';
  else raise exception 'Order not found.'; end if;
  if who = 'customer' and public.is_blocked(auth.uid()) then raise exception 'Your account can''t send messages. Contact ShopDesk.'; end if;
  if not public.can_chat(v) then raise exception 'Chat is closed for this order.'; end if;
  if b = '' and p_photo is null then raise exception 'Write a message.'; end if;
  if p_photo is not null and p_photo !~ ('^' || v.id || '/m-[0-9a-f-]{36}\.jpg$') then raise exception 'That photo can''t be sent. Try again.'; end if;
  if (select count(*) from public.messages where order_id = v.id and sender = who and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Slow down a little.'; end if;
  -- a shop sending an account number that isn't its own: a scam warning sign for you (the customer sees a warning too)
  if who = 'shop' and exists (select 1 from regexp_matches(regexp_replace(b, '[\s.-]', '', 'g'), '\d+', 'g') x
                              where char_length(x[1]) = 10 and x[1] <> regexp_replace(s.account_number, '\D', '', 'g')) then
    f := 'other_account';
  end if;
  insert into public.messages (order_id, shop_id, customer_id, sender, body, photo, flag) values (v.id, v.shop_id, v.customer_id, who, b, p_photo, f) returning * into m;
  c := public.order_code(s.order_prefix, v.id);
  if f is not null then
    insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'other_account', s.id, left('Order ' || c || ': ' || b, 300));
    perform public.notify_admins('admin_flag', 'Possible scam · ' || s.name, c || ': sent a different account number in chat.', '/admin#attention');
  end if;
  if who = 'shop' then
    perform public.notify(v.customer_id, v.id, 'message', s.name, case when b = '' then 'Photo' else b end, '/o/' || v.public_token || '#chat');
  else
    perform public.notify(s.owner_id, v.id, 'message', v.customer_name || ' · ' || c, case when b = '' then 'Photo' else b end, '/?chat=' || v.id || '#orders');
  end if;
  return to_jsonb(m);
end $$;

-- Report one message from the other side (rude, threatening, a scam...). You see it with the whole chat.
create or replace function public.report_message(p_message bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.messages; v public.orders; s public.shops; who text;
begin
  select * into m from public.messages where id = p_message;
  if not found then raise exception 'Message not found.'; end if;
  select * into v from public.orders where id = m.order_id;
  select * into s from public.shops where id = m.shop_id;
  if s.owner_id = auth.uid() then who := 'shop';
  elsif v.customer_id is not null and v.customer_id = auth.uid() then who := 'customer';
  else raise exception 'Message not found.'; end if;
  if m.sender = who then raise exception 'You can''t report your own message.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Say what''s wrong with it.'; end if;
  if exists (select 1 from public.reports where message_id = m.id and reporter_id = auth.uid()) then raise exception 'You''ve already reported this message.'; end if;
  if (select count(*) from public.reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve sent a lot of reports today. Try again tomorrow.'; end if;
  insert into public.reports (shop_id, reason, order_id, reporter_id, message_id, about)
  values (s.id, left(trim(p_reason), 500), v.id, auth.uid(), m.id, case when m.sender = 'shop' then 'shop' else 'customer' end);
  perform public.notify_admins('report', 'Message reported · ' || s.name, left(trim(p_reason), 200), '/admin#reports');
end $$;
-- Marks your alerts as seen: all of them, one order's, or one kind (for example the messages in a chat you opened).
create or replace function public.mark_read(p_order bigint default null, p_kind text default null) returns void
language sql security definer set search_path = public as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null
    and (p_order is null or order_id = p_order) and (p_kind is null or kind = p_kind);
$$;

-- A phone turns alerts on or off. One account can have up to 10 phones and browsers.
create or replace function public.save_push_sub(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or char_length(coalesce(p_p256dh, '')) not between 40 and 200 or char_length(coalesce(p_auth, '')) not between 10 and 100 then
    raise exception 'Alerts couldn''t be turned on. Try again.'; end if;
  insert into public.push_subs (user_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, last_seen_at = now();
  delete from public.push_subs where user_id = auth.uid()
    and id not in (select id from public.push_subs where user_id = auth.uid() order by last_seen_at desc, id desc limit 10);
end $$;
create or replace function public.delete_push_sub(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subs where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- For the push sender only (it connects to the database directly; the app can't call these).
-- push_claim takes the alerts not sent yet, with the phones of the people they're for. Alerts older than an hour are skipped.
create or replace function public.push_claim(p_limit int default 100) returns jsonb
language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  update public.notifications set pushed_at = now() where pushed_at is null and created_at < now() - interval '1 hour';
  if random() < 0.02 then delete from public.notifications where created_at < now() - interval '90 days'; end if;
  with c as (
    update public.notifications n set pushed_at = now()
    where n.id in (select id from public.notifications where pushed_at is null order by id limit greatest(1, least(coalesce(p_limit, 100), 500)) for update skip locked)
    returning n.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'user_id', c.user_id, 'order_id', c.order_id, 'kind', c.kind, 'title', c.title, 'body', c.body, 'url', c.url,
      'subs', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)), '[]'::jsonb)
               from public.push_subs ps where ps.user_id = c.user_id)) order by c.id), '[]'::jsonb) into out from c;
  return out;
end $$;
create or replace function public.push_drop(p_endpoints text[]) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subs where endpoint = any(coalesce(p_endpoints, '{}'));
$$;
create or replace function public.push_key() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('public_key', public_key, 'private_jwk', private_jwk) from public.push_keys where id = 1;
$$;
create or replace function public.push_key_init(p_public text, p_jwk jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  insert into public.push_keys (id, public_key, private_jwk) values (1, p_public, p_jwk) on conflict (id) do nothing;
  return public.push_key();
end $$;

-- ---------- email backup ----------
-- If something happens and you haven't had ShopDesk open for 10 minutes, one email lists what you missed (with a button
-- straight to it). Fair to everyone's inbox: at most one email every 30 minutes and 10 a day, nothing older than a day,
-- each alert in one email at most, and a "Stop these emails" link in every one (also a switch in the app).

-- The app says "I'm open" when it opens, when it comes back into view, and every few minutes while on screen.
create or replace function public.seen_app() returns void
language sql security definer set search_path = public as $$
  insert into public.email_settings (user_id, seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = now() where email_settings.seen_at is null or email_settings.seen_at < now() - interval '30 seconds';
$$;
-- The switch in the app (My orders for customers, the Shop tab for shops).
create or replace function public.my_email_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('on', coalesce((select emails_on from public.email_settings where user_id = auth.uid()), true),
    'email', (select email from auth.users where id = auth.uid()));
$$;
create or replace function public.set_email_alerts(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into public.email_settings (user_id, emails_on) values (auth.uid(), coalesce(p_on, true))
  on conflict (user_id) do update set emails_on = coalesce(p_on, true), updated_at = now();
end $$;
-- The "Stop these emails" page: works from the link in an email without signing in. p_on null only reads.
create or replace function public.email_by_token(p_token uuid, p_on boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.email_settings; m text;
begin
  if p_on is null then select * into e from public.email_settings where token = p_token;
  else update public.email_settings set emails_on = p_on, updated_at = now() where token = p_token returning * into e; end if;
  if not found then raise exception 'This link has expired.'; end if;
  select email into m from auth.users where id = e.user_id;
  -- show the address only partly (b***@gmail.com): the link may have been forwarded
  return jsonb_build_object('on', e.emails_on, 'email', regexp_replace(coalesce(m, ''), '^(.).*(@.*)$', '\1***\2'));
end $$;

-- For the push sender only. Takes the people who have alerts waiting (older than 10 minutes, not read, and newer than
-- the last time they opened ShopDesk), marks those alerts as emailed and returns them with each person's address.
create or replace function public.email_claim(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u record; e public.email_settings; a jsonb; out jsonb := '[]'::jsonb; today date := (now() at time zone 'Africa/Lagos')::date;
  sh public.shops;
begin
  for u in
    select n.user_id from public.notifications n left join public.email_settings s on s.user_id = n.user_id
    where n.emailed_at is null and n.read_at is null and n.created_at < now() - interval '10 minutes' and n.created_at > now() - interval '24 hours'
      and coalesce(s.emails_on, true) and (s.seen_at is null or s.seen_at < n.created_at)
      and (s.sent_at is null or s.sent_at < now() - interval '30 minutes') and (s.sent_day is distinct from today or s.sent_today < 10)
    group by n.user_id order by min(n.id) limit greatest(1, least(coalesce(p_limit, 20), 100))
  loop
    insert into public.email_settings (user_id) values (u.user_id) on conflict (user_id) do nothing;
    select * into e from public.email_settings where user_id = u.user_id for update skip locked;
    -- another run is sending to this person right now, or just did
    if not found or (e.sent_at is not null and e.sent_at > now() - interval '30 minutes') then continue; end if;
    with c as (
      update public.notifications n set emailed_at = now()
      where n.id in (select id from public.notifications where user_id = u.user_id and emailed_at is null and read_at is null
        and created_at > now() - interval '24 hours' and (e.seen_at is null or created_at > e.seen_at) order by id limit 50 for update skip locked)
      returning n.*)
    select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title, 'body', c.body, 'url', c.url, 'at', c.created_at) order by c.id) into a from c;
    if a is null then continue; end if;
    update public.email_settings set sent_at = now(), sent_today = case when sent_day = today then sent_today + 1 else 1 end, sent_day = today
    where user_id = u.user_id;
    select * into sh from public.shops where owner_id = u.user_id;
    out := out || jsonb_build_array(jsonb_build_object('user_id', u.user_id, 'email', (select email from auth.users where id = u.user_id), 'token', e.token,
      'who', case when sh.id is not null then 'shop' when exists (select 1 from public.admins where user_id = u.user_id) then 'admin' else 'customer' end,
      'shop', sh.name, 'alerts', a));
  end loop;
  return out;
end $$;
-- An email that didn't go out: its alerts wait for the next one (in 30 minutes).
create or replace function public.email_unclaim(p_user uuid, p_ids bigint[]) returns void
language sql security definer set search_path = public as $$
  update public.notifications set emailed_at = null where user_id = p_user and id = any(coalesce(p_ids, '{}'));
  update public.email_settings set sent_today = greatest(sent_today - 1, 0) where user_id = p_user;
$$;

-- ---------- vendors: moving an order along ----------
create or replace function public.owned_order(p_order bigint) returns public.orders
language plpgsql security definer set search_path = public as $$
declare v public.orders;
begin
  select * into v from public.orders where id = p_order and shop_id = public.my_shop_id() for update;
  if not found then raise exception 'Order not found.'; end if;
  return v;
end $$;

create or replace function public.set_delivery_fee(p_order bigint, p_fee int) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if v.mode <> 'delivery' then raise exception 'This order is a pick-up.'; end if;
  if v.status not in ('awaiting', 'part') then raise exception 'The fee is locked once paid.'; end if;
  if p_fee is null or p_fee < 0 or p_fee > 1000000 then raise exception 'Enter a delivery fee in naira.'; end if;
  update public.orders set delivery_fee = p_fee, delivery_by = 'shop', delivery_quote = null, confirmed_at = coalesce(confirmed_at, now()) where id = v.id;
end $$;

-- The shop confirms it has the order and the price is right (orders with a customer-paid delivery fee are confirmed by setting the fee).
create or replace function public.confirm_order(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if v.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if v.mode = 'delivery' and v.delivery_paid_by = 'customer' and v.delivery_fee is null then raise exception 'Set the delivery fee first.'; end if;
  update public.orders set confirmed_at = coalesce(confirmed_at, now()) where id = v.id;
end $$;

-- Handing a paid order to a dispatch rider: the rider's name and number and the delivery time are required, so the customer can call the rider and knows when to expect it.
-- Changing the time later is allowed, but it's written to your audit log.
-- Packing checklist: tick each item as it goes in the bag. Every item must be ticked before the order goes out.
create or replace function public.pack_item(p_item bigint, p_packed boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_order bigint; v public.orders;
begin
  select order_id into v_order from public.order_items where id = p_item;
  if v_order is null then raise exception 'Item not found.'; end if;
  v := public.owned_order(v_order);
  if v.status not in ('awaiting', 'part', 'paid') then raise exception 'This order has already gone out.'; end if;
  update public.order_items set packed = coalesce(p_packed, false) where id = p_item;
end $$;

-- An optional photo of the packed order, the shop's proof of what was sent (only the shop, the customer if there's a problem, and you see it).
create or replace function public.set_packing_photo(p_order bigint, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if p_path is not null and p_path !~ ('^' || v.id || '/pack-[0-9a-f-]{36}\.jpg$') then raise exception 'That photo can''t be used. Take it again.'; end if;
  update public.orders set packing_photo = p_path where id = v.id;
end $$;

create or replace function public.hand_to_rider(p_order bigint, p_rider_name text, p_rider_phone text, p_deliver_by timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if v.mode <> 'delivery' then raise exception 'This is a pick-up order.'; end if;
  if v.status not in ('paid', 'out') then raise exception 'Only paid orders can go out.'; end if;
  if v.status = 'paid' and exists (select 1 from public.order_items where order_id = v.id and not packed) then raise exception 'Tick every item as packed first.'; end if;
  if char_length(trim(coalesce(p_rider_name, ''))) < 2 then raise exception 'Enter the rider''s name.'; end if;
  -- the customer taps "Call rider", so it must be a Nigerian mobile number that rings (0803 123 4567, +234 803 123 4567)
  if regexp_replace(coalesce(p_rider_phone, ''), '\D', '', 'g') !~ '^(234|0)?[789][01][0-9]{8}$' then raise exception 'Check the rider''s number, like 0803 123 4567.'; end if;
  if p_deliver_by is null or p_deliver_by < now() - interval '5 minutes' or p_deliver_by > now() + interval '14 days' then raise exception 'Pick a delivery time within 14 days.'; end if;
  if v.status = 'out' and v.deliver_by is distinct from p_deliver_by then
    insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'delivery_moved', v.shop_id,
      'Order #' || v.id || ': promised ' || to_char(v.deliver_by at time zone 'Africa/Lagos', 'Dy DD Mon HH24:MI') || ', now ' || to_char(p_deliver_by at time zone 'Africa/Lagos', 'Dy DD Mon HH24:MI'));
  end if;
  update public.orders set status = 'out', out_at = coalesce(out_at, now()), rider_name = left(trim(p_rider_name), 60), rider_phone = left(trim(p_rider_phone), 20),
    deliver_by = p_deliver_by, confirmed_at = coalesce(confirmed_at, now()) where id = v.id;
end $$;

-- A paid pick-up order is packed and waiting; the customer sees from when they can collect it.
create or replace function public.mark_ready(p_order bigint, p_ready_by timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if v.mode <> 'pickup' then raise exception 'This is a delivery order.'; end if;
  if v.status not in ('paid', 'out') then raise exception 'Only paid orders can be made ready.'; end if;
  if v.status = 'paid' and exists (select 1 from public.order_items where order_id = v.id and not packed) then raise exception 'Tick every item as packed first.'; end if;
  if p_ready_by is null or p_ready_by < now() - interval '5 minutes' or p_ready_by > now() + interval '14 days' then raise exception 'Pick a time within 14 days.'; end if;
  update public.orders set status = 'out', out_at = coalesce(out_at, now()), deliver_by = p_ready_by, confirmed_at = coalesce(confirmed_at, now()) where id = v.id;
end $$;

create or replace function public.confirm_payment(p_order bigint, p_method text default 'tap', p_amount int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order); v_shop public.shops; v_due int; v_amt int;
begin
  select * into v_shop from public.shops where id = v.shop_id;
  if v.status not in ('awaiting', 'part') then raise exception 'This order is already paid or closed.'; end if;
  if v.mode = 'delivery' and v.delivery_paid_by = 'customer' and v.delivery_fee is null then raise exception 'Set the delivery fee first.'; end if;
  v_due := v.items_total + case when v.delivery_paid_by = 'customer' then coalesce(v.delivery_fee, 0) else 0 end - v.amount_paid;
  v_amt := coalesce(p_amount, v_due);
  if v_amt <= 0 or v_amt > v_due then raise exception 'Enter an amount up to %.', public.naira(v_due); end if;
  if v_amt < v_due and not v_shop.allow_part_payment then raise exception 'Part payments are off. Ask for the full %.', public.naira(v_due); end if;
  insert into public.payments (order_id, shop_id, amount, method) values (v.id, v.shop_id, v_amt, coalesce(p_method, 'tap'));
  update public.orders set amount_paid = amount_paid + v_amt, customer_says_paid = false, confirmed_at = coalesce(confirmed_at, now()),
    status = case when v_amt >= v_due then 'paid' else 'part' end,
    paid_at = case when v_amt >= v_due then now() else paid_at end
  where id = v.id;
  return jsonb_build_object('paid', v_amt, 'left', v_due - v_amt);
end $$;

create or replace function public.mark_customer_says_paid(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  update public.orders set customer_says_paid = true, customer_says_paid_at = coalesce(customer_says_paid_at, now()) where id = v.id and status in ('awaiting', 'part');
end $$;

create or replace function public.advance_order(p_order bigint) returns text
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order); v_next text;
begin
  if v.status = 'paid' and v.mode = 'delivery' then raise exception 'Hand it to a rider first.'; end if;
  if v.status = 'paid' and exists (select 1 from public.order_items where order_id = v.id and not packed) then raise exception 'Tick every item as packed first.'; end if;
  v_next := case when v.status in ('paid', 'out') then 'delivered' else null end;
  if v_next is null then raise exception 'Only paid orders can move on.'; end if;
  update public.orders set status = v_next, done_at = now(), received_by = 'shop' where id = v.id;
  return v_next;
end $$;

-- Cancelling an unpaid order puts its items back on the shelf. The shop gives a reason, which the customer sees.
drop function if exists public.cancel_order(bigint);
create or replace function public.cancel_order(p_order bigint, p_reason text default 'other', p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if v.status <> 'awaiting' or v.amount_paid > 0 then raise exception 'Only unpaid orders can be cancelled.'; end if;
  if coalesce(p_reason, '') not in ('out_of_stock', 'cant_deliver', 'customer_asked', 'other') then raise exception 'Choose why you''re cancelling.'; end if;
  -- the customer says the money is sent: check your bank app first; you can cancel a day after they said it
  if v.customer_says_paid and v.customer_says_paid_at > now() - interval '1 day' then
    raise exception 'The customer says they''ve paid. Check your bank app first.'; end if;
  perform public.restock(array[v.id]);
  update public.orders set status = 'cancelled', done_at = now(), cancel_reason = p_reason, cancel_note = left(trim(coalesce(p_note, '')), 200) where id = v.id;
end $$;

create or replace function public.add_stock(p_product uuid, p_qty int) returns int
language plpgsql security definer set search_path = public as $$
declare v int; v_label text;
begin
  if p_qty is null or p_qty < 1 or p_qty > 100000 then raise exception 'Enter how many came in.'; end if;
  select coalesce(nullif(p.option_label, ''), 'size') into v_label from public.products p
  where p.id = p_product and exists (select 1 from public.product_options o where o.product_id = p.id);
  if found then raise exception 'Add stock to each % instead.', lower(v_label); end if;
  update public.products set stock = stock + p_qty where id = p_product and shop_id = public.my_shop_id() returning stock into v;
  if v is null then raise exception 'Product not found.'; end if;
  return v;
end $$;

-- New stock for one choice (a size, a colour...). Returns that choice's stock.
create or replace function public.add_option_stock(p_option uuid, p_qty int) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if p_qty is null or p_qty < 1 or p_qty > 100000 then raise exception 'Enter how many came in.'; end if;
  perform 1 from public.products where id = (select product_id from public.product_options where id = p_option) for update;
  update public.product_options set stock = stock + p_qty where id = p_option and shop_id = public.my_shop_id() returning stock into v;
  if v is null then raise exception 'Product not found.'; end if;
  return v;
end $$;

-- A shop deletes a product for good. Past orders keep its name, price, size and photo (they're copied onto each order line).
-- Not while an open order has it (the stock is held for that order), and not one ShopDesk hid (that stays for the record).
create or replace function public.delete_product(p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.products;
begin
  select * into v from public.products where id = p_product and shop_id = public.my_shop_id() for update;
  if not found then raise exception 'That product isn''t in your shop. Refresh the page.'; end if;
  if v.hidden_by_admin then raise exception 'ShopDesk hid this product, so it stays. Message ShopDesk about it.'; end if;
  if exists (select 1 from public.order_items i join public.orders o on o.id = i.order_id
             where i.product_id = v.id and o.status in ('awaiting', 'part', 'paid', 'out')) then
    raise exception '% is in an order that isn''t finished yet. Hide it now, and delete it once that order is delivered or cancelled.', v.name;
  end if;
  delete from public.products where id = v.id;
end $$;

-- A product with choices: its price is the lowest choice's price and its stock all of theirs added up, so lists, counts
-- and Running low keep working. Its own sale price is cleared: each choice has its own.
create or replace function public.product_options_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid := coalesce(new.product_id, old.product_id);
begin
  update public.products p set price = x.price, stock = x.stock, sale_price = null
  from (select min(price) price, sum(stock)::int stock from public.product_options where product_id = v having count(*) > 0) x
  where p.id = v and (p.price, p.stock, p.sale_price) is distinct from (x.price, x.stock, null::int);
  return null;
end $$;
drop trigger if exists product_options_sync on public.product_options;
create trigger product_options_sync after insert or update or delete on public.product_options for each row execute function public.product_options_sync();

-- A whole number from the app's form, or null when it's missing or not a number.
create or replace function public.json_int(j jsonb) returns int
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(j) = 'number' and j::text::numeric between -2000000000 and 2000000000 then round(j::text::numeric)::int end;
$$;

-- Adds a product, or changes one, in a single step: name, photo, price and sale price, when to warn, and its choices
-- (what they're called, and each one's name, price, sale price and stock). Prices can change any time; orders already
-- placed keep the prices they were placed at. p is
--   { name, photo_path, price, sale_price, stock, low_at, option_label, options: [{ id, name, price, sale_price, stock }] }
-- With choices, price, sale_price and stock come from them. A stock left out (null) stays as it is; anything new needs one.
-- A choice left out of the list is removed (orders keep its name). Returns the product's id.
create or replace function public.save_product(p_product uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public.my_shop_id(); v public.products; v_opts jsonb := coalesce(nullif(p->'options', 'null'::jsonb), '[]'::jsonb); o jsonb;
  v_name text := trim(coalesce(p->>'name', '')); v_photo text := trim(coalesce(p->>'photo_path', ''));
  v_label text := trim(coalesce(p->>'option_label', '')); v_price int; v_sale int; v_stock int; v_low int;
  v_oname text; v_oprice int; v_osale int; v_ostock int; v_oid uuid; v_seen text[] := '{}'; v_keep uuid[]; i int := 0;
  UUID_RE constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if v_shop is null then raise exception 'Set up your shop first.'; end if;
  if p_product is not null then
    select * into v from public.products where id = p_product and shop_id = v_shop for update;
    if not found then raise exception 'That product isn''t in your shop. Refresh the page.'; end if;
  end if;
  if char_length(v_name) = 0 then raise exception 'Give the product a name.'; end if;
  if char_length(v_name) > 60 then raise exception 'Shorten the name to 60 letters or fewer.'; end if;
  if v_photo = '' then v_photo := coalesce(v.photo_path, ''); end if;
  if v_photo = '' then raise exception 'Add a photo. Customers want to see what they''re buying.'; end if;
  if v_photo is distinct from v.photo_path and (split_part(v_photo, '/', 1) <> v_shop::text or char_length(v_photo) not between 5 and 200) then
    raise exception 'Upload the photo again.'; end if;
  v_low := coalesce(public.json_int(p->'low_at'), v.low_at, 2);
  if v_low not between 0 and 100000 then raise exception 'Enter when to warn you as a number, like 3.'; end if;
  if jsonb_typeof(v_opts) <> 'array' then raise exception 'Something in the form isn''t right. Check it and try again.'; end if;
  if jsonb_array_length(v_opts) > 20 then raise exception 'A product can have up to 20 choices.'; end if;

  if jsonb_array_length(v_opts) = 0 then
    v_label := '';
    v_price := public.json_int(p->'price');
    if v_price is null or v_price < 1 then raise exception 'Enter a price in naira.'; end if;
    if v_price > 100000000 then raise exception 'The price can be up to ₦100,000,000.'; end if;
    v_sale := public.json_int(p->'sale_price');
    if v_sale is not null and (v_sale < 1 or v_sale >= v_price) then
      raise exception 'The sale price must be less than the price (%).', public.naira(v_price); end if;
    v_stock := public.json_int(p->'stock');
    if v_stock is null and (p_product is null or exists (select 1 from public.product_options where product_id = p_product)) then
      raise exception 'Enter how many you have (0 is fine).'; end if;
    if v_stock not between 0 and 1000000 then raise exception 'Enter how many you have, from 0 to 1,000,000.'; end if;
  else
    v_label := coalesce(nullif(v_label, ''), 'Size');
    if char_length(v_label) > 20 then raise exception 'Use a shorter word for the choices, like Size or Colour.'; end if;
    -- placeholders for a new product: the choices set its real price and stock just below
    v_price := least(greatest(coalesce((select min(public.json_int(e->'price')) from jsonb_array_elements(v_opts) e), 1), 1), 100000000);
    v_stock := 0;
  end if;

  if p_product is null then
    insert into public.products (shop_id, name, price, sale_price, stock, low_at, photo_path, option_label)
    values (v_shop, v_name, v_price, v_sale, v_stock, v_low, v_photo, v_label) returning * into v;
  else
    update public.products set name = v_name, photo_path = v_photo, low_at = v_low, option_label = v_label, sale_price = v_sale,
      price = case when jsonb_array_length(v_opts) = 0 then v_price else price end,
      stock = case when jsonb_array_length(v_opts) = 0 then coalesce(v_stock, stock) else stock end
    where id = v.id returning * into v;
  end if;

  -- the choices: removed ones go, the rest are changed or added in the order given
  v_keep := array(select (e->>'id')::uuid from jsonb_array_elements(v_opts) e where e->>'id' ~ UUID_RE);
  delete from public.product_options where product_id = v.id and not (id = any(v_keep));
  for o in select * from jsonb_array_elements(v_opts) loop
    i := i + 1;
    if jsonb_typeof(o) <> 'object' then raise exception 'Something in the form isn''t right. Check it and try again.'; end if;
    v_oname := trim(coalesce(o->>'name', ''));
    if char_length(v_oname) = 0 then raise exception 'Give each % a name, like Small or 50ml.', lower(v_label); end if;
    if char_length(v_oname) > 30 then raise exception 'Shorten "%" to 30 letters or fewer.', left(v_oname, 30); end if;
    if lower(v_oname) = any(v_seen) then raise exception 'Two choices are called "%". Give each one its own name.', v_oname; end if;
    v_seen := v_seen || lower(v_oname);
    v_oprice := public.json_int(o->'price');
    if v_oprice is null or v_oprice < 1 then raise exception 'Enter a price for %.', v_oname; end if;
    if v_oprice > 100000000 then raise exception 'The price for % can be up to ₦100,000,000.', v_oname; end if;
    v_osale := public.json_int(o->'sale_price');
    if v_osale is not null and (v_osale < 1 or v_osale >= v_oprice) then
      raise exception 'The sale price for % must be less than its price (%).', v_oname, public.naira(v_oprice); end if;
    v_ostock := public.json_int(o->'stock');
    if v_ostock not between 0 and 1000000 then raise exception 'Enter how many % you have, from 0 to 1,000,000.', v_oname; end if;
    v_oid := case when o->>'id' ~ UUID_RE then (o->>'id')::uuid end;
    if v_oid is not null then
      update public.product_options set name = v_oname, price = v_oprice, sale_price = v_osale, stock = coalesce(v_ostock, stock), sort_order = i
      where id = v_oid and product_id = v.id;
      if not found then raise exception 'This product changed while you were editing it. Refresh the page and try again.'; end if;
    else
      if v_ostock is null then raise exception 'Enter how many % you have (0 is fine).', v_oname; end if;
      insert into public.product_options (product_id, shop_id, name, price, sale_price, stock, sort_order)
      values (v.id, v_shop, v_oname, v_oprice, v_osale, v_ostock, i);
    end if;
  end loop;
  return v.id;
end $$;

-- The shop answers a problem within 48 hours: refund (and how much was sent back), send it again, or explain (with photos if it helps).
-- "Send it again" puts the order back to packing: tick the items again, then hand it to a rider.
-- A late answer is still recorded, but the problem stays with you.
create or replace function public.answer_problem(p_order bigint, p_reply text, p_note text, p_refund int default null, p_photos text[] default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order); pr public.problems; late boolean; ph text; s public.shops;
begin
  select * into pr from public.problems where order_id = v.id for update;
  if not found then raise exception 'There''s no problem on this order.'; end if;
  if pr.reply is not null or pr.status not in ('open', 'with_shopdesk') then raise exception 'You''ve already answered.'; end if;
  if p_reply is null or p_reply not in ('refund', 'resend', 'explain') then raise exception 'Choose how you''ll sort it.'; end if;
  if p_reply = 'explain' and char_length(trim(coalesce(p_note, ''))) < 10 then raise exception 'Say what happened.'; end if;
  if p_reply = 'refund' and (p_refund is null or p_refund < 1 or p_refund > greatest(v.amount_paid, 1)) then
    raise exception 'Enter the amount you sent back (up to %).', public.naira(v.amount_paid); end if;
  if cardinality(coalesce(p_photos, '{}')) > 3 then raise exception 'Add up to 3 photos.'; end if;
  foreach ph in array coalesce(p_photos, '{}') loop
    if ph !~ ('^' || v.id || '/(v|pack)-[0-9a-f-]{36}\.jpg$') then raise exception 'A photo didn''t attach. Add it again.'; end if;
  end loop;
  late := pr.status = 'with_shopdesk' or pr.created_at < now() - interval '48 hours';
  update public.problems set reply = p_reply, reply_note = left(trim(coalesce(p_note, '')), 600), reply_photos = coalesce(p_photos, '{}'),
    refund_amount = case when p_reply = 'refund' then p_refund end, answered_at = now(),
    status = case when late then 'with_shopdesk' else 'answered' end,
    escalated_at = case when late then coalesce(escalated_at, now()) else escalated_at end,
    escalated_by = case when late then coalesce(escalated_by, 'no_reply') else escalated_by end
  where id = pr.id;
  if p_reply = 'resend' then
    update public.order_items set packed = false where order_id = v.id;
    update public.orders set status = 'paid', out_at = null, deliver_by = null, done_at = null, received_at = null, received_by = null where id = v.id;
  end if;
  select * into s from public.shops where id = v.shop_id;
  perform public.notify(v.customer_id, v.id, 'problem_answer', s.name, public.order_code(s.order_prefix, v.id) || ': '
    || case p_reply when 'refund' then 'refund of ' || public.naira(p_refund) || ' sent. Confirm when it arrives.'
                    when 'resend' then 'sending it again.' else 'the shop answered.' end, '/o/' || v.public_token);
end $$;

-- The shop says it has sent the refund you ordered, with a photo of the transfer receipt. The customer confirms when it
-- arrives or says it didn't; if they do neither within 48 hours, it counts as received (see tidy()).
drop function if exists public.refund_sent(bigint);
create or replace function public.refund_sent(p_order bigint, p_receipt text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order); pr public.problems; s public.shops;
begin
  select * into pr from public.problems where order_id = v.id and owed_amount is not null and owed_paid_at is null for update;
  if not found then raise exception 'No refund is owed on this order.'; end if;
  if p_receipt is null or p_receipt !~ ('^' || v.id || '/r-[0-9a-f-]{36}\.jpg$') then raise exception 'Add a photo of the transfer receipt.'; end if;
  -- if the customer said it didn't arrive, only they (or you) can close it; a new receipt goes to you
  update public.problems set owed_sent_at = now(), owed_receipt = p_receipt where id = pr.id;
  select * into s from public.shops where id = v.shop_id;
  if pr.owed_disputed_at is not null then
    perform public.notify_admins('admin_refund', 'New refund receipt · ' || public.order_code(s.order_prefix, v.id), s.name || ' · ' || public.naira(pr.owed_amount), '/admin#problems');
  end if;
  perform public.notify(v.customer_id, v.id, 'refund_sent', s.name, public.order_code(s.order_prefix, v.id) || ': refund of '
    || public.naira(pr.owed_amount) || ' sent. Check your bank and tell us if it arrived.', '/o/' || v.public_token);
end $$;

-- ---------- you, the admin ----------
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object(
    'shops_total', (select count(*) from public.shops),
    'shops_new_7d', (select count(*) from public.shops where created_at > now() - interval '7 days'),
    'shops_active_7d', (select count(*) from public.shops where last_active_at > now() - interval '7 days'),
    'shops_suspended', (select count(*) from public.shops where status in ('suspended', 'banned')),
    'shops_pending', (select count(*) from public.shops where status = 'pending'),
    'applications', (select coalesce(jsonb_agg(x order by x->>'created_at'), '[]'::jsonb) from (
      select jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'status', s.status, 'owner_email', u.email, 'created_at', s.created_at,
        'sells', s.sells, 'location', s.location, 'social', s.social, 'whatsapp', s.whatsapp,
        'bank', s.bank, 'account_number', s.account_number, 'account_name', s.account_name,
        'products', (select count(*) from public.products p where p.shop_id = s.id and p.active),
        'photos', (select coalesce(jsonb_agg(q.photo_path), '[]'::jsonb) from (select photo_path from public.products p where p.shop_id = s.id and p.active order by p.created_at desc limit 6) q)) x
      from public.shops s left join auth.users u on u.id = s.owner_id where s.status = 'pending') t),
    'orders_today', (select count(*) from public.orders where created_at >= date_trunc('day', now())),
    'orders_7d', (select count(*) from public.orders where created_at > now() - interval '7 days'),
    'paid_value_7d', (select coalesce(sum(amount), 0) from public.payments where created_at > now() - interval '7 days'),
    'products_total', (select count(*) from public.products where active),
    'methods_30d', (select coalesce(jsonb_object_agg(method, n), '{}'::jsonb) from (select method, count(*) n from public.payments where created_at > now() - interval '30 days' group by method) m),
    'reports_open', (select count(*) from public.reports where resolved_at is null),
    'signups_14d', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'n', (select count(*) from public.shops s where s.created_at::date = d::date)) order by d), '[]'::jsonb)
                    from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d),
    'shops', (select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'status', s.status, 'owner_email', u.email, 'created_at', s.created_at, 'last_active_at', s.last_active_at,
        'whatsapp', s.whatsapp, 'sells', s.sells, 'location', s.location, 'review_note', s.review_note, 'details_changed_at', s.details_changed_at,
        'paid_until', s.paid_until, 'open', public.shop_open(s), 'products', (select count(*) from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin),
        'money_30d', (select coalesce(sum(amount), 0) from public.payments pm where pm.shop_id = s.id and pm.created_at > now() - interval '30 days'),
        'orders_7d', (select count(*) from public.orders o where o.shop_id = s.id and o.created_at > now() - interval '7 days'),
        'cancelled_30d', (select count(*) from public.orders o where o.shop_id = s.id and o.status = 'cancelled' and o.created_at > now() - interval '30 days'),
        'reports_open', (select count(*) from public.reports r where r.shop_id = s.id and r.resolved_at is null)) x
      from public.shops s left join auth.users u on u.id = s.owner_id) t));
end $$;

create or replace function public.admin_reports() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'shop', s.name, 'slug', s.slug, 'shop_id', s.id, 'reason', r.reason, 'contact', r.contact,
      'created_at', r.created_at, 'reporter', u.email, 'about', r.about, 'resolved_at', r.resolved_at, 'resolved_note', r.resolved_note,
      'message', (select jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'photo', m.photo, 'created_at', m.created_at) from public.messages m where m.id = r.message_id),
      'customer', case when r.about = 'customer' then (select jsonb_build_object('id', o.customer_id, 'name', o.customer_name, 'email', cu.email,
          'blocked', public.is_blocked(o.customer_id)) from public.orders o left join auth.users cu on cu.id = o.customer_id where o.id = r.order_id) end,
      'order', case when r.order_id is not null then public.admin_order_json(r.order_id) end,
      'their_orders', case when r.order_id is null and r.reporter_id is not null then
        (select coalesce(jsonb_agg(public.admin_order_json(o.id) order by o.created_at desc), '[]'::jsonb)
         from (select id, created_at from public.orders where shop_id = r.shop_id and customer_id = r.reporter_id order by created_at desc limit 5) o) end)
    order by r.created_at desc)
    from public.reports r join public.shops s on s.id = r.shop_id left join auth.users u on u.id = r.reporter_id
    where r.resolved_at is null or r.id in (select id from public.reports where resolved_at is not null order by resolved_at desc limit 50)), '[]'::jsonb);
end $$;

-- You read an order's chat without giving a reason when it has a problem with you (or one you decided), a report, or a
-- flagged message.
create or replace function public.admin_chat_free(v public.orders) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.problems p where p.order_id = v.id and public.problem_status(p) in ('with_shopdesk', 'decided'))
    or exists (select 1 from public.reports r where r.order_id = v.id) or exists (select 1 from public.messages m where m.order_id = v.id and m.flag is not null)
    or exists (select 1 from public.reports r where r.order_id is null and r.shop_id = v.shop_id and r.reporter_id = v.customer_id and r.resolved_at is null);
$$;

-- One order as you see it on Problems and Reports: what was ordered, the money, and when each step happened. No address or phone.
create or replace function public.admin_order_json(p_order bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'code', public.order_code(s.order_prefix, o.id), 'status', o.status, 'mode', o.mode, 'customer_name', o.customer_name,
    'items_total', o.items_total, 'delivery_fee', o.delivery_fee, 'delivery_paid_by', o.delivery_paid_by, 'amount_paid', o.amount_paid,
    'created_at', o.created_at, 'confirmed_at', o.confirmed_at, 'customer_says_paid_at', o.customer_says_paid_at, 'paid_at', o.paid_at, 'out_at', o.out_at,
    'deliver_by', o.deliver_by, 'done_at', o.done_at, 'received_by', o.received_by, 'rider_name', o.rider_name, 'packing_photo', o.packing_photo,
    'cancel_reason', o.cancel_reason, 'cancel_text', case when o.status = 'cancelled' then public.cancel_text(o.cancel_reason) end, 'cancel_note', o.cancel_note,
    'chat_free', public.admin_chat_free(o),
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'price', i.price, 'packed', i.packed, 'photo', i.photo_path) order by i.id) from public.order_items i where i.order_id = o.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('amount', pay.amount, 'method', pay.method, 'at', pay.created_at) order by pay.created_at), '[]'::jsonb)
      from public.payments pay where pay.order_id = o.id),
    'messages', (select count(*) from public.messages m where m.order_id = o.id),
    'problem', (select public.problem_status(p) from public.problems p where p.order_id = o.id))
  from public.orders o join public.shops s on s.id = o.shop_id where o.id = p_order;
$$;

-- An order's chat for you. Any other chat than the ones above opens only with a reason you write.
-- Every look, and its reason, goes in the audit log.
drop function if exists public.admin_order_chat(bigint);
create or replace function public.admin_order_chat(p_order bigint, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders; s public.shops; free boolean;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  select * into v from public.orders where id = p_order;
  if not found then raise exception 'Order not found.'; end if;
  free := public.admin_chat_free(v);
  if not free and char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Write why you''re reading this chat (it goes in the log).'; end if;
  select * into s from public.shops where id = v.shop_id;
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'chat_view', v.shop_id,
    left('Order ' || public.order_code(s.order_prefix, v.id) || case when free then '' else '. Reason: ' || trim(p_reason) end, 300));
  return jsonb_build_object('shop', s.name, 'customer', v.customer_name, 'code', public.order_code(s.order_prefix, v.id),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'photo', m.photo, 'flag', m.flag, 'created_at', m.created_at) order by m.id), '[]'::jsonb)
      from public.messages m where m.order_id = v.id));
end $$;

create or replace function public.admin_resolve_report(p_report bigint, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_shop uuid;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  update public.reports set resolved_at = now(), resolved_note = left(coalesce(p_note, ''), 300) where id = p_report returning shop_id into v_shop;
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'resolve_report', v_shop, 'report ' || p_report || ': ' || left(coalesce(p_note, ''), 300));
end $$;

create or replace function public.admin_set_shop_status(p_shop uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if p_status not in ('active', 'suspended', 'banned') then raise exception 'Unknown status.'; end if;
  if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Write the reason (it goes in the audit log).'; end if;
  update public.shops set status = p_status where id = p_shop;
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'set_status:' || p_status, p_shop, left(p_note, 300));
end $$;

-- Delete a shop for good. Its products, orders, order items, payments, reports and plan payments leave the app
-- (the database removes them together), but a private copy goes to Records first (see shops_archive), and all its
-- photos are kept (products, packing, problems, refund receipts, chat). You must type the shop's link name and a reason;
-- the audit log keeps a note of what was deleted.
-- To stop a vendor without losing their history, use "Close for good" (status banned) instead.
create or replace function public.admin_delete_shop(p_shop uuid, p_confirm_slug text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.shops; v_email text; v_orders int; v_products int; v_photos jsonb;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  select * into v from public.shops where id = p_shop for update;
  if not found then raise exception 'Shop not found.'; end if;
  if lower(trim(coalesce(p_confirm_slug, ''))) <> v.slug then raise exception 'Type the shop''s link name exactly to confirm.'; end if;
  if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Write the reason (it goes in the audit log).'; end if;
  select email into v_email from auth.users where id = v.owner_id;
  select count(*) into v_orders from public.orders where shop_id = v.id;
  select count(*), coalesce(jsonb_agg(photo_path) filter (where coalesce(photo_path, '') <> ''), '[]'::jsonb)
    into v_products, v_photos from public.products where shop_id = v.id;
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'delete_shop', v.id,
    left(format('Deleted %s (/%s, %s). Reason: %s. Removed %s orders and %s products.', v.name, v.slug, coalesce(v_email, 'no email'), trim(p_note), v_orders, v_products), 300));
  perform set_config('shopdesk.delete_reason', left(trim(p_note), 300), true);
  delete from public.shops where id = v.id;
  perform set_config('shopdesk.delete_reason', '', true);
  return jsonb_build_object('photos', v_photos, 'orders', v_orders, 'products', v_products);
end $$;

-- Vetting: approve or reject a shop that's waiting. Rejecting needs a reason. Both go in the audit log.
create or replace function public.admin_review_shop(p_shop uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.shops; v_note text := left(trim(coalesce(p_note, '')), 300);
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  select * into v from public.shops where id = p_shop for update;
  if not found then raise exception 'Shop not found.'; end if;
  if v.status not in ('pending', 'rejected') then raise exception 'This shop is not waiting for approval.'; end if;
  if not p_approve and char_length(v_note) < 5 then raise exception 'Write why the shop is not approved (the vendor sees it).'; end if;
  update public.shops set status = case when p_approve then 'active' else 'rejected' end, reviewed_at = now(), review_note = v_note,
    paid_until = case when p_approve then coalesce(paid_until, now() + make_interval(days => (select trial_days from public.settings where id = 1))) else paid_until end
  where id = p_shop;
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), case when p_approve then 'approve' else 'reject' end, p_shop, coalesce(nullif(v_note, ''), case when p_approve then 'approved' else '' end));
end $$;

-- Support view: a shop's recent orders WITH customer details and what each ordered, only with a written reason, and always logged.
create or replace function public.admin_support_view(p_shop uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Write why you need to see this shop''s orders (at least a sentence).'; end if;
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'support_view', p_shop, left(p_reason, 300));
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'created_at', o.created_at, 'status', o.status, 'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
      'address', o.address, 'items_total', o.items_total, 'delivery_fee', o.delivery_fee, 'amount_paid', o.amount_paid,
      'items', (select coalesce(string_agg(i.qty || ' × ' || i.name, ', ' order by i.id), '') from public.order_items i where i.order_id = o.id)) order by o.created_at desc)
    from (select * from public.orders where shop_id = p_shop order by created_at desc limit 50) o), '[]'::jsonb);
end $$;

create or replace function public.admin_audit_log() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', a.created_at, 'who', u.email, 'action', a.action, 'shop', s.name, 'detail', a.detail) order by a.created_at desc)
    from (select * from public.audit_log order by created_at desc limit 100) a left join auth.users u on u.id = a.actor left join public.shops s on s.id = a.shop_id), '[]'::jsonb);
end $$;

-- Needs attention: warning signs across all shops, most serious first. No customer details.
create or replace function public.admin_attention() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare st public.settings;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  select * into st from public.settings where id = 1;
  return coalesce((select jsonb_agg(x order by (x->>'level')::int, x->>'since') from (
    select jsonb_build_object('kind', 'says_paid', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(o.customer_says_paid_at),
      'text', count(*) || case when count(*) = 1 then ' order: the customer says they paid' else ' orders: customers say they paid' end || ', and the shop hasn''t confirmed it for over a day') as x
    from public.orders o join public.shops s on s.id = o.shop_id
    where o.customer_says_paid and o.status in ('awaiting', 'part') and o.customer_says_paid_at < now() - interval '1 day' group by s.id
    union all
    select jsonb_build_object('kind', 'not_sent', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(o.paid_at),
      'text', count(*) || case when count(*) = 1 then ' paid order hasn''t' else ' paid orders haven''t' end || ' been sent after 3 days')
    from public.orders o join public.shops s on s.id = o.shop_id where o.status = 'paid' and o.paid_at < now() - interval '3 days' group by s.id
    union all
    select jsonb_build_object('kind', 'not_delivered', 'level', 2, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(o.paid_at),
      'text', count(*) || case when count(*) = 1 then ' order is' else ' orders are' end || ' marked on its way but not delivered a week after payment')
    from public.orders o join public.shops s on s.id = o.shop_id where o.status = 'out' and o.paid_at < now() - interval '7 days' group by s.id
    union all
    select jsonb_build_object('kind', 'late', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(o.deliver_by),
      'text', count(*) || case when count(*) = 1 then ' order is' else ' orders are' end || ' past the delivery time the shop promised')
    from public.orders o join public.shops s on s.id = o.shop_id where o.status = 'out' and o.deliver_by < now() - interval '2 hours' group by s.id
    union all
    select jsonb_build_object('kind', 'bank_changed', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', s.details_changed_at,
      'text', 'Bank details changed after approval. Check the new account name fits the business.')
    from public.shops s where s.details_changed_at > now() - interval '14 days'
    union all
    select jsonb_build_object('kind', 'reports', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(r.created_at),
      'text', count(*) || case when count(*) = 1 then ' open report from a customer' else ' open reports from customers' end)
    from public.reports r join public.shops s on s.id = r.shop_id where r.resolved_at is null group by s.id
    union all
    select jsonb_build_object('kind', 'cancellations', 'level', 2, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(o.created_at),
      'text', count(*) || ' cancelled orders in the last 30 days')
    from public.orders o join public.shops s on s.id = o.shop_id where o.status = 'cancelled' and o.created_at > now() - interval '30 days' group by s.id having count(*) >= 5
    union all
    select jsonb_build_object('kind', 'plan', 'level', 2, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', s.paid_until,
      'text', case when public.shop_open(s) then 'Plan ran out. The shop closes on ' || to_char(s.paid_until + make_interval(days => st.grace_days), 'Dy DD Mon') || ' unless they pay'
        else 'Closed for not paying since ' || to_char(s.paid_until + make_interval(days => st.grace_days), 'Dy DD Mon') end)
    from public.shops s where st.close_unpaid and st.monthly_price > 0 and s.status = 'active' and s.paid_until < now()
    union all
    select jsonb_build_object('kind', 'waiting', 'level', 2, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', s.created_at,
      'text', 'Waiting for approval for ' || extract(day from now() - s.created_at)::int || ' days')
    from public.shops s where s.status = 'pending' and s.created_at < now() - interval '2 days'
    union all
    select jsonb_build_object('kind', 'problems', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(p.created_at),
      'text', count(*) || case when count(*) = 1 then ' problem is' else ' problems are' end || ' waiting for your decision (see Problems)')
    from public.problems p join public.shops s on s.id = p.shop_id where public.problem_status(p) = 'with_shopdesk' group by s.id
    union all
    select jsonb_build_object('kind', 'upheld', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(p.decided_at),
      'text', count(*) || ' complaints decided against this shop in the last 30 days. Think about suspending it.')
    from public.problems p join public.shops s on s.id = p.shop_id where p.decision = 'customer' and p.decided_at > now() - interval '30 days' group by s.id having count(*) >= 3
    union all
    select jsonb_build_object('kind', 'refund_overdue', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(p.owed_by),
      'text', 'Owes ' || public.naira(sum(p.owed_amount)::int) || ' in refunds past the deadline. Its page is paused.')
    from public.problems p join public.shops s on s.id = p.shop_id where p.owed_amount is not null and p.owed_paid_at is null and p.owed_by < now() group by s.id
    union all
    select jsonb_build_object('kind', 'refund_disputed', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(p.owed_disputed_at),
      'text', count(*) || case when count(*) = 1 then ' customer says' else ' customers say' end || ' a refund didn''t arrive. Check the receipt in Problems.')
    from public.problems p join public.shops s on s.id = p.shop_id where p.owed_disputed_at is not null and p.owed_paid_at is null group by s.id
    union all
    select jsonb_build_object('kind', 'other_account', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(m.created_at),
      'text', 'Sent a different account number to ' || count(distinct m.order_id) || case when count(distinct m.order_id) = 1 then ' customer' else ' customers' end || ' in chat. Possible scam.')
    from public.messages m join public.shops s on s.id = m.shop_id where m.flag = 'other_account' and m.created_at > now() - interval '30 days' group by s.id
    union all
    select jsonb_build_object('kind', 'chat_reports', 'level', 2, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(r.created_at),
      'text', count(*) || ' messages from this shop reported in 30 days')
    from public.reports r join public.shops s on s.id = r.shop_id where r.message_id is not null and r.about = 'shop' and r.created_at > now() - interval '30 days'
    group by s.id having count(*) >= 2
  ) t), '[]'::jsonb);
end $$;

-- Problems: open ones first (waiting for you, then waiting for the shop, then for the customer), and closed ones from the last 30 days.
-- The customer's email and phone show only once a problem is with you, so you can contact them to sort it out.
create or replace function public.admin_problems() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'rank')::int, x->>'created_at') from (
    select jsonb_build_object('id', p.id, 'rank', case e.st when 'with_shopdesk' then 0 when 'open' then 1 when 'answered' then 2 else 3 end,
      'status', e.st, 'escalated_by', coalesce(p.escalated_by, case when e.st = 'with_shopdesk' and p.status = 'open' then 'no_reply' end),
      'kind', p.kind, 'details', p.details, 'photos', to_jsonb(p.photos), 'reply', p.reply, 'reply_note', p.reply_note, 'reply_photos', to_jsonb(p.reply_photos),
      'refund_amount', p.refund_amount, 'refund_received_at', p.refund_received_at, 'created_at', p.created_at, 'reply_by', p.created_at + interval '48 hours',
      'answered_at', p.answered_at, 'escalated_at', p.escalated_at, 'decision', p.decision, 'decision_note', p.decision_note, 'decided_at', p.decided_at, 'closed_at', p.closed_at,
      'owed_amount', p.owed_amount, 'owed_by', p.owed_by, 'owed_sent_at', p.owed_sent_at, 'owed_paid_at', p.owed_paid_at, 'owed_cleared_by', p.owed_cleared_by,
      'owed_receipt', p.owed_receipt, 'owed_disputed_at', p.owed_disputed_at,
      'order', public.admin_order_json(o.id),
      'shop', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'status', s.status,
        'upheld_30d', (select count(*) from public.problems q where q.shop_id = s.id and q.decision = 'customer' and q.decided_at > now() - interval '30 days')),
      'customer', jsonb_build_object('name', o.customer_name,
        'email', case when e.st in ('with_shopdesk', 'decided') then u.email end, 'phone', case when e.st in ('with_shopdesk', 'decided') then o.customer_phone end,
        'id', p.customer_id, 'blocked', public.is_blocked(p.customer_id),
        'rejected_90d', (select count(*) from public.problems q where q.customer_id = p.customer_id and q.decision = 'shop' and q.decided_at > now() - interval '90 days'))) as x
    from public.problems p join public.orders o on o.id = p.order_id join public.shops s on s.id = p.shop_id
      left join auth.users u on u.id = p.customer_id cross join lateral (select public.problem_status(p) as st) e
    where p.closed_at is null or p.closed_at > now() - interval '30 days' or (p.owed_amount is not null and p.owed_paid_at is null)
  ) t), '[]'::jsonb);
end $$;

-- You decide a problem: the customer was right or the shop was right. Both see your decision. If the customer was right you can
-- set a refund: the shop has 48 hours to pay it, or its page stops taking orders until the customer confirms it.
drop function if exists public.admin_decide_problem(bigint, text, text);
create or replace function public.admin_decide_problem(p_problem bigint, p_decision text, p_note text, p_owed int default null) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.problems; v public.orders; s public.shops; c text; cap int; due timestamptz := now() + interval '48 hours';
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  select * into pr from public.problems where id = p_problem for update;
  if not found then raise exception 'Problem not found.'; end if;
  if pr.status in ('sorted', 'decided') then raise exception 'This problem is already closed.'; end if;
  if p_decision is null or p_decision not in ('customer', 'shop') then raise exception 'Choose who was right.'; end if;
  if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Write your decision.'; end if;
  select * into v from public.orders where id = pr.order_id;
  select * into s from public.shops where id = pr.shop_id;
  cap := greatest(v.amount_paid, v.items_total + case when v.delivery_paid_by = 'customer' then coalesce(v.delivery_fee, 0) else 0 end);
  if p_owed is not null and (p_decision <> 'customer' or p_owed < 1 or p_owed > cap) then
    raise exception 'The refund must be between ₦1 and %.', public.naira(cap); end if;
  update public.problems set status = 'decided', decision = p_decision, decision_note = left(trim(p_note), 600), decided_at = now(), closed_at = now(),
    escalated_at = coalesce(escalated_at, now()), owed_amount = p_owed, owed_by = case when p_owed is not null then due end where id = pr.id;
  c := public.order_code(s.order_prefix, pr.order_id);
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'problem_decided', pr.shop_id,
    left('Order ' || c || ': ' || case when p_decision = 'customer' then 'the customer was right. ' else 'the shop was right. ' end
      || case when p_owed is not null then 'Refund ' || public.naira(p_owed) || '. ' else '' end || trim(p_note), 300));
  perform public.notify(v.customer_id, v.id, 'decided', 'ShopDesk decided · ' || c,
    case when p_decision = 'shop' then 'The shop was right.'
         when p_owed is not null then 'You were right. ' || s.name || ' must refund ' || public.naira(p_owed) || ' by ' || public.lagos_time(due) || '.'
         else 'You were right.' end, '/o/' || v.public_token);
  perform public.notify(s.owner_id, v.id, 'decided', 'ShopDesk decided · ' || c,
    case when p_decision = 'shop' then 'You were right.'
         when p_owed is not null then 'Refund ' || public.naira(p_owed) || ' by ' || public.lagos_time(due) || ' or your page pauses.'
         else 'The customer was right.' end, '/?order=' || v.id || '#orders');
end $$;

-- Block a customer who abuses ShopDesk (insults, fake problems, unpaid orders). They can't order, write or report.
create or replace function public.admin_block_user(p_user uuid, p_block boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Write the reason (it goes in the audit log).'; end if;
  if p_user is null or public.has_shop(p_user) then raise exception 'That isn''t a customer account. Suspend the shop instead.'; end if;
  if p_block then
    insert into public.blocked_users (user_id, reason, created_by) values (p_user, left(trim(p_reason), 300), auth.uid())
    on conflict (user_id) do update set reason = excluded.reason, created_by = excluded.created_by, created_at = now();
  else
    delete from public.blocked_users where user_id = p_user;
  end if;
  insert into public.audit_log (actor, action, detail) values (auth.uid(), case when p_block then 'block_customer' else 'unblock_customer' end,
    left((select email from auth.users where id = p_user) || ': ' || trim(p_reason), 300));
end $$;

-- You clear a refund yourself (for example the customer got it but didn't confirm). The shop's page takes orders again.
create or replace function public.admin_clear_owed(p_problem bigint, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.problems; s public.shops; v public.orders; c text;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Write why (it goes in the audit log).'; end if;
  update public.problems set owed_paid_at = now(), owed_cleared_by = 'admin' where id = p_problem and owed_amount is not null and owed_paid_at is null returning * into pr;
  if not found then raise exception 'No refund is owed on this problem.'; end if;
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'refund_cleared', pr.shop_id, left('Problem ' || pr.id || ': ' || trim(p_note), 300));
  -- both sides hear the decision
  select * into s from public.shops where id = pr.shop_id;
  select * into v from public.orders where id = pr.order_id;
  c := public.order_code(s.order_prefix, v.id);
  perform public.notify(s.owner_id, v.id, 'refund_ok', 'Refund cleared · ' || c, 'ShopDesk closed the refund.', '/?order=' || v.id || '#orders');
  perform public.notify(v.customer_id, v.id, 'refund_ok', s.name, c || ': ShopDesk checked the refund and closed it.', '/o/' || v.public_token);
end $$;

-- Growth: the last 12 weeks across all shops, top shops, and approved shops that never got an order (to follow up).
create or replace function public.admin_growth() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object(
    'weeks', (select jsonb_agg(jsonb_build_object('week', w::date,
        'orders', (select count(*) from public.orders o where o.created_at >= w and o.created_at < w + interval '1 week' and o.status <> 'cancelled'),
        'money', (select coalesce(sum(amount), 0) from public.payments p where p.created_at >= w and p.created_at < w + interval '1 week'),
        'new_shops', (select count(*) from public.shops s where s.created_at >= w and s.created_at < w + interval '1 week')) order by w)
      from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') w),
    'top_shops', (select coalesce(jsonb_agg(x order by (x->>'money')::bigint desc), '[]'::jsonb) from (
      select jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'money', sum(p.amount), 'orders', count(distinct p.order_id)) x
      from public.payments p join public.shops s on s.id = p.shop_id where p.created_at > now() - interval '30 days' group by s.id order by sum(p.amount) desc limit 5) t),
    'no_orders', (select coalesce(jsonb_agg(x order by x->>'approved_at'), '[]'::jsonb) from (
      select jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'approved_at', s.reviewed_at,
        'products', (select count(*) from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin)) x
      from public.shops s where s.status = 'active' and coalesce(s.reviewed_at, s.created_at) < now() - interval '7 days'
        and not exists (select 1 from public.orders o where o.shop_id = s.id)) t));
end $$;

-- One shop on one page: details, products, orders and money by week, reports, plan payments and its history. No customer details.
create or replace function public.admin_shop_detail(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.shops;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  select * into s from public.shops where id = p_shop;
  if not found then raise exception 'Shop not found.'; end if;
  return jsonb_build_object(
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'status', s.status, 'open', public.shop_open(s), 'owner_email', (select email from auth.users where id = s.owner_id),
      'sells', s.sells, 'location', s.location, 'social', s.social, 'whatsapp', s.whatsapp, 'bank', s.bank, 'account_number', s.account_number, 'account_name', s.account_name,
      'allow_part_payment', s.allow_part_payment, 'delivery_paid_by', s.delivery_paid_by, 'created_at', s.created_at, 'reviewed_at', s.reviewed_at, 'review_note', s.review_note,
      'last_active_at', s.last_active_at, 'paid_until', s.paid_until, 'details_changed_at', s.details_changed_at),
    'totals', (select jsonb_build_object('orders', count(*), 'delivered', count(*) filter (where status = 'delivered'), 'cancelled', count(*) filter (where status = 'cancelled'),
        'open_orders', count(*) filter (where status in ('awaiting', 'part', 'paid', 'out')),
        'paid_open', count(*) filter (where status in ('part', 'paid', 'out')), 'money', (select coalesce(sum(amount), 0) from public.payments where shop_id = s.id))
      from public.orders where shop_id = s.id),
    'weeks', (select jsonb_agg(jsonb_build_object('week', w::date,
        'orders', (select count(*) from public.orders o where o.shop_id = s.id and o.created_at >= w and o.created_at < w + interval '1 week' and o.status <> 'cancelled'),
        'money', (select coalesce(sum(amount), 0) from public.payments p where p.shop_id = s.id and p.created_at >= w and p.created_at < w + interval '1 week')) order by w)
      from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') w),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price, 'sale_price', p.sale_price, 'stock', p.stock, 'active', p.active,
        'hidden_by_admin', p.hidden_by_admin, 'hidden_reason', p.hidden_reason, 'photo_path', p.photo_path, 'created_at', p.created_at, 'option_label', p.option_label,
        'options', (select coalesce(jsonb_agg(jsonb_build_object('name', o.name, 'price', o.price, 'sale_price', o.sale_price, 'stock', o.stock) order by o.sort_order), '[]'::jsonb)
          from public.product_options o where o.product_id = p.id)) order by p.created_at desc), '[]'::jsonb) from public.products p where p.shop_id = s.id),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'contact', r.contact, 'created_at', r.created_at, 'resolved_at', r.resolved_at, 'resolved_note', r.resolved_note)
        order by r.created_at desc), '[]'::jsonb) from public.reports r where r.shop_id = s.id),
    'plan_payments', (select coalesce(jsonb_agg(jsonb_build_object('amount', pp.amount, 'months', pp.months, 'note', pp.note, 'paid_until', pp.paid_until, 'created_at', pp.created_at)
        order by pp.created_at desc), '[]'::jsonb) from public.plan_payments pp where pp.shop_id = s.id),
    'log', (select coalesce(jsonb_agg(jsonb_build_object('at', a.created_at, 'who', u.email, 'action', a.action, 'detail', a.detail) order by a.created_at desc), '[]'::jsonb)
      from (select * from public.audit_log where shop_id = s.id order by created_at desc limit 50) a left join auth.users u on u.id = a.actor));
end $$;

-- Hide a product that breaks the rules (the vendor sees why and can't show it again), or show it again.
create or replace function public.admin_hide_product(p_product uuid, p_hide boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.products; v_reason text := left(trim(coalesce(p_reason, '')), 200);
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if p_hide and char_length(v_reason) < 5 then raise exception 'Write why it''s hidden (the vendor sees it).'; end if;
  update public.products set hidden_by_admin = p_hide, hidden_reason = case when p_hide then v_reason else '' end where id = p_product returning * into v;
  if not found then raise exception 'Product not found.'; end if;
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), case when p_hide then 'hide_product' else 'show_product' end, v.shop_id, left(v.name || case when p_hide then ': ' || v_reason else '' end, 300));
end $$;

-- Plans and payments: your settings, every shop's plan, recent payments and income by month.
create or replace function public.admin_billing() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(st) - 'id' from public.settings st where id = 1),
    'shops', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'status', s.status, 'whatsapp', s.whatsapp, 'paid_until', s.paid_until, 'open', public.shop_open(s),
        'last_paid', (select max(created_at) from public.plan_payments pp where pp.shop_id = s.id), 'paid_total', (select coalesce(sum(amount), 0) from public.plan_payments pp where pp.shop_id = s.id))
        order by s.paid_until nulls last), '[]'::jsonb) from public.shops s where s.status in ('active', 'suspended')),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('shop', s.name, 'amount', pp.amount, 'months', pp.months, 'note', pp.note, 'paid_until', pp.paid_until, 'created_at', pp.created_at)
        order by pp.created_at desc), '[]'::jsonb) from (select * from public.plan_payments order by created_at desc limit 50) pp join public.shops s on s.id = pp.shop_id),
    'months', (select jsonb_agg(jsonb_build_object('month', m::date, 'income', (select coalesce(sum(amount), 0) from public.plan_payments pp where pp.created_at >= m and pp.created_at < m + interval '1 month')) order by m)
      from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m));
end $$;

create or replace function public.admin_save_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  update public.settings set
    monthly_price = coalesce((p->>'monthly_price')::int, monthly_price), trial_days = coalesce((p->>'trial_days')::int, trial_days),
    grace_days = coalesce((p->>'grace_days')::int, grace_days), close_unpaid = coalesce((p->>'close_unpaid')::boolean, close_unpaid),
    pay_bank = left(trim(coalesce(p->>'pay_bank', pay_bank)), 30), pay_account_number = left(regexp_replace(coalesce(p->>'pay_account_number', pay_account_number), '\s', '', 'g'), 20),
    pay_account_name = left(trim(coalesce(p->>'pay_account_name', pay_account_name)), 60), admin_whatsapp = left(trim(coalesce(p->>'admin_whatsapp', admin_whatsapp)), 20),
    invites_on = coalesce((p->>'invites_on')::boolean, invites_on), invite_months = coalesce((p->>'invite_months')::int, invite_months),
    invited_months = coalesce((p->>'invited_months')::int, invited_months),
    online_pay_on = coalesce((p->>'online_pay_on')::boolean, online_pay_on), delivery_on = coalesce((p->>'delivery_on')::boolean, delivery_on),
    delivery_margin = coalesce((p->>'delivery_margin')::int, delivery_margin), paystack_fee_by = coalesce(p->>'paystack_fee_by', paystack_fee_by),
    online_service_fee = coalesce((p->>'online_service_fee')::int, online_service_fee),
    updated_at = now()
  where id = 1;
  insert into public.audit_log (actor, action, detail) values (auth.uid(), 'settings', left(p::text, 300));
end $$;

-- You record a plan payment a vendor sent you; their plan runs on from today or from its current end, whichever is later.
create or replace function public.admin_record_payment(p_shop uuid, p_amount int, p_months int, p_note text default null) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_until timestamptz;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if p_months is null or p_months < 1 or p_months > 24 then raise exception 'Months must be between 1 and 24.'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter the amount they paid.'; end if;
  update public.shops set paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(months => p_months) where id = p_shop returning paid_until into v_until;
  if v_until is null then raise exception 'Shop not found.'; end if;
  insert into public.plan_payments (shop_id, amount, months, note, paid_until, created_by) values (p_shop, p_amount, p_months, left(trim(coalesce(p_note, '')), 200), v_until, auth.uid());
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'plan_payment', p_shop, p_amount || ' for ' || p_months || ' month(s), now paid until ' || to_char(v_until, 'DD Mon YYYY'));
  return v_until;
end $$;

-- Each plan payment you record is added to that shop's money out, so its report shows what ShopDesk costs.
create or replace function public.money_out_from_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.amount > 0 then
    insert into public.money_out (shop_id, amount, kind, note, spent_on, created_at)
    values (new.shop_id, new.amount, 'shopdesk', 'ShopDesk plan · ' || new.months || ' month' || case when new.months = 1 then '' else 's' end,
            (new.created_at at time zone 'Africa/Lagos')::date, new.created_at);
  end if;
  return new;
end $$;
drop trigger if exists plan_payments_money_out on public.plan_payments;
create trigger plan_payments_money_out after insert on public.plan_payments for each row execute function public.money_out_from_plan();
revoke all on function public.money_out_from_plan() from public, anon, authenticated;

-- ---------- invites ----------
-- A new shop (not yet reviewed, set up in the last two days) says which shop's invite link brought it.
create or replace function public.claim_invite(p_slug text) returns boolean
language plpgsql security definer set search_path = public as $$
declare me public.shops; inv public.shops; st public.settings;
begin
  select * into me from public.shops where owner_id = auth.uid();
  if not found or me.invited_by is not null or me.reviewed_at is not null or me.created_at < now() - interval '2 days' then return false; end if;
  select * into inv from public.shops where slug = lower(trim(coalesce(p_slug, ''))) and status = 'active' and id <> me.id;
  if not found then return false; end if;
  update public.shops set invited_by = inv.id where id = me.id;
  select * into st from public.settings where id = 1;
  if st.invites_on then
    perform public.notify(inv.owner_id, null, 'invite_joined', me.name || ' joined from your invite',
      case when st.invite_months > 0 then 'You get ' || st.invite_months || ' free month' || case when st.invite_months = 1 then '' else 's' end ||
        ' when they pay for their first month.' else 'Thanks for bringing them to ShopDesk.' end, '/#shop');
  end if;
  return true;
end $$;

-- The first paid month of an invited shop gives both shops their free months (once), while invites are on.
create or replace function public.invite_reward() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.shops; inv public.shops; st public.settings; v_until timestamptz;
begin
  select * into st from public.settings where id = 1;
  select * into s from public.shops where id = new.shop_id;
  if not st.invites_on or new.amount <= 0 or s.invited_by is null or s.invite_rewarded_at is not null then return new; end if;
  select * into inv from public.shops where id = s.invited_by;
  update public.shops set invite_rewarded_at = now(),
    paid_until = case when st.invited_months > 0 then greatest(coalesce(paid_until, now()), now()) + make_interval(months => st.invited_months) else paid_until end
  where id = s.id returning paid_until into v_until;
  if st.invited_months > 0 then
    perform public.notify(s.owner_id, null, 'invite_reward', 'A free month from your invite',
      'Your plan now runs to ' || to_char(v_until at time zone 'Africa/Lagos', 'FMDD FMMonth YYYY') || '.', '/#shop');
  end if;
  if inv.id is not null and st.invite_months > 0 then
    update public.shops set paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(months => st.invite_months)
    where id = inv.id returning paid_until into v_until;
    perform public.notify(inv.owner_id, null, 'invite_reward', 'You''ve earned ' || st.invite_months || ' free month' || case when st.invite_months = 1 then '' else 's' end,
      s.name || ' paid for their first month. Your plan now runs to ' || to_char(v_until at time zone 'Africa/Lagos', 'FMDD FMMonth YYYY') || '.', '/#shop');
  end if;
  insert into public.audit_log (actor, action, shop_id, detail)
  values (auth.uid(), 'invite_reward', s.id, left('Invited by ' || coalesce(inv.name, '?') || ': ' || st.invited_months || ' month(s) to ' || s.name || ', ' || st.invite_months || ' to ' || coalesce(inv.name, '?'), 300));
  return new;
end $$;
drop trigger if exists plan_payments_invite on public.plan_payments;
create trigger plan_payments_invite after insert on public.plan_payments for each row execute function public.invite_reward();

-- The Shop tab: is it on, the shop's link name, the reward, and the shops it brought in.
create or replace function public.my_invites() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('on', st.invites_on, 'slug', s.slug, 'months', st.invite_months, 'new_months', st.invited_months,
    'rewarded', (select count(*) from public.shops x where x.invited_by = s.id and x.invite_rewarded_at is not null),
    'shops', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'joined', x.created_at,
        'state', case when x.invite_rewarded_at is not null then 'rewarded' when x.status = 'active' then 'approved' when x.status = 'pending' then 'pending' else 'closed' end)
        order by x.created_at desc) from public.shops x where x.invited_by = s.id), '[]'::jsonb))
  from public.shops s cross join public.settings st where s.owner_id = auth.uid() and st.id = 1 and st.invites_on;
$$;

-- Admin > Invites: the settings and every invite.
create or replace function public.admin_invites() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object(
    'settings', (select jsonb_build_object('invites_on', invites_on, 'invite_months', invite_months, 'invited_months', invited_months) from public.settings where id = 1),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'by', i.name, 'by_id', i.id, 'joined', x.created_at, 'status', x.status,
        'rewarded_at', x.invite_rewarded_at, 'paid', exists (select 1 from public.plan_payments pp where pp.shop_id = x.id and pp.amount > 0))
        order by x.created_at desc) from public.shops x join public.shops i on i.id = x.invited_by), '[]'::jsonb));
end $$;

-- What a vendor sees about their own plan, and where to pay you.
create or replace function public.my_plan() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('paid_until', s.paid_until, 'open', public.shop_open(s), 'monthly_price', st.monthly_price, 'grace_days', st.grace_days, 'close_unpaid', st.close_unpaid,
    'pay_bank', st.pay_bank, 'pay_account_number', st.pay_account_number, 'pay_account_name', st.pay_account_name, 'admin_whatsapp', st.admin_whatsapp)
  from public.shops s cross join public.settings st where s.owner_id = auth.uid() and st.id = 1;
$$;

-- Announcements: a notice shown in every vendor's app until it ends.
create or replace function public.admin_post_announcement(p_title text, p_body text, p_days int default 7) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if char_length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Give the notice a short title.'; end if;
  insert into public.announcements (title, body, ends_at, created_by)
  values (left(trim(p_title), 80), left(trim(coalesce(p_body, '')), 600), case when coalesce(p_days, 0) > 0 then now() + make_interval(days => least(p_days, 365)) end, auth.uid());
  insert into public.audit_log (actor, action, detail) values (auth.uid(), 'announce', left(trim(p_title), 300));
end $$;

create or replace function public.admin_end_announcement(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  update public.announcements set ends_at = now() where id = p_id and (ends_at is null or ends_at > now());
end $$;

create or replace function public.admin_announcements() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'created_at', a.created_at, 'ends_at', a.ends_at,
      'live', a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())) order by a.created_at desc) from (select * from public.announcements order by created_at desc limit 50) a), '[]'::jsonb);
end $$;

create or replace function public.get_announcements() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'created_at', a.created_at) order by a.created_at desc), '[]'::jsonb)
  from public.announcements a where a.starts_at <= now() and (a.ends_at is null or a.ends_at > now());
$$;

-- Keep customer details only as long as needed: blank them on orders closed more than p_days ago.
create or replace function public.purge_customer_details(p_days int default 180) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Not allowed.'; end if;
  update public.orders set customer_name = 'Customer', customer_phone = '', address = '', rider_phone = '', delivery_lat = null, delivery_lng = null,
    customer_details_purged = true
  where not customer_details_purged and status in ('delivered', 'cancelled') and done_at < now() - make_interval(days => greatest(p_days, 30));
  get diagnostics n = row_count;
  -- the same for deleted shops' copies: names, phones and addresses go; the orders, money and chats stay
  update public.archives a set purged = true, data = jsonb_set(a.data, '{orders}', (select coalesce(jsonb_agg(o || jsonb_build_object('customer_name', 'Customer',
      'customer_phone', '', 'address', '', 'rider_phone', '', 'delivery_lat', null, 'delivery_lng', null) order by (o->>'id')::bigint), '[]'::jsonb)
      from jsonb_array_elements(a.data->'orders') o))
  where not a.purged and a.created_at < now() - make_interval(days => greatest(p_days, 30));
  insert into public.audit_log (actor, action, detail) values (auth.uid(), 'purge_customer_details', n || ' orders, older than ' || greatest(p_days, 30) || ' days');
  return n;
end $$;

create or replace function public.touch_shop() returns void
language plpgsql security definer set search_path = public as $$
declare v_shop uuid := public.my_shop_id();
begin
  update public.shops set last_active_at = now() where id = v_shop and last_active_at < now() - interval '10 minutes';
  if v_shop is not null then perform public.tidy(v_shop); end if;
end $$;

-- Tidy-up, every 10 minutes (and whenever a shop opens its app or a customer orders):
--   unpaid orders cancel after 48 hours (unless the customer says they've paid), and their items go back on sale;
--   a refund sent with a receipt counts as received if the customer hasn't answered in 48 hours.
create or replace function public.tidy(p_shop uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare ids bigint[]; m int;
begin
  perform set_config('shopdesk.system', 'on', true);
  with gone as (
    update public.orders o set status = 'cancelled', done_at = now(), cancel_reason = 'unpaid'
    where o.status = 'awaiting' and o.amount_paid = 0 and not o.customer_says_paid and o.created_at < now() - interval '48 hours'
      and (p_shop is null or o.shop_id = p_shop)
    returning o.id)
  select coalesce(array_agg(id), '{}') into ids from gone;
  perform public.restock(ids);
  -- your Log keeps a line for everything ShopDesk does by itself
  insert into public.audit_log (actor, action, shop_id, detail)
  select null, 'auto_cancel', o.shop_id, left('Not paid in 48 hours: ' || string_agg(public.order_code(s.order_prefix, o.id), ', ' order by o.id), 300)
  from public.orders o join public.shops s on s.id = o.shop_id where o.id = any(ids) group by o.shop_id;
  with ok as (
    update public.problems set owed_paid_at = now(), owed_cleared_by = 'auto', refund_received_at = coalesce(refund_received_at, now())
    where owed_amount is not null and owed_paid_at is null and owed_sent_at < now() - interval '48 hours' and owed_receipt is not null
      and owed_disputed_at is null and (p_shop is null or shop_id = p_shop)
    returning order_id, shop_id, owed_amount)
  insert into public.audit_log (actor, action, shop_id, detail)
  select null, 'auto_refund_ok', ok.shop_id, 'Order ' || public.order_code(s.order_prefix, ok.order_id) || ': ' || public.naira(ok.owed_amount)
    || ' refund counts as received (receipt sent, no reply from the customer in 48 hours)'
  from ok join public.shops s on s.id = ok.shop_id;
  get diagnostics m = row_count;
  perform set_config('shopdesk.system', '', true);
  return cardinality(ids) + m;
end $$;

-- ---------- records: your private copies ----------
-- Everything a shop had, as one copy: the shop, its owner's email, products, every order (with items, payments, the full
-- chat and the problem), reports and plan payments.
create or replace function public.shop_snapshot(p_shop uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('shop', to_jsonb(s), 'owner_email', (select email from auth.users where id = s.owner_id), 'saved_at', now(),
    'products', (select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('options', (select coalesce(jsonb_agg(to_jsonb(po) order by po.sort_order), '[]'::jsonb)
        from public.product_options po where po.product_id = p.id)) order by p.created_at), '[]'::jsonb) from public.products p where p.shop_id = s.id),
    'orders', (select coalesce(jsonb_agg(public.admin_order_json(o.id) || jsonb_build_object('customer_id', o.customer_id, 'customer_phone', o.customer_phone,
        'address', o.address, 'rider_phone', o.rider_phone, 'delivery_lat', o.delivery_lat, 'delivery_lng', o.delivery_lng,
        'chat', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'photo', m.photo, 'flag', m.flag, 'created_at', m.created_at) order by m.id), '[]'::jsonb)
          from public.messages m where m.order_id = o.id),
        'problem_detail', (select to_jsonb(p) from public.problems p where p.order_id = o.id)) order by o.id), '[]'::jsonb)
      from public.orders o where o.shop_id = s.id),
    'reports', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) from public.reports r where r.shop_id = s.id),
    'plan_payments', (select coalesce(jsonb_agg(to_jsonb(pp) order by pp.id), '[]'::jsonb) from public.plan_payments pp where pp.shop_id = s.id))
  from public.shops s where s.id = p_shop;
$$;
-- However a shop is deleted (by you, or because its account was removed in Supabase), the copy is made first.
create or replace function public.shops_archive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.archives (shop_id, shop_name, slug, owner_email, reason, deleted_by, data)
  values (old.id, old.name, old.slug, (select email from auth.users where id = old.owner_id),
    left(coalesce(nullif(current_setting('shopdesk.delete_reason', true), ''), 'The shop''s account was deleted.'), 300), auth.uid(), public.shop_snapshot(old.id));
  return old;
end $$;
drop trigger if exists shops_archive on public.shops;
create trigger shops_archive before delete on public.shops for each row execute function public.shops_archive();

-- Find any order by its code (FG-24, or just 24): the order, its shop, problem and reports. A deleted shop's order comes
-- from its copy (download the copy to read that chat). Each lookup goes in the audit log.
create or replace function public.admin_find_order(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d text := substring(coalesce(p_code, '') from '([0-9]{1,18})\s*$'); v public.orders; s public.shops; a public.archives;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if d is null then raise exception 'Type an order code, like FG-24.'; end if;
  select * into v from public.orders where id = d::bigint;
  if found then
    select * into s from public.shops where id = v.shop_id;
    insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'order_lookup', s.id, 'Order ' || public.order_code(s.order_prefix, v.id));
    return jsonb_build_object('order', public.admin_order_json(v.id),
      'shop', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'status', s.status),
      'customer', jsonb_build_object('id', v.customer_id, 'name', v.customer_name, 'email', (select email from auth.users where id = v.customer_id),
        'blocked', public.is_blocked(v.customer_id)),
      'problem', (select jsonb_build_object('kind', public.kind_text(p.kind), 'details', p.details, 'photos', p.photos, 'reply', p.reply, 'reply_note', p.reply_note,
          'reply_photos', p.reply_photos, 'refund_amount', p.refund_amount, 'status', public.problem_status(p), 'decision', p.decision, 'decision_note', p.decision_note, 'owed_amount', p.owed_amount,
          'owed_sent_at', p.owed_sent_at, 'owed_receipt', p.owed_receipt, 'owed_disputed_at', p.owed_disputed_at, 'owed_paid_at', p.owed_paid_at,
          'owed_cleared_by', p.owed_cleared_by, 'created_at', p.created_at) from public.problems p where p.order_id = v.id),
      'reports', (select coalesce(jsonb_agg(jsonb_build_object('reason', r.reason, 'about', r.about, 'created_at', r.created_at, 'resolved_at', r.resolved_at,
          'resolved_note', r.resolved_note) order by r.id), '[]'::jsonb) from public.reports r where r.order_id = v.id));
  end if;
  select * into a from public.archives where data->'orders' @> jsonb_build_array(jsonb_build_object('id', d::bigint)) order by id desc limit 1;
  if found then
    insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'order_lookup', a.shop_id, 'Order ' || d || ' (deleted shop ' || a.shop_name || ')');
    return jsonb_build_object('archive', jsonb_build_object('id', a.id, 'shop', a.shop_name, 'slug', a.slug, 'deleted_at', a.created_at, 'reason', a.reason),
      'order', (select o - 'chat' - 'customer_phone' - 'address' - 'rider_phone' - 'delivery_lat' - 'delivery_lng'
        from jsonb_array_elements(a.data->'orders') o where o->>'id' = d limit 1));
  end if;
  raise exception 'No order % found.', trim(p_code);
end $$;

-- Deleted shops, newest first (without the copies themselves).
create or replace function public.admin_archives() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'shop', a.shop_name, 'slug', a.slug, 'email', a.owner_email, 'reason', a.reason,
      'deleted_at', a.created_at, 'by', u.email, 'orders', jsonb_array_length(a.data->'orders'), 'products', jsonb_array_length(a.data->'products'),
      'reports', jsonb_array_length(a.data->'reports')) order by a.created_at desc)
    from public.archives a left join auth.users u on u.id = a.deleted_by), '[]'::jsonb);
end $$;

-- One deleted shop's full copy, for you to download. Needs a reason; it goes in the audit log.
create or replace function public.admin_archive(p_id bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.archives;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Write why you''re opening it (it goes in the log).'; end if;
  select * into a from public.archives where id = p_id;
  if not found then raise exception 'Not found.'; end if;
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'archive_view', a.shop_id, left(a.shop_name || '. Reason: ' || trim(p_reason), 300));
  return a.data;
end $$;

-- ---------- in-app messages to customers, and the month-end report ----------
-- A shop writes to one of its customers inside ShopDesk ("We miss you, new stock is in"). It shows on that shop in the
-- customer's Shops tab, with a phone alert. Only customers who have ordered from the shop, one message a week each,
-- 50 a day per shop, and no account numbers (those belong in an order's chat, where the scam check runs).
create or replace function public.message_customer(p_customer uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.shops; b text := left(trim(coalesce(p_body, '')), 300);
begin
  select * into s from public.shops where owner_id = auth.uid();
  if not found then raise exception 'Not allowed.'; end if;
  if s.status <> 'active' then raise exception 'Your shop isn''t open right now.'; end if;
  if b = '' then raise exception 'Write a message.'; end if;
  if p_customer is null or not exists (select 1 from public.orders where shop_id = s.id and customer_id = p_customer) then
    raise exception 'You can only message customers who have ordered from you.'; end if;
  if exists (select 1 from regexp_matches(regexp_replace(b, '[\s.-]', '', 'g'), '\d+', 'g') x where char_length(x[1]) >= 10) then
    raise exception 'Send account and phone numbers in an order''s chat instead.'; end if;
  if exists (select 1 from public.notifications where user_id = p_customer and kind = 'shop_message' and url = '/' || s.slug
             and created_at > now() - interval '7 days') then
    raise exception 'You messaged this customer in the last 7 days. Try again later.'; end if;
  if (select count(*) from public.notifications where kind = 'shop_message' and url = '/' || s.slug and created_at > now() - interval '1 day') >= 50 then
    raise exception 'That''s 50 messages today. Try again tomorrow.'; end if;
  perform public.notify(p_customer, null, 'shop_message', s.name, b, '/' || s.slug);
end $$;

-- On the last day of each month (9pm in Lagos, from cron below) every open shop gets "Your November report is ready",
-- which opens that month's report in the app. p_today is for tests. Sends once per shop per month.
create or replace function public.send_monthly_reports(p_today date default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Africa/Lagos')::date);
  v_first date := date_trunc('month', v_today)::date;
  v_start timestamptz := v_first::timestamp at time zone 'Africa/Lagos';
  v_key text := to_char(v_today, 'YYYY-MM');
  s public.shops; v_in bigint; v_orders int; v_out bigint; v_left bigint; n int := 0;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Not allowed.'; end if;
  if extract(day from v_today + 1) <> 1 then return 0; end if; -- only on the last day of the month
  perform set_config('shopdesk.system', 'on', true);
  for s in select * from public.shops where status = 'active' loop
    if exists (select 1 from public.notifications where user_id = s.owner_id and kind = 'monthly_report' and url = '/?report=' || v_key || '#sales') then
      continue; end if;
    -- money in for goods (each payment's delivery part is the rider's), orders placed, money out
    select coalesce(sum(case when o.delivery_paid_by = 'customer' and coalesce(o.delivery_fee, 0) > 0
                             then round(p.amount::numeric * o.items_total / (o.items_total + o.delivery_fee)) else p.amount end), 0)
      into v_in from public.payments p join public.orders o on o.id = p.order_id
      where p.shop_id = s.id and p.created_at >= v_start;
    select count(*) into v_orders from public.orders where shop_id = s.id and status <> 'cancelled' and created_at >= v_start;
    -- "left" only for shops that note their own spending (the ShopDesk plan alone isn't the whole picture)
    select case when count(*) filter (where kind <> 'shopdesk') > 0 then coalesce(sum(amount), 0) else 0 end into v_out
      from public.money_out where shop_id = s.id and spent_on between v_first and v_today;
    v_left := v_in - v_out;
    perform public.notify(s.owner_id, null, 'monthly_report', 'Your ' || to_char(v_today, 'FMMonth') || ' report is ready',
      public.naira(v_in::int) || ' in from ' || v_orders || ' order' || case when v_orders = 1 then '' else 's' end ||
      case when v_out > 0 then ' · ' || case when v_left < 0 then '-' else '' end || public.naira(abs(v_left)::int) || ' left after money out' else '' end ||
      '. Tap to see it.', '/?report=' || v_key || '#sales');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Function rights: customers may only use the order-page functions.
revoke all on all functions in schema public from public, anon;
grant execute on function public.get_storefront(text), public.get_order_public(uuid), public.report_shop(text, text, text, uuid), public.customer_says_paid(uuid), public.customer_received(uuid) to anon, authenticated;
grant execute on function public.place_order(text, jsonb, jsonb) to authenticated;
grant execute on function public.is_admin(), public.my_shop_id(), public.set_delivery_fee(bigint, int), public.confirm_payment(bigint, text, int), public.mark_customer_says_paid(bigint),
  public.advance_order(bigint), public.add_stock(uuid, int), public.add_option_stock(uuid, int), public.save_product(uuid, jsonb), public.delete_product(uuid), public.touch_shop(), public.admin_overview(), public.admin_reports(),
  public.admin_resolve_report(bigint, text), public.admin_set_shop_status(uuid, text, text), public.admin_delete_shop(uuid, text, text), public.admin_review_shop(uuid, boolean, text), public.admin_support_view(uuid, text), public.admin_audit_log(),
  public.purge_customer_details(int), public.admin_attention(), public.admin_growth(), public.admin_shop_detail(uuid), public.admin_hide_product(uuid, boolean, text),
  public.admin_billing(), public.admin_save_settings(jsonb), public.admin_record_payment(uuid, int, int, text), public.my_plan(),
  public.admin_post_announcement(text, text, int), public.admin_end_announcement(bigint), public.admin_announcements(), public.get_announcements(),
  public.my_orders(), public.claim_orders(uuid[]), public.confirm_order(bigint), public.hand_to_rider(bigint, text, text, timestamptz), public.mark_ready(bigint, timestamptz),
  public.my_account(), public.pack_item(bigint, boolean), public.set_packing_photo(bigint, text), public.answer_problem(bigint, text, text, int, text[]),
  public.report_problem(uuid, text, text, text[]), public.problem_customer(uuid, text), public.admin_problems(), public.admin_decide_problem(bigint, text, text, int),
  public.send_message(bigint, text, text), public.mark_read(bigint, text), public.save_push_sub(text, text, text), public.delete_push_sub(text),
  public.refund_sent(bigint, text), public.admin_clear_owed(bigint, text), public.admin_order_chat(bigint, text), public.cancel_order(bigint, text, text),
  public.customer_cancel(uuid), public.report_message(bigint, text), public.admin_block_user(uuid, boolean, text),
  public.admin_find_order(text), public.admin_archives(), public.admin_archive(bigint, text),
  public.seen_app(), public.my_email_settings(), public.set_email_alerts(boolean), public.message_customer(uuid, text) to authenticated;
-- the "Stop these emails" page works without signing in (the secret link is the key)
grant execute on function public.email_by_token(uuid, boolean) to anon, authenticated;
revoke execute on function public.owned_order(bigint) from authenticated;
revoke execute on function public.shops_watch_changes() from authenticated;
revoke execute on function public.shop_open(public.shops) from authenticated;
revoke execute on function public.has_shop(uuid), public.has_shopped(uuid), public.shops_one_role(), public.customers_one_role(), public.customer_order(uuid) from authenticated;
revoke execute on function public.order_prefix_for(text), public.order_code(text, bigint), public.problem_status(public.problems), public.can_report(public.orders),
  public.shops_set_prefix() from authenticated;
revoke execute on function public.naira(int), public.lagos_time(timestamptz), public.kind_text(text), public.shop_owes(uuid), public.can_chat(public.orders),
  public.notify(uuid, bigint, text, text, text, text), public.notify_admins(text, text, text, text), public.orders_notify(), public.shops_notify_admins(),
  public.admin_order_json(bigint), public.push_claim(int), public.push_drop(text[]), public.push_key(), public.push_key_init(text, jsonb),
  public.is_blocked(uuid), public.report_block(uuid), public.cancel_text(text), public.tidy(uuid),
  public.admin_chat_free(public.orders), public.shop_snapshot(uuid), public.shops_archive(), public.email_claim(int), public.email_unclaim(uuid, bigint[]) from authenticated;
revoke execute on function public.restock(bigint[]), public.product_options_sync(), public.json_int(jsonb) from authenticated;
revoke execute on function public.send_monthly_reports(date), public.money_out_from_plan() from authenticated;

-- Who may see or add a photo in an order's folder (order-photos/<order number>/...): the shop, the customer who placed it, and you.
-- Shops add packing photos (pack-...), answer photos (v-...) and refund receipts (r-...); customers add problem photos (c-...);
-- both add chat photos (m-...).
create or replace function public.order_photo_access(p_name text, p_upload boolean default false) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text := split_part(coalesce(p_name, ''), '/', 1); v public.orders; f2 text := split_part(coalesce(p_name, ''), '/', 2);
begin
  if f !~ '^[0-9]{1,18}$' then return false; end if;
  select * into v from public.orders where id = f::bigint;
  -- a deleted shop's order: its photos are kept for you (Records)
  if not found then return coalesce(not p_upload and public.is_admin(), false); end if;
  if p_upload then
    return coalesce((v.shop_id = public.my_shop_id() and f2 ~ '^(pack|v|m|r)-') or (v.customer_id = auth.uid() and f2 ~ '^(c|m)-'), false);
  end if;
  return coalesce(v.shop_id = public.my_shop_id() or v.customer_id = auth.uid() or public.is_admin(), false);
end $$;

-- ---------- product photos ----------
create or replace function public.product_photo_unused(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.products where photo_path = p_name) and not exists (select 1 from public.order_items where photo_path = p_name);
$$;
revoke execute on function public.product_photo_unused(text) from public, anon;
grant execute on function public.product_photo_unused(text) to authenticated;
insert into storage.buckets (id, name, public) values ('product-photos', 'product-photos', true) on conflict (id) do nothing;
drop policy if exists photos_owner_insert on storage.objects;
create policy photos_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and (storage.foldername(name))[1] = public.my_shop_id()::text);
-- A shop can remove its own photo only while no product or order uses it (an upload that didn't save).
drop policy if exists photos_owner_read on storage.objects;
create policy photos_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] = public.my_shop_id()::text);
drop policy if exists photos_owner_delete on storage.objects;
create policy photos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] = public.my_shop_id()::text and public.product_photo_unused(name));
-- you (the admin) can remove a photo by hand (say, one that breaks the rules); deleting a shop keeps its photos for Records
drop policy if exists photos_admin_delete on storage.objects;
create policy photos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and public.is_admin());

-- ---------- order photos (private) ----------
revoke execute on function public.order_photo_access(text, boolean) from public, anon;
grant execute on function public.order_photo_access(text, boolean) to authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('order-photos', 'order-photos', false, 5242880, array['image/jpeg'])
  on conflict (id) do nothing;
drop policy if exists order_photos_insert on storage.objects;
create policy order_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'order-photos' and public.order_photo_access(name, true));
drop policy if exists order_photos_read on storage.objects;
create policy order_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'order-photos' and public.order_photo_access(name, false));
-- you (the admin) can remove them when you delete a shop
drop policy if exists order_photos_admin_delete on storage.objects;
create policy order_photos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'order-photos' and public.is_admin());

-- ---------- live updates ----------
-- New alerts and chat messages reach the app the moment they're written (Supabase Realtime, which still checks the read rules above).
do $rt$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
  end if;
end $rt$;

-- ---------- tidy-up every 10 minutes ----------
-- Needs Supabase's pg_cron (Database -> Extensions -> pg_cron). Without it, tidy-up still runs whenever a shop opens its app
-- or a customer places an order.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'shopdesk-tidy';
    perform cron.schedule('shopdesk-tidy', '*/10 * * * *', 'select public.tidy()');
  end if;
end $cron$;
-- The email backup: every 5 minutes the database asks the push sender to send what's due. Needs pg_cron and pg_net
-- (Database -> Extensions). Without them, emails still go out whenever anyone uses ShopDesk. The address is your project's.
do $mail$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'shopdesk-email';
    perform cron.schedule('shopdesk-email', '*/5 * * * *',
      $job$select net.http_post(url := 'https://buvzjgzoctmpgthelddr.supabase.co/functions/v1/push', body := '{"action":"email"}'::jsonb)$job$);
  end if;
end $mail$;
-- The month-end report: 9pm Lagos time (8pm UTC) on the 28th to the 31st; send_monthly_reports only acts on the last day.
-- With pg_net it also asks the push sender to send the phone alerts straight away.
do $monthly$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'shopdesk-monthly';
    if exists (select 1 from pg_extension where extname = 'pg_net') then
      perform cron.schedule('shopdesk-monthly', '0 20 28-31 * *',
        $job$select public.send_monthly_reports(); select net.http_post(url := 'https://buvzjgzoctmpgthelddr.supabase.co/functions/v1/push', body := '{"action":"flush"}'::jsonb)$job$);
    else
      perform cron.schedule('shopdesk-monthly', '0 20 28-31 * *', 'select public.send_monthly_reports()');
    end if;
  end if;
end $monthly$;

-- Ratings and Shops near you: anyone can read them; only customers rate.
revoke all on function public.short_name(text), public.shop_rating(uuid), public.rate_shop(uuid, int, text), public.my_shop_rating(uuid),
  public.shop_reviews(text), public.shops_near() from public, anon, authenticated;
grant execute on function public.shop_reviews(text), public.shops_near() to anon, authenticated;
grant execute on function public.rate_shop(uuid, int, text), public.my_shop_rating(uuid) to authenticated;

-- Invites: shops see their own; Admin sees them all.
revoke all on function public.claim_invite(text), public.invite_reward(), public.my_invites(), public.admin_invites() from public, anon, authenticated;
grant execute on function public.claim_invite(text), public.my_invites(), public.admin_invites() to authenticated;

-- ---------- Pay online (Paystack) and ShopDesk Delivery (Shipbubble), off until switched on in Admin ----------
alter table public.settings add column if not exists online_pay_on boolean not null default false;
alter table public.settings add column if not exists delivery_on boolean not null default false;
alter table public.settings add column if not exists delivery_margin integer not null default 0 check (delivery_margin between 0 and 20000);
-- who pays Paystack's fee: the customer (added on top when they choose to pay online, so the shop gets the full amount),
-- the shop (taken from its share), or ShopDesk (when the delivery fee is in the payment)
alter table public.settings add column if not exists paystack_fee_by text not null default 'customer';
alter table public.settings drop constraint if exists settings_paystack_fee_by_check;
alter table public.settings add constraint settings_paystack_fee_by_check check (paystack_fee_by in ('customer', 'shop', 'shopdesk'));
alter table public.settings alter column paystack_fee_by set default 'customer';
-- ShopDesk's own fee on each online payment (naira), paid by the customer on top, like the card fee
alter table public.settings add column if not exists online_service_fee integer not null default 50 check (online_service_fee between 0 and 1000);

alter table public.shops add column if not exists pickup_address text not null default '' check (char_length(pickup_address) <= 200);
alter table public.shops add column if not exists pickup_code bigint;
alter table public.shops add column if not exists paystack_subaccount text;
alter table public.shops add column if not exists paystack_for text;
grant update (pickup_address) on public.shops to authenticated;

-- a new pickup address has to be checked by the courier service again
create or replace function public.shops_pickup_reset() returns trigger
language plpgsql as $$
begin
  if new.pickup_address is distinct from old.pickup_address then new.pickup_code := null; end if;
  return new;
end $$;
drop trigger if exists shops_pickup_reset on public.shops;
create trigger shops_pickup_reset before update on public.shops for each row execute function public.shops_pickup_reset();

alter table public.orders add column if not exists delivery_by text not null default 'shop' check (delivery_by in ('shop', 'shopdesk'));
alter table public.orders add column if not exists delivery_quotes jsonb;
alter table public.orders add column if not exists delivery_quote jsonb;


-- Each time a customer starts paying online. amount and delivery_part are in naira.
create table if not exists public.online_payments (
  reference text primary key check (char_length(reference) between 8 and 60),
  order_id bigint not null references public.orders(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  amount integer not null check (amount > 0),
  delivery_part integer not null default 0 check (delivery_part >= 0),
  fee integer not null default 0 check (fee >= 0), -- Paystack's fee, paid by the customer on top of amount
  service integer not null default 0 check (service >= 0), -- ShopDesk's fee, paid by the customer on top of amount
  status text not null default 'started' check (status in ('started', 'paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists online_payments_order on public.online_payments (order_id);
alter table public.online_payments enable row level security;
revoke all on public.online_payments from anon, authenticated;

-- ShopDesk Delivery bookings. cost: what the courier took from ShopDesk's wallet; price: what the customer paid for delivery.
create table if not exists public.shipments (
  order_id bigint primary key references public.orders(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  sb_order text unique,
  courier text not null default '' check (char_length(courier) <= 80),
  status text not null default 'pending' check (char_length(status) <= 40),
  tracking_url text check (char_length(tracking_url) <= 300),
  tracking_code text check (char_length(tracking_code) <= 80),
  rider jsonb,
  steps jsonb not null default '[]'::jsonb,
  cost integer not null default 0 check (cost >= 0),
  price integer not null default 0 check (price >= 0),
  paid_online boolean not null default false,
  billed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shipments_shop on public.shipments (shop_id, created_at desc);
alter table public.shipments enable row level security;
drop policy if exists shipments_own on public.shipments;
create policy shipments_own on public.shipments for select to authenticated using (shop_id = public.my_shop_id());
revoke all on public.shipments from anon, authenticated;
grant select on public.shipments to authenticated;

-- What the apps need to know: is Pay online on, is ShopDesk Delivery on.
create or replace function public.money_switches() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('online', online_pay_on, 'delivery', delivery_on, 'fee_by', paystack_fee_by) from public.settings where id = 1;
$$;

-- Everything the money function needs to get courier prices for a new order (the shop's own order, unpaid, delivery the customer pays).
create or replace function public.money_quote_info(p_order bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order); s public.shops; st public.settings;
begin
  select * into st from public.settings where id = 1;
  if not st.delivery_on then raise exception 'ShopDesk Delivery isn''t on yet.'; end if;
  if v.mode <> 'delivery' then raise exception 'This order is a pick-up.'; end if;
  if v.delivery_paid_by <> 'customer' then raise exception 'ShopDesk Delivery is for orders where the customer pays delivery.'; end if;
  if v.status <> 'awaiting' or v.amount_paid > 0 then raise exception 'The fee is locked once paid.'; end if;
  if char_length(trim(v.address)) < 5 then raise exception 'This order has no delivery address.'; end if;
  select * into s from public.shops where id = v.shop_id;
  if char_length(trim(s.pickup_address)) < 5 then raise exception 'Add your pickup address on the Shop tab first.'; end if;
  return jsonb_build_object(
    'order', jsonb_build_object('id', v.id, 'name', v.customer_name, 'phone', v.customer_phone, 'address', v.address, 'area', v.area,
      'lat', v.delivery_lat, 'lng', v.delivery_lng, 'email', (select email from auth.users where id = v.customer_id)),
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.whatsapp, 'pickup_address', s.pickup_address, 'pickup_code', s.pickup_code,
      'sells', s.sells, 'email', (select email from auth.users where id = s.owner_id)),
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'price', i.price, 'qty', i.qty) order by i.id) from public.order_items i where i.order_id = v.id),
    'margin', st.delivery_margin);
end $$;

-- The courier prices the money function got, kept on the order so the shop can only pick one of them.
create or replace function public.money_save_quotes(p_order bigint, p_quotes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if v.status <> 'awaiting' or v.amount_paid > 0 then raise exception 'The fee is locked once paid.'; end if;
  update public.orders set delivery_quotes = jsonb_build_object('at', now(), 'list', coalesce(p_quotes, '[]'::jsonb)) where id = v.id;
end $$;

-- The shop picks a courier: the delivery fee is set to that price and the order is confirmed.
create or replace function public.money_pick_quote(p_order bigint, p_courier text, p_service text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order); q jsonb;
begin
  if v.status <> 'awaiting' or v.amount_paid > 0 then raise exception 'The fee is locked once paid.'; end if;
  if v.delivery_quotes is null or (v.delivery_quotes->>'at')::timestamptz < now() - interval '6 days' then raise exception 'Get the courier prices again.'; end if;
  select x into q from jsonb_array_elements(v.delivery_quotes->'list') x where x->>'courier_id' = p_courier and x->>'service_code' = p_service limit 1;
  if q is null then raise exception 'Get the courier prices again.'; end if;
  update public.orders set delivery_fee = (q->>'price')::int, delivery_by = 'shopdesk', delivery_quote = q, confirmed_at = coalesce(confirmed_at, now()) where id = v.id;
  return q;
end $$;

-- The shop types its own fee instead (its own rider): ShopDesk Delivery is no longer the plan for this order.
create or replace function public.money_own_rider(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if exists (select 1 from public.shipments where order_id = v.id) then raise exception 'This order is already booked with a courier.'; end if;
  if exists (select 1 from public.online_payments where order_id = v.id and status = 'paid' and delivery_part > 0) then
    raise exception 'The customer paid ShopDesk for this delivery, so it goes with ShopDesk Delivery.'; end if;
  update public.orders set delivery_by = 'shop' where id = v.id;
end $$;

-- The customer starts paying online: records the attempt and returns what Paystack needs.
create or replace function public.money_start_payment(p_token uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders; s public.shops; st public.settings; v_due int; v_delivery int; v_fee int; v_service int;
begin
  select * into st from public.settings where id = 1;
  if not st.online_pay_on then raise exception 'Paying online isn''t on yet. Pay by transfer for now.'; end if;
  select * into v from public.orders where public_token = p_token for update;
  if not found then raise exception 'Order not found.'; end if;
  if v.customer_id is not null and v.customer_id is distinct from auth.uid() then raise exception 'Sign in with the account that placed this order.'; end if;
  if v.status not in ('awaiting', 'part') then raise exception 'This order is already paid or closed.'; end if;
  if v.mode = 'delivery' and v.delivery_paid_by = 'customer' and v.delivery_fee is null then raise exception 'Wait for the shop to confirm your order and its delivery fee.'; end if;
  select * into s from public.shops where id = v.shop_id;
  if s.status <> 'active' then raise exception 'This shop isn''t taking orders.'; end if;
  v_due := v.items_total + case when v.delivery_paid_by = 'customer' then coalesce(v.delivery_fee, 0) else 0 end - v.amount_paid;
  if v_due <= 0 then raise exception 'Nothing is left to pay.'; end if;
  v_delivery := case when v.delivery_by = 'shopdesk' and v.delivery_paid_by = 'customer' and v.amount_paid = 0 then coalesce(v.delivery_fee, 0) else 0 end;
  v_service := st.online_service_fee;
  v_fee := case when st.paystack_fee_by = 'customer' then public.online_fee(v_due + v_service) else 0 end;
  insert into public.online_payments (reference, order_id, shop_id, amount, delivery_part, fee, service)
  values (p_ref, v.id, v.shop_id, v_due, v_delivery, v_fee, v_service);
  return jsonb_build_object('amount', v_due, 'delivery_part', v_delivery, 'fee', v_fee, 'service', v_service, 'fee_by', st.paystack_fee_by, 'order_id', v.id,
    'email', coalesce((select email from auth.users where id = v.customer_id), 'order' || v.id || '@shopdesk.com.ng'),
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'bank', s.bank, 'account_number', s.account_number,
      'subaccount', s.paystack_subaccount, 'subaccount_for', s.paystack_for));
end $$;

-- Paystack confirmed the payment (the money function checked it with Paystack first). Safe to call twice for the same payment.
create or replace function public.money_paid(p_ref text, p_kobo bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.online_payments; v public.orders; v_due int; v_amt int;
begin
  select * into p from public.online_payments where reference = p_ref for update;
  if not found then raise exception 'Unknown payment.'; end if;
  if p.status = 'paid' then return jsonb_build_object('order_id', p.order_id, 'already', true); end if;
  if coalesce(p_kobo, 0) < (p.amount + p.fee + p.service)::bigint * 100 then raise exception 'The amount paid doesn''t match.'; end if;
  select * into v from public.orders where id = p.order_id for update;
  v_due := v.items_total + case when v.delivery_paid_by = 'customer' then coalesce(v.delivery_fee, 0) else 0 end - v.amount_paid;
  v_amt := least(p.amount, greatest(v_due, 0));
  update public.online_payments set status = 'paid', paid_at = now() where reference = p.reference;
  if v_amt > 0 and v.status in ('awaiting', 'part') then
    insert into public.payments (order_id, shop_id, amount, method) values (v.id, v.shop_id, v_amt, 'online');
    update public.orders set amount_paid = amount_paid + v_amt, customer_says_paid = false, confirmed_at = coalesce(confirmed_at, now()),
      status = case when v_amt >= v_due then 'paid' else 'part' end, paid_at = case when v_amt >= v_due then now() else paid_at end
    where id = v.id;
  else
    v_amt := 0;
  end if;
  if v_amt < p.amount then
    insert into public.audit_log (actor, action, shop_id, detail) values (null, 'online_overpaid', p.shop_id,
      'Order #' || p.order_id || ': paid ' || public.naira(p.amount) || ' online, ' || public.naira(p.amount - v_amt) || ' more than was due. Refund it in Paystack.');
  end if;
  return jsonb_build_object('order_id', p.order_id, 'credited', v_amt);
end $$;

-- Everything the money function needs to book the courier for a paid, packed order.
create or replace function public.money_book_info(p_order bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if not (select delivery_on from public.settings where id = 1) then raise exception 'ShopDesk Delivery isn''t on yet.'; end if;
  if v.delivery_by <> 'shopdesk' or v.delivery_quote is null then raise exception 'This order isn''t set up for ShopDesk Delivery.'; end if;
  if v.status <> 'paid' then raise exception 'Only paid orders can be booked.'; end if;
  if exists (select 1 from public.order_items where order_id = v.id and not packed) then raise exception 'Tick every item as packed first.'; end if;
  if exists (select 1 from public.shipments where order_id = v.id) then raise exception 'This order is already booked.'; end if;
  return jsonb_build_object('quote', v.delivery_quote, 'info', public.money_quote_info_paid(v.id));
end $$;

-- Same as money_quote_info, for an order that's already paid (used to get fresh prices when the old ones have expired).
create or replace function public.money_quote_info_paid(p_order bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'order', jsonb_build_object('id', o.id, 'name', o.customer_name, 'phone', o.customer_phone, 'address', o.address, 'area', o.area,
      'lat', o.delivery_lat, 'lng', o.delivery_lng, 'email', (select email from auth.users where id = o.customer_id)),
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.whatsapp, 'pickup_address', s.pickup_address, 'pickup_code', s.pickup_code,
      'sells', s.sells, 'email', (select email from auth.users where id = s.owner_id)),
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'price', i.price, 'qty', i.qty) order by i.id) from public.order_items i where i.order_id = o.id),
    'margin', (select delivery_margin from public.settings where id = 1))
  from public.orders o join public.shops s on s.id = o.shop_id where o.id = p_order;
$$;

-- The courier is booked: save it, and the order goes out with the courier.
create or replace function public.money_save_shipment(p_order bigint, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order); v_eta timestamptz;
begin
  if v.status <> 'paid' then raise exception 'Only paid orders can be booked.'; end if;
  v_eta := least(greatest(coalesce((p->>'eta')::timestamptz, now() + interval '2 days'), now() + interval '1 hour'), now() + interval '14 days');
  insert into public.shipments (order_id, shop_id, sb_order, courier, status, tracking_url, tracking_code, cost, price, paid_online)
  values (v.id, v.shop_id, p->>'sb_order', left(coalesce(p->>'courier', ''), 80), left(coalesce(p->>'status', 'pending'), 40),
    left(p->>'tracking_url', 300), left(p->>'tracking_code', 80), greatest(coalesce((p->>'cost')::int, 0), 0), coalesce(v.delivery_fee, 0),
    exists (select 1 from public.online_payments op where op.order_id = v.id and op.status = 'paid' and op.delivery_part > 0));
  update public.orders set status = 'out', out_at = now(), rider_name = left(coalesce(p->>'courier', 'Courier'), 60),
    rider_phone = left(coalesce(p->>'courier_phone', ''), 20), deliver_by = v_eta, confirmed_at = coalesce(confirmed_at, now())
  where id = v.id;
end $$;

-- A status update from the courier service (the money function checked it came from Shipbubble).
create or replace function public.money_ship_update(p_sb_order text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sh public.shipments; v public.orders; st text := lower(coalesce(p->>'status', ''));
begin
  update public.shipments set status = left(coalesce(nullif(st, ''), status), 40), steps = coalesce(p->'steps', steps),
    tracking_url = coalesce(left(p->>'tracking_url', 300), tracking_url), tracking_code = coalesce(left(p->>'tracking_code', 80), tracking_code),
    rider = coalesce(p->'rider', rider), updated_at = now()
  where sb_order = p_sb_order returning * into sh;
  if not found then return jsonb_build_object('found', false); end if;
  select * into v from public.orders where id = sh.order_id for update;
  if st in ('completed', 'delivered') and v.status = 'out' then
    update public.orders set status = 'delivered', done_at = now(), received_by = 'shop' where id = v.id;
  elsif st = 'cancelled' and v.status = 'out' then
    update public.orders set status = 'paid', out_at = null, deliver_by = null, rider_name = '', rider_phone = '' where id = v.id;
    delete from public.shipments where order_id = v.id;
    perform public.notify((select owner_id from public.shops where id = v.shop_id), v.id, 'delivery_cancelled', 'Courier cancelled',
      'The courier cancelled order #' || v.id || '. Book again or use your own rider.', '/#orders');
  end if;
  return jsonb_build_object('found', true, 'status', st);
end $$;

-- Paystack's fee, added on top so that what's left after the fee is p_base (naira): 1.5% + ₦100, the ₦100 waived under
-- ₦2,500, at most ₦2,000. Rounded up, so the shop always gets the full amount.
create or replace function public.online_fee(p_base int) returns int
language sql immutable set search_path = public as $$
  select case when coalesce(p_base, 0) <= 0 then 0
    when ceil(p_base / 0.985) < 2500 then ceil(p_base / 0.985)::int - p_base
    else least(ceil((p_base + 100) / 0.985)::int - p_base, 2000) end;
$$;

-- The order page: can it be paid online (and the card fee the customer pays on top), and how its ShopDesk Delivery is going.
create or replace function public.order_money(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'online', st.online_pay_on and s.status = 'active' and s.bank in ('OPay', 'Moniepoint', 'Kuda', 'PalmPay') and s.account_number <> ''
      and o.status in ('awaiting', 'part') and not (o.mode = 'delivery' and o.delivery_paid_by = 'customer' and o.delivery_fee is null),
    'fee', case when st.paystack_fee_by = 'customer' then public.online_fee(st.online_service_fee +
      o.items_total + case when o.delivery_paid_by = 'customer' then coalesce(o.delivery_fee, 0) else 0 end - o.amount_paid) else 0 end,
    'service', st.online_service_fee,
    'delivery_by', o.delivery_by,
    'courier', o.delivery_quote->>'name',
    'shipment', (select jsonb_build_object('courier', sh.courier, 'status', sh.status, 'tracking_url', sh.tracking_url, 'tracking_code', sh.tracking_code,
        'steps', sh.steps, 'rider', sh.rider) from public.shipments sh where sh.order_id = o.id))
  from public.orders o join public.shops s on s.id = o.shop_id cross join public.settings st where o.public_token = p_token and st.id = 1;
$$;

-- Admin > Payments & delivery.
create or replace function public.admin_money() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object(
    'settings', (select jsonb_build_object('online_pay_on', online_pay_on, 'delivery_on', delivery_on, 'delivery_margin', delivery_margin,
      'paystack_fee_by', paystack_fee_by, 'online_service_fee', online_service_fee) from public.settings where id = 1),
    'online', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0), 'delivery', coalesce(sum(delivery_part), 0), 'fees', coalesce(sum(fee), 0), 'service', coalesce(sum(service), 0))
      from public.online_payments where status = 'paid'),
    'shipments', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select sh.order_id, sh.created_at, sh.courier, sh.status, sh.cost, sh.price, sh.paid_online, sh.billed_at, sh.tracking_url,
        s.name as shop, s.id as shop_id, public.order_code(s.order_prefix, sh.order_id) as code
      from public.shipments sh join public.shops s on s.id = sh.shop_id order by sh.created_at desc limit 200) x), '[]'::jsonb),
    'owed', coalesce((select jsonb_agg(x order by x.owed desc) from (
      select s.id as shop_id, s.name as shop, sum(sh.price) as owed, count(*) as deliveries
      from public.shipments sh join public.shops s on s.id = sh.shop_id where not sh.paid_online and sh.billed_at is null group by s.id, s.name) x), '[]'::jsonb));
end $$;

-- A shop paid its delivery bill.
create or replace function public.admin_delivery_paid(p_shop uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  update public.shipments set billed_at = now() where shop_id = p_shop and not paid_online and billed_at is null;
  get diagnostics n = row_count;
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'delivery_bill_paid', p_shop, n || ' deliveries marked paid');
  return n;
end $$;

revoke all on function public.money_switches(), public.money_quote_info(bigint), public.money_save_quotes(bigint, jsonb), public.money_pick_quote(bigint, text, text),
  public.money_own_rider(bigint), public.money_start_payment(uuid, text), public.money_paid(text, bigint), public.money_book_info(bigint),
  public.money_quote_info_paid(bigint), public.money_save_shipment(bigint, jsonb), public.money_ship_update(text, jsonb), public.order_money(uuid),
  public.admin_money(), public.admin_delivery_paid(uuid), public.shops_pickup_reset(), public.online_fee(int) from public, anon, authenticated;
grant execute on function public.money_switches(), public.order_money(uuid) to anon, authenticated;
grant execute on function public.money_own_rider(bigint), public.admin_money(), public.admin_delivery_paid(uuid) to authenticated;
