-- 022: the ShopDesk chat (each shop and ShopDesk talk inside the app; the shop only ever sees "ShopDesk"), and
-- "I want this" on features that are coming soon. Run after 021. Safe to run more than once.

-- ---------- The ShopDesk chat ----------
-- One chat per shop, between the shop and ShopDesk. ShopDesk's messages never show who wrote them; admin_id is kept for
-- your own records only. read_at is when the other side read it. Nobody can edit or delete a message.
create table if not exists public.shop_messages (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  sender text not null check (sender in ('shop', 'shopdesk')),
  admin_id uuid references auth.users(id) on delete set null,
  body text not null default '' check (char_length(body) <= 2000),
  photo text check (char_length(photo) <= 200),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (char_length(body) > 0 or photo is not null)
);
create index if not exists shop_messages_shop on public.shop_messages (shop_id, id);
alter table public.shop_messages enable row level security;
revoke all on public.shop_messages from anon, authenticated;

create or replace function public.shop_message_json(m public.shop_messages) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'photo', m.photo, 'created_at', m.created_at);
$$;

-- Photos in the ShopDesk chat live in order-photos/shop-<shop id>/m-....jpg: the shop and you can add and see them.
create or replace function public.order_photo_access(p_name text, p_upload boolean default false) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text := split_part(coalesce(p_name, ''), '/', 1); v public.orders; f2 text := split_part(coalesce(p_name, ''), '/', 2);
begin
  if f ~ '^shop-[0-9a-f-]{36}$' then
    return coalesce((substr(f, 6) = public.my_shop_id()::text or public.is_admin()) and (not p_upload or f2 ~ '^m-'), false);
  end if;
  if f !~ '^[0-9]{1,18}$' then return false; end if;
  select * into v from public.orders where id = f::bigint;
  -- a deleted shop's order: its photos are kept for you (Records)
  if not found then return coalesce(not p_upload and public.is_admin(), false); end if;
  if p_upload then
    return coalesce((v.shop_id = public.my_shop_id() and f2 ~ '^(pack|v|m|r)-') or (v.customer_id = auth.uid() and f2 ~ '^(c|m)-'), false);
  end if;
  return coalesce(v.shop_id = public.my_shop_id() or v.customer_id = auth.uid() or public.is_admin(), false);
end $$;

