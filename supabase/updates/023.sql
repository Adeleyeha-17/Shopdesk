-- 023: videos in the ShopDesk chat (a shop records one or picks one from its phone; you can send one too).
-- Run after 022. Safe to run more than once.

alter table public.shop_messages add column if not exists video text check (char_length(video) <= 200);
alter table public.shop_messages drop constraint if exists shop_messages_check;
alter table public.shop_messages drop constraint if exists shop_messages_has_content;
alter table public.shop_messages add constraint shop_messages_has_content
  check (char_length(body) > 0 or photo is not null or video is not null);

-- Chat videos (private): chat-videos/shop-<shop id>/m-....mp4, up to 50 MB. Only the shop and you can add and see them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('chat-videos', 'chat-videos', false, 52428800,
  array['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/x-matroska'])
  on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists chat_videos_insert on storage.objects;
create policy chat_videos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-videos' and name like 'shop-%' and public.order_photo_access(name, true));
drop policy if exists chat_videos_read on storage.objects;
create policy chat_videos_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-videos' and name like 'shop-%' and public.order_photo_access(name, false));
drop policy if exists chat_videos_admin_delete on storage.objects;
create policy chat_videos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat-videos' and public.is_admin());

create or replace function public.shop_message_json(m public.shop_messages) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'photo', m.photo, 'video', m.video, 'created_at', m.created_at);
$$;

-- What a message says in an alert or a list: its words, or Photo / Video.
create or replace function public.shop_message_text(b text, p_photo text, p_video text) returns text
language sql immutable as $$
  select case when coalesce(b, '') <> '' then b when p_video is not null then 'Video' else 'Photo' end;
$$;

-- A photo or video in a shop's chat must be in that shop's folder.
create or replace function public.shop_media_ok(p_shop uuid, p_photo text, p_video text) returns boolean
language sql immutable as $$
  select (p_photo is null or p_photo ~ ('^shop-' || p_shop || '/m-[0-9a-f-]{36}\.jpg$'))
     and (p_video is null or p_video ~ ('^shop-' || p_shop || '/m-[0-9a-f-]{36}\.(mp4|mov|webm|3gp|mkv)$'));
$$;

drop function if exists public.shopdesk_says(uuid, text, text);
drop function if exists public.shopdesk_send(text, text);
drop function if exists public.admin_shop_send(uuid, text, text);

-- ShopDesk writes to a shop (from Admin, and when a shop is approved, not approved, suspended, closed or reopened).
-- The shop hears it as "ShopDesk".
create or replace function public.shopdesk_says(p_shop uuid, p_body text, p_photo text default null, p_video text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.shops; m public.shop_messages; b text := left(trim(coalesce(p_body, '')), 2000);
begin
  select * into s from public.shops where id = p_shop;
  if not found then raise exception 'Shop not found.'; end if;
  if b = '' and p_photo is null and p_video is null then raise exception 'Write a message.'; end if;
  if not public.shop_media_ok(s.id, p_photo, p_video) then raise exception 'That file can''t be sent. Try again.'; end if;
  insert into public.shop_messages (shop_id, sender, admin_id, body, photo, video) values (s.id, 'shopdesk', auth.uid(), b, p_photo, p_video) returning * into m;
  perform public.notify(s.owner_id, null, 'shopdesk', 'ShopDesk', public.shop_message_text(b, p_photo, p_video), '/?shopdesk=1#shop');
  return public.shop_message_json(m);
end $$;
revoke all on function public.shopdesk_says(uuid, text, text, text) from public, anon, authenticated;

-- The shop writes to ShopDesk (any time, also while waiting for approval or suspended). You hear about it in Admin.
create or replace function public.shopdesk_send(p_body text, p_photo text default null, p_video text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.shops; m public.shop_messages; b text := left(trim(coalesce(p_body, '')), 2000);
begin
  select * into s from public.shops where id = public.my_shop_id();
  if not found then raise exception 'Set up your shop first.'; end if;
  if b = '' and p_photo is null and p_video is null then raise exception 'Write a message.'; end if;
  if not public.shop_media_ok(s.id, p_photo, p_video) then raise exception 'That file can''t be sent. Try again.'; end if;
  if (select count(*) from public.shop_messages where shop_id = s.id and sender = 'shop' and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Slow down a little.'; end if;
  insert into public.shop_messages (shop_id, sender, body, photo, video) values (s.id, 'shop', b, p_photo, p_video) returning * into m;
  perform public.notify_admins('admin_message', s.name, public.shop_message_text(b, p_photo, p_video), '/admin#messages');
  return public.shop_message_json(m);
end $$;

-- Admin: write to a shop. It shows as "ShopDesk".
create or replace function public.admin_shop_send(p_shop uuid, p_body text, p_photo text default null, p_video text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return public.shopdesk_says(p_shop, p_body, p_photo, p_video);
end $$;

-- Admin: every shop's chat with ShopDesk, the newest first, with what the shop wrote that you haven't read.
create or replace function public.admin_shop_threads() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(t order by t->>'at' desc) from (
      select jsonb_build_object('shop_id', s.id, 'name', s.name, 'slug', s.slug, 'status', s.status,
        'last', public.shop_message_text(l.body, l.photo, l.video), 'from', l.sender, 'at', l.created_at,
        'unread', (select count(*) from public.shop_messages u where u.shop_id = s.id and u.sender = 'shop' and u.read_at is null)) t
      from public.shops s
      join lateral (select * from public.shop_messages x where x.shop_id = s.id order by x.id desc limit 1) l on true
    ) z), '[]'::jsonb);
end $$;

revoke all on function public.shopdesk_send(text, text, text), public.admin_shop_send(uuid, text, text, text) from public, anon;
grant execute on function public.shopdesk_send(text, text, text), public.admin_shop_send(uuid, text, text, text) to authenticated;
