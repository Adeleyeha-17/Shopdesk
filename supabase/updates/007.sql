-- ShopDesk update 007: chat inside each order, alerts (live updates and phone alerts), refunds you order
-- (the shop's page pauses if it doesn't pay), reports that name their order, shorter messages, and fair-use rules:
-- photo evidence and report limits, a receipt for every refund, unpaid orders that cancel themselves after 48 hours,
-- reasons for every cancellation, reporting rude messages from either side, and blocking abusive customers.
-- Records: a private copy of any shop that gets deleted, finding any order by its code, and automatic actions in your Log.
-- Nothing is lost: vendors hide products instead of deleting them, each order keeps the product photo the customer saw,
-- and product photos stay (even when a shop is deleted).
-- Email backup: if you haven't opened ShopDesk for 10 minutes, one email lists what you missed (at most every 30 minutes).
-- Safe to run more than once. Run in Supabase: SQL Editor -> New query -> paste -> Run.

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


alter table public.shops drop constraint if exists shops_slug_reserved;
alter table public.shops add constraint shops_slug_reserved check (slug not in ('admin', 'privacy', 'orders', 'order', 'login', 'signin', 'shopdesk', 'help', 'support', 'api', 'app', 'email-off'));

alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subs enable row level security;
alter table public.push_keys enable row level security;
alter table public.blocked_users enable row level security;
alter table public.archives enable row level security;
alter table public.email_settings enable row level security;

-- A chat is read by the shop and by the customer who placed the order. Messages are only added through send_message.
drop policy if exists messages_parties_read on public.messages;
create policy messages_parties_read on public.messages for select to authenticated using (shop_id = public.my_shop_id() or customer_id = auth.uid());
-- Everyone reads only their own alerts.
drop policy if exists notifications_own_read on public.notifications;
create policy notifications_own_read on public.notifications for select to authenticated using (user_id = auth.uid());

revoke all on public.messages, public.notifications, public.push_subs, public.push_keys, public.blocked_users, public.archives, public.email_settings from anon, authenticated;
grant select on public.messages, public.notifications to authenticated;

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

create or replace function public.shops_one_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.has_shopped(new.owner_id) then
    raise exception 'This email is a customer account. Use another email for your shop.';
  end if;
  return new;
end $$;

create or replace function public.customers_one_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.has_shop(new.user_id) then
    raise exception 'This email runs a shop. Use another email to order.';
  end if;
  return new;
end $$;

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

create or replace function public.get_storefront(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shop', jsonb_build_object('name', s.name, 'slug', s.slug, 'bank', s.bank, 'account_number', s.account_number, 'account_name', s.account_name,
      'allow_part_payment', s.allow_part_payment, 'delivery_paid_by', s.delivery_paid_by),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price, 'stock', p.stock, 'photo_path', p.photo_path) order by p.created_at desc)
      from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin), '[]'::jsonb))
  from public.shops s where s.slug = lower(p_slug) and public.shop_open(s) and not public.shop_owes(s.id);
$$;