-- ShopDesk writes to a shop (from Admin, and when a shop is approved, not approved, suspended, closed or reopened).
-- The shop hears it as "ShopDesk".
create or replace function public.shopdesk_says(p_shop uuid, p_body text, p_photo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.shops; m public.shop_messages; b text := left(trim(coalesce(p_body, '')), 2000);
begin
  select * into s from public.shops where id = p_shop;
  if not found then raise exception 'Shop not found.'; end if;
  if b = '' and p_photo is null then raise exception 'Write a message.'; end if;
  if p_photo is not null and p_photo !~ ('^shop-' || s.id || '/m-[0-9a-f-]{36}\.jpg$') then raise exception 'That photo can''t be sent. Try again.'; end if;
  insert into public.shop_messages (shop_id, sender, admin_id, body, photo) values (s.id, 'shopdesk', auth.uid(), b, p_photo) returning * into m;
  perform public.notify(s.owner_id, null, 'shopdesk', 'ShopDesk', case when b = '' then 'Photo' else b end, '/?shopdesk=1#shop');
  return public.shop_message_json(m);
end $$;
revoke all on function public.shopdesk_says(uuid, text, text) from public, anon, authenticated;

-- The shop: its chat with ShopDesk (oldest first). Opening it marks ShopDesk's messages and their alerts read.
create or replace function public.shopdesk_thread() returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid := public.my_shop_id(); out jsonb;
begin
  if sid is null then raise exception 'Set up your shop first.'; end if;
  update public.shop_messages set read_at = now() where shop_id = sid and sender = 'shopdesk' and read_at is null;
  update public.notifications set read_at = now() where user_id = auth.uid() and kind = 'shopdesk' and read_at is null;
  select coalesce(jsonb_agg(public.shop_message_json(m) order by m.id), '[]'::jsonb) into out
  from (select * from public.shop_messages where shop_id = sid order by id desc limit 300) m;
  return out;
end $$;

-- The shop: how many ShopDesk messages it hasn't read.
create or replace function public.shopdesk_unread() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.shop_messages where shop_id = public.my_shop_id() and sender = 'shopdesk' and read_at is null;
$$;

-- The shop writes to ShopDesk (any time, also while waiting for approval or suspended). You hear about it in Admin.
create or replace function public.shopdesk_send(p_body text, p_photo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.shops; m public.shop_messages; b text := left(trim(coalesce(p_body, '')), 2000);
begin
  select * into s from public.shops where id = public.my_shop_id();
  if not found then raise exception 'Set up your shop first.'; end if;
  if b = '' and p_photo is null then raise exception 'Write a message.'; end if;
  if p_photo is not null and p_photo !~ ('^shop-' || s.id || '/m-[0-9a-f-]{36}\.jpg$') then raise exception 'That photo can''t be sent. Try again.'; end if;
  if (select count(*) from public.shop_messages where shop_id = s.id and sender = 'shop' and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Slow down a little.'; end if;
  insert into public.shop_messages (shop_id, sender, body, photo) values (s.id, 'shop', b, p_photo) returning * into m;
  perform public.notify_admins('admin_message', s.name, case when b = '' then 'Photo' else b end, '/admin#messages');
  return public.shop_message_json(m);
end $$;

-- Admin: every shop's chat with ShopDesk, the newest first, with what the shop wrote that you haven't read.
create or replace function public.admin_shop_threads() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(t order by t->>'at' desc) from (
      select jsonb_build_object('shop_id', s.id, 'name', s.name, 'slug', s.slug, 'status', s.status,
        'last', case when l.body = '' then 'Photo' else l.body end, 'from', l.sender, 'at', l.created_at,
        'unread', (select count(*) from public.shop_messages u where u.shop_id = s.id and u.sender = 'shop' and u.read_at is null)) t
      from public.shops s
      join lateral (select * from public.shop_messages x where x.shop_id = s.id order by x.id desc limit 1) l on true
    ) z), '[]'::jsonb);
end $$;

-- Admin: one shop's chat (oldest first). Opening it marks the shop's messages read.
create or replace function public.admin_shop_thread(p_shop uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.shops; out jsonb;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  select * into s from public.shops where id = p_shop;
  if not found then raise exception 'Shop not found.'; end if;
  update public.shop_messages set read_at = now() where shop_id = s.id and sender = 'shop' and read_at is null;
  select coalesce(jsonb_agg(public.shop_message_json(m) order by m.id), '[]'::jsonb) into out
  from (select * from public.shop_messages where shop_id = s.id order by id desc limit 300) m;
  return jsonb_build_object('shop', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'status', s.status), 'messages', out);
end $$;

-- Admin: write to a shop. It shows as "ShopDesk".
create or replace function public.admin_shop_send(p_shop uuid, p_body text, p_photo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return public.shopdesk_says(p_shop, p_body, p_photo);
end $$;

-- Approve or don't approve a shop: as before, and the shop hears it in its ShopDesk chat.
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
  perform public.shopdesk_says(v.id, case when p_approve
    then 'Good news: ' || v.name || ' is approved and open for orders. Your link: shopdesk.com.ng/' || v.slug || E'\nShare it on your WhatsApp status, in your chats and in your Instagram bio.'
    else 'We can''t open ' || v.name || ' yet: ' || v_note || E'\nFix it in the Shop tab, then reply here and we''ll check again.' end);
end $$;

-- Suspend, close for good or reopen a shop: as before, and the shop hears it in its ShopDesk chat (your reason stays in the
-- audit log; the shop doesn't see it).
create or replace function public.admin_set_shop_status(p_shop uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.shops;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if p_status not in ('active', 'suspended', 'banned') then raise exception 'Unknown status.'; end if;
  if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Write the reason (it goes in the audit log).'; end if;
  select * into v from public.shops where id = p_shop;
  update public.shops set status = p_status where id = p_shop;
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'set_status:' || p_status, p_shop, left(p_note, 300));
  if v.id is not null and v.status is distinct from p_status then
    perform public.shopdesk_says(v.id, case p_status
      when 'active' then 'Your shop is open again. Customers can order from you now.'
      when 'suspended' then 'Your shop page is closed for now. Reply here and we''ll sort it out together.'
      else 'Your shop is closed by ShopDesk. Reply here if you think this is a mistake.' end);
  end if;
end $$;

revoke all on function public.shopdesk_thread(), public.shopdesk_unread(), public.shopdesk_send(text, text),
  public.admin_shop_threads(), public.admin_shop_thread(uuid), public.admin_shop_send(uuid, text, text) from public, anon;
grant execute on function public.shopdesk_thread(), public.shopdesk_unread(), public.shopdesk_send(text, text),
  public.admin_shop_threads(), public.admin_shop_thread(uuid), public.admin_shop_send(uuid, text, text) to authenticated;

-- ---------- Coming soon: "I want this" ----------
-- Shops tap "I want this" on a feature that isn't on yet. You see how many did; when you switch it on, they hear.
create table if not exists public.feature_wants (
  shop_id uuid not null references public.shops(id) on delete cascade,
  feature text not null check (feature in ('pay_online', 'delivery')),
  created_at timestamptz not null default now(),
  primary key (shop_id, feature)
);
alter table public.feature_wants enable row level security;
revoke all on public.feature_wants from anon, authenticated;

create or replace function public.want_feature(p_feature text) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid := public.my_shop_id();
begin
  if sid is null then raise exception 'Set up your shop first.'; end if;
  if p_feature not in ('pay_online', 'delivery') then raise exception 'Unknown feature.'; end if;
  insert into public.feature_wants (shop_id, feature) values (sid, p_feature) on conflict do nothing;
end $$;

create or replace function public.my_feature_wants() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(feature order by feature), '{}') from public.feature_wants where shop_id = public.my_shop_id();
$$;

create or replace function public.admin_feature_wants() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object(
    'pay_online', (select count(*) from public.feature_wants where feature = 'pay_online'),
    'delivery', (select count(*) from public.feature_wants where feature = 'delivery'));
end $$;

revoke all on function public.want_feature(text), public.my_feature_wants(), public.admin_feature_wants() from public, anon;
grant execute on function public.want_feature(text), public.my_feature_wants(), public.admin_feature_wants() to authenticated;

-- Switching Pay online or ShopDesk Delivery on tells every shop that asked for it.
create or replace function public.settings_features_on() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.online_pay_on and not old.online_pay_on then
    perform public.notify(s.owner_id, null, 'feature', 'Pay online is here', 'Your customers can pay you online now. See the Shop tab.', '/#shop')
    from public.feature_wants w join public.shops s on s.id = w.shop_id where w.feature = 'pay_online';
  end if;
  if new.delivery_on and not old.delivery_on then
    perform public.notify(s.owner_id, null, 'feature', 'ShopDesk Delivery is here', 'Add your pickup address in the Shop tab, and we send couriers to your door.', '/#shop')
    from public.feature_wants w join public.shops s on s.id = w.shop_id where w.feature = 'delivery';
  end if;
  return new;
end $$;
revoke all on function public.settings_features_on() from public, anon, authenticated;
drop trigger if exists settings_features_on on public.settings;
create trigger settings_features_on after update of online_pay_on, delivery_on on public.settings
  for each row execute function public.settings_features_on();
