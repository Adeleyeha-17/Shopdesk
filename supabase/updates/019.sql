-- 019: live tracking for the shop's own riders. The shop sends its rider a private link; while the rider's page is open it
-- shares the phone's location, and the customer and the shop see the rider on a map on the order. Run after 018. Safe to run
-- more than once.

alter table public.orders add column if not exists rider_token uuid unique;
create table if not exists public.rider_spots (
  order_id bigint primary key references public.orders(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy real,
  at timestamptz not null default now()
);
alter table public.rider_spots enable row level security;
revoke all on public.rider_spots from anon, authenticated;

-- The shop gets the rider link for an order that's with its own rider.
create or replace function public.rider_link(p_order bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order); t uuid;
begin
  if v.mode <> 'delivery' or v.delivery_by = 'shopdesk' then raise exception 'This order isn''t with your own rider.'; end if;
  if v.status <> 'out' then raise exception 'Hand it to your rider first.'; end if;
  t := coalesce(v.rider_token, gen_random_uuid());
  update public.orders set rider_token = t where id = v.id;
  return t;
end $$;

-- The rider's page: where it's going and who to call, while it's on its way.
create or replace function public.rider_job(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when o.status <> 'out' then jsonb_build_object('done', true, 'status', o.status, 'shop', s.name)
    else jsonb_build_object('done', false, 'code', public.order_code(s.order_prefix, o.id), 'shop', s.name,
      'customer', split_part(o.customer_name, ' ', 1), 'phone', o.customer_phone, 'address', o.address, 'area', o.area,
      'lat', o.delivery_lat, 'lng', o.delivery_lng, 'deliver_by', o.deliver_by, 'rider', o.rider_name,
      'shared_at', (select at from public.rider_spots sp where sp.order_id = o.id)) end
  from public.orders o join public.shops s on s.id = o.shop_id
  where o.rider_token = p_token and o.mode = 'delivery';
$$;

-- The rider's phone sends where it is (every few seconds while the page is open).
create or replace function public.rider_ping(p_token uuid, p_lat double precision, p_lng double precision, p_accuracy real default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare v public.orders;
begin
  select * into v from public.orders where rider_token = p_token;
  if not found or v.status <> 'out' then return false; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Bad location.'; end if;
  insert into public.rider_spots (order_id, lat, lng, accuracy, at) values (v.id, p_lat, p_lng, least(greatest(p_accuracy, 0), 100000), now())
  on conflict (order_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, at = excluded.at
    where public.rider_spots.at < now() - interval '3 seconds';
  if random() < 0.02 then delete from public.rider_spots where at < now() - interval '1 day'; end if;
  return true;
end $$;

-- Where the rider is now, for the customer (by order link) or the shop (by order), while it's on its way and fresh (30 minutes).
create or replace function public.order_live(p_token uuid default null, p_order bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.orders; sp public.rider_spots;
begin
  if p_token is not null then select * into v from public.orders where public_token = p_token;
  else select * into v from public.orders where id = p_order and shop_id = public.my_shop_id(); end if;
  if not found or v.status <> 'out' or v.mode <> 'delivery' then return null; end if;
  select * into sp from public.rider_spots where order_id = v.id and at > now() - interval '30 minutes';
  if not found then return jsonb_build_object('sharing', false, 'link', v.rider_token is not null); end if;
  return jsonb_build_object('sharing', true, 'link', true, 'lat', sp.lat, 'lng', sp.lng, 'accuracy', sp.accuracy, 'at', sp.at, 'rider', v.rider_name);
end $$;

revoke all on function public.rider_link(bigint), public.rider_job(uuid), public.rider_ping(uuid, double precision, double precision, real),
  public.order_live(uuid, bigint) from public, anon, authenticated;
grant execute on function public.rider_job(uuid), public.rider_ping(uuid, double precision, double precision, real), public.order_live(uuid, bigint) to anon, authenticated;
grant execute on function public.rider_link(bigint) to authenticated;
