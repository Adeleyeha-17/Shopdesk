-- Update 029: several saved delivery addresses per customer (picked at checkout, managed in Account), Buy again
-- (what a customer bought before, with today's prices), and when each order was delivered in My orders (for Help).
-- Safe to run more than once.

-- A customer's delivery addresses (home, office...), newest first at checkout. An address typed at checkout is saved
-- when the order is placed; the customer can add or remove them in Account. Up to 10 are kept (the oldest go).
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null check (char_length(address) between 3 and 160),
  area text not null default '' check (char_length(area) <= 40),
  used_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists customer_addresses_one on public.customer_addresses (user_id, lower(address));

-- addresses: keep the 10 used most recently; the address saved before addresses became a list is the first one
create or replace function public.customer_addresses_keep() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.customer_addresses where user_id = new.user_id
    and id not in (select id from public.customer_addresses where user_id = new.user_id order by used_at desc, created_at desc limit 10);
  return null;
end $$;
drop trigger if exists customer_addresses_keep on public.customer_addresses;
create trigger customer_addresses_keep after insert on public.customer_addresses for each row execute function public.customer_addresses_keep();
insert into public.customer_addresses (user_id, address, area, used_at)
select user_id, trim(address), area, updated_at from public.customers where char_length(trim(address)) >= 3 and trim(address) not like 'Map pin %'
on conflict do nothing;

alter table public.customer_addresses enable row level security;
drop policy if exists addresses_own on public.customer_addresses;
create policy addresses_own on public.customer_addresses for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.customer_addresses from anon, authenticated;
grant select, delete on public.customer_addresses to authenticated;
grant insert (user_id, address, area) on public.customer_addresses to authenticated;
grant update (address, area, used_at) on public.customer_addresses to authenticated;
revoke all on function public.customer_addresses_keep() from public, anon, authenticated;

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
  if public.is_blocked(auth.uid()) then raise exception 'Your account can''t place orders. Contact ShopDesk.'; end if;
  select * into v_shop from public.shops where slug = lower(p_slug);
  if not found or not public.shop_open(v_shop) or public.shop_owes(v_shop.id) then raise exception 'This shop isn''t taking orders right now.'; end if;
  -- shop owners can buy from other shops, but never from their own
  if v_shop.owner_id = auth.uid() then raise exception 'This is your own shop. You can''t order from it.'; end if;
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
    -- and the delivery address goes on their list of addresses (used now, so it comes first next time)
    if v_mode = 'delivery' and v_addr not like 'Map pin %' then
      insert into public.customer_addresses (user_id, address, area) values (auth.uid(), v_addr, v_area)
      on conflict (user_id, lower(address)) do update set used_at = now(),
        area = case when excluded.area <> '' then excluded.area else public.customer_addresses.area end;
    end if;
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

-- A signed-in customer's order history, newest first.
create or replace function public.my_orders() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('token', o.public_token, 'order_id', o.id, 'code', public.order_code(s.order_prefix, o.id), 'shop', s.name, 'slug', s.slug,
      'status', o.status, 'mode', o.mode, 'created_at', o.created_at, 'deliver_by', o.deliver_by, 'received_by', o.received_by, 'done_at', o.done_at,
      'problem', (select public.problem_status(p) from public.problems p where p.order_id = o.id),
      'to_pay', o.items_total + case when o.delivery_paid_by = 'customer' then coalesce(o.delivery_fee, 0) else 0 end,
      'items', (select string_agg(i.qty || ' × ' || i.name, ', ' order by i.id) from public.order_items i where i.order_id = o.id)) order by o.created_at desc), '[]'::jsonb)
  from public.orders o join public.shops s on s.id = o.shop_id where auth.uid() is not null and o.customer_id = auth.uid();
$$;

-- Buy again: what the customer bought before (not on cancelled orders), by shop, as each shop sells it now: today's price,
-- what's left, and whether the shop is taking orders. Items the shop no longer sells (or a size it dropped) are left out.
-- Shops with the newest purchase first, up to 20 shops and 12 items each.
create or replace function public.my_past_items() returns jsonb
language sql stable security definer set search_path = public as $$
  with bought as (
    select o.shop_id, i.product_id, i.option_id, max(o.created_at) as last_at
    from public.orders o join public.order_items i on i.order_id = o.id
    where auth.uid() is not null and o.customer_id = auth.uid() and o.status <> 'cancelled' and i.product_id is not null
    group by o.shop_id, i.product_id, i.option_id
  ), now_sold as (
    select b.shop_id, b.last_at, p.id as product_id, x.id as option_id, p.name, x.name as option_name, p.photo_path,
      coalesce(x.price, p.price) as price, case when x.id is not null then x.sale_price else p.sale_price end as sale_price,
      coalesce(x.stock, p.stock) as stock,
      row_number() over (partition by b.shop_id order by b.last_at desc, p.name) as n
    from bought b join public.products p on p.id = b.product_id and p.active and not p.hidden_by_admin
    left join public.product_options x on x.id = b.option_id and x.product_id = p.id
    where case when b.option_id is null then not exists (select 1 from public.product_options y where y.product_id = p.id) else x.id is not null end
  ), per as (
    select shop_id, max(last_at) as last_at,
      jsonb_agg(jsonb_build_object('product_id', product_id, 'option_id', option_id, 'name', name, 'option', option_name, 'photo_path', photo_path,
        'price', price, 'sale_price', sale_price, 'stock', stock) order by last_at desc, name) as items
    from now_sold where n <= 12 group by shop_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('shop', s.name, 'slug', s.slug, 'open', public.shop_open(s) and not public.shop_owes(s.id),
      'last_at', per.last_at, 'items', per.items) order by per.last_at desc), '[]'::jsonb)
  from (select * from per order by last_at desc limit 20) per join public.shops s on s.id = per.shop_id;
$$;

revoke all on function public.my_past_items() from public, anon;
grant execute on function public.my_past_items() to authenticated;