-- Places an order in one step: checks every item belongs to the shop, holds the stock, and returns a private token
-- the customer uses to see their order. Stock is locked row by row, so two customers can't take the last piece.
-- Customers must be signed in: every order belongs to an account, so it shows in their order history.
create or replace function public.place_order(p_slug text, p_customer jsonb, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shop public.shops; v_order public.orders; v_item jsonb; v_prod public.products; v_qty int; v_total int := 0; v_mode text;
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
  if v_mode = 'delivery' and char_length(trim(coalesce(p_customer->>'address', ''))) < 3 then raise exception 'Add a delivery address.'; end if;
  -- no more than 10 orders a minute per shop from the order page, to stop floods
  if (select count(*) from public.orders where shop_id = v_shop.id and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Too many orders at once. Try again in a minute.';
  end if;
  insert into public.orders (shop_id, customer_id, customer_name, customer_phone, mode, address, items_total, delivery_paid_by)
  values (v_shop.id, auth.uid(), left(trim(p_customer->>'name'), 60), left(trim(coalesce(p_customer->>'phone', '')), 20), v_mode,
          case when v_mode = 'delivery' then left(trim(p_customer->>'address'), 160) else '' end, 0, v_shop.delivery_paid_by)
  returning * into v_order;
  -- signed-in customers: remember their details for next time
  if auth.uid() is not null then
    insert into public.customers (user_id, name, phone, address) values (auth.uid(), v_order.customer_name, v_order.customer_phone, v_order.address)
    on conflict (user_id) do update set name = excluded.name, phone = excluded.phone,
      address = case when excluded.address <> '' then excluded.address else public.customers.address end, updated_at = now();
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 99 then raise exception 'Each item needs a quantity from 1 to 99.'; end if;
    select * into v_prod from public.products where id = (v_item->>'product_id')::uuid and shop_id = v_shop.id and active and not hidden_by_admin for update;
    if not found then raise exception 'An item is no longer available.'; end if;
    if v_prod.stock < v_qty then raise exception '% has only % left.', v_prod.name, v_prod.stock; end if;
    update public.products set stock = stock - v_qty where id = v_prod.id;
    insert into public.order_items (order_id, product_id, name, price, qty, photo_path) values (v_order.id, v_prod.id, v_prod.name, v_prod.price, v_qty, v_prod.photo_path);
    v_total := v_total + v_prod.price * v_qty;
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

-- The customer cancels an unpaid order (before saying they've paid). The items go back on sale.
create or replace function public.customer_cancel(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.customer_order(p_token);
begin
  if auth.uid() is null or v.customer_id is distinct from auth.uid() then raise exception 'Sign in with the email you ordered with.'; end if;
  if v.status <> 'awaiting' or v.amount_paid > 0 then raise exception 'Only unpaid orders can be cancelled.'; end if;
  if v.customer_says_paid then raise exception 'You said you''ve paid. Message the shop.'; end if;
  update public.products p set stock = p.stock + i.qty from public.order_items i where i.order_id = v.id and i.product_id = p.id;
  update public.orders set status = 'cancelled', done_at = now(), cancel_reason = 'customer' where id = v.id;
end $$;

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

create or replace function public.set_delivery_fee(p_order bigint, p_fee int) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if v.mode <> 'delivery' then raise exception 'This order is a pick-up.'; end if;
  if v.status not in ('awaiting', 'part') then raise exception 'The fee is locked once paid.'; end if;
  if p_fee is null or p_fee < 0 or p_fee > 1000000 then raise exception 'Enter a delivery fee in naira.'; end if;
  update public.orders set delivery_fee = p_fee, confirmed_at = coalesce(confirmed_at, now()) where id = v.id;
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
  update public.products p set stock = p.stock + i.qty from public.order_items i where i.order_id = v.id and i.product_id = p.id;
  update public.orders set status = 'cancelled', done_at = now(), cancel_reason = p_reason, cancel_note = left(trim(coalesce(p_note, '')), 200) where id = v.id;
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

-- Keep customer details only as long as needed: blank them on orders closed more than p_days ago.
create or replace function public.purge_customer_details(p_days int default 180) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Not allowed.'; end if;
  update public.orders set customer_name = 'Customer', customer_phone = '', address = '', rider_phone = '', customer_details_purged = true
  where not customer_details_purged and status in ('delivered', 'cancelled') and done_at < now() - make_interval(days => greatest(p_days, 30));
  get diagnostics n = row_count;
  -- the same for deleted shops' copies: names, phones and addresses go; the orders, money and chats stay
  update public.archives a set purged = true, data = jsonb_set(a.data, '{orders}', (select coalesce(jsonb_agg(o || jsonb_build_object('customer_name', 'Customer',
      'customer_phone', '', 'address', '', 'rider_phone', '') order by (o->>'id')::bigint), '[]'::jsonb) from jsonb_array_elements(a.data->'orders') o))
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
  update public.products p set stock = p.stock + i.qty from public.order_items i where i.order_id = any(ids) and i.product_id = p.id;
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

-- Everything a shop had, as one copy: the shop, its owner's email, products, every order (with items, payments, the full
-- chat and the problem), reports and plan payments.
create or replace function public.shop_snapshot(p_shop uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('shop', to_jsonb(s), 'owner_email', (select email from auth.users where id = s.owner_id), 'saved_at', now(),
    'products', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at), '[]'::jsonb) from public.products p where p.shop_id = s.id),
    'orders', (select coalesce(jsonb_agg(public.admin_order_json(o.id) || jsonb_build_object('customer_id', o.customer_id, 'customer_phone', o.customer_phone,
        'address', o.address, 'rider_phone', o.rider_phone,
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
      'order', (select o - 'chat' - 'customer_phone' - 'address' - 'rider_phone' from jsonb_array_elements(a.data->'orders') o where o->>'id' = d limit 1));
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

create or replace function public.product_photo_unused(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.products where photo_path = p_name) and not exists (select 1 from public.order_items where photo_path = p_name);
$$;

-- Function rights: customers may only use the order-page functions.
revoke all on all functions in schema public from public, anon;
grant execute on function public.get_storefront(text), public.get_order_public(uuid), public.report_shop(text, text, text, uuid), public.customer_says_paid(uuid), public.customer_received(uuid) to anon, authenticated;
grant execute on function public.place_order(text, jsonb, jsonb) to authenticated;
grant execute on function public.is_admin(), public.my_shop_id(), public.set_delivery_fee(bigint, int), public.confirm_payment(bigint, text, int), public.mark_customer_says_paid(bigint),
  public.advance_order(bigint), public.add_stock(uuid, int), public.touch_shop(), public.admin_overview(), public.admin_reports(),
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
  public.seen_app(), public.my_email_settings(), public.set_email_alerts(boolean) to authenticated;
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


-- Vendors hide a product instead of deleting it, so orders and your records keep it.
revoke delete on public.products from authenticated;

revoke execute on function public.product_photo_unused(text) from public, anon;
grant execute on function public.product_photo_unused(text) to authenticated;
insert into storage.buckets (id, name, public) values ('product-photos', 'product-photos', true) on conflict (id) do nothing;
drop policy if exists photos_owner_insert on storage.objects;
create policy photos_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and (storage.foldername(name))[1] = public.my_shop_id()::text);
-- A shop can remove its own photo only while no product or order uses it (an upload that didn't save).
drop policy if exists photos_owner_delete on storage.objects;
create policy photos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] = public.my_shop_id()::text and public.product_photo_unused(name));
-- you (the admin) can remove a photo by hand (say, one that breaks the rules); deleting a shop keeps its photos for Records
drop policy if exists photos_admin_delete on storage.objects;
create policy photos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and public.is_admin());


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
