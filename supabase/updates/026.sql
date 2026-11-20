-- Update 026: shop owners can buy from other shops (with the same email), never from their own shop.
-- Customers still can't open a shop. A shop's report shows what it spent buying from other shops (my_purchases).
-- Admin > Customers lists shop owners who buy, with their shop's name; blocking them only stops their buying.
-- Safe to run more than once.

drop trigger if exists customers_one_role on public.customers;
drop function if exists public.customers_one_role();

-- What the signed-in account is, so the app can explain before anyone fills in a form.
create or replace function public.my_account() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('vendor', public.has_shop(auth.uid()), 'customer', public.has_shopped(auth.uid()),
    'shop_slug', (select slug from public.shops where owner_id = auth.uid()));
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

-- The customer taps "I've sent the money" on their order page. The shop still checks its bank app before marking it paid;
-- if it doesn't confirm within a day, the order shows up in your Needs attention list.
-- Only the account that placed an order can say they've paid or got it, so a shop can't confirm for its customer.
-- (Orders from before accounts have no owner: anyone with the link, except the shop that sold it.)
create or replace function public.customer_order(p_token uuid) returns public.orders
language plpgsql stable security definer set search_path = public as $$
declare v public.orders;
begin
  select * into v from public.orders where public_token = p_token;
  if not found then raise exception 'Order not found.'; end if;
  if exists (select 1 from public.shops where id = v.shop_id and owner_id = auth.uid()) then raise exception 'This order is from your own shop.'; end if;
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
  if p_tokens is null or array_length(p_tokens, 1) is null then return 0; end if;
  if array_length(p_tokens, 1) > 50 then raise exception 'Too many orders at once.'; end if;
  -- never an order from your own shop
  update public.orders set customer_id = auth.uid() where public_token = any(p_tokens) and customer_id is null
    and shop_id not in (select id from public.shops where owner_id = auth.uid());
  get diagnostics n = row_count;
  return n;
end $$;

-- What a shop owner spent buying from other shops between two days (Lagos dates, both included), for their report:
-- money they actually paid on orders that weren't cancelled, in total and per shop.
create or replace function public.my_purchases(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with b as (
    select s.name, s.slug, o.amount_paid
    from public.orders o join public.shops s on s.id = o.shop_id
    where auth.uid() is not null and o.customer_id = auth.uid() and o.status <> 'cancelled' and o.amount_paid > 0
      and (coalesce(o.paid_at, o.created_at) at time zone 'Africa/Lagos')::date between p_from and p_to
  ), per as (
    select name, slug, sum(amount_paid)::int as spent, count(*)::int as orders from b group by name, slug
  )
  select jsonb_build_object('spent', coalesce((select sum(spent) from per), 0), 'orders', coalesce((select sum(orders) from per), 0),
    'shops', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'slug', slug, 'spent', spent, 'orders', orders) order by spent desc, name) from per), '[]'::jsonb));
$$;

-- Admin > Customers: find a customer by name, email or phone, with their orders, problems and reports, to block them.
-- Shop owners who also buy from other shops show here too, with their shop's name.
create or replace function public.admin_find_customers(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := lower(trim(coalesce(p_q, ''))); d text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if char_length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x->>'last_order' desc nulls last) from (
    select jsonb_build_object('id', u.id, 'email', u.email,
        'name', coalesce(nullif(c.name, ''), (select o.customer_name from public.orders o where o.customer_id = u.id order by o.created_at desc limit 1), ''),
        'phone', coalesce(nullif(c.phone, ''), (select o.customer_phone from public.orders o where o.customer_id = u.id order by o.created_at desc limit 1), ''),
        'orders', (select count(*) from public.orders o where o.customer_id = u.id),
        'problems', (select count(*) from public.problems p where p.customer_id = u.id),
        'lost', (select count(*) from public.problems p where p.customer_id = u.id and p.decision = 'shop'),
        'reported', (select count(*) from public.reports r join public.messages m on m.id = r.message_id where r.about = 'customer' and m.customer_id = u.id),
        'last_order', (select max(o.created_at) from public.orders o where o.customer_id = u.id),
        'blocked', public.is_blocked(u.id), 'block_reason', (select b.reason from public.blocked_users b where b.user_id = u.id),
        'shop', (select sh.name from public.shops sh where sh.owner_id = u.id)) x
    from auth.users u left join public.customers c on c.user_id = u.id
    where (not public.has_shop(u.id) or public.has_shopped(u.id)) and not exists (select 1 from public.admins a where a.user_id = u.id)
      and (lower(coalesce(u.email, '')) like '%' || q || '%' or lower(coalesce(c.name, '')) like '%' || q || '%'
        or (char_length(d) >= 4 and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || d || '%')
        or exists (select 1 from public.orders o where o.customer_id = u.id
                   and (lower(o.customer_name) like '%' || q || '%' or (char_length(d) >= 4 and regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g') like '%' || d || '%'))))
    limit 30) z), '[]'::jsonb);
end $$;

-- Block a customer who abuses ShopDesk (insults, fake problems, unpaid orders). They can't order, write or report.
-- For a shop owner this only stops their buying: their own shop keeps running (suspend the shop for that).
create or replace function public.admin_block_user(p_user uuid, p_block boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Write the reason (it goes in the audit log).'; end if;
  if p_user is null or (public.has_shop(p_user) and not public.has_shopped(p_user)) then raise exception 'That isn''t a customer account. Suspend the shop instead.'; end if;
  if p_block then
    insert into public.blocked_users (user_id, reason, created_by) values (p_user, left(trim(p_reason), 300), auth.uid())
    on conflict (user_id) do update set reason = excluded.reason, created_by = excluded.created_by, created_at = now();
  else
    delete from public.blocked_users where user_id = p_user;
  end if;
  insert into public.audit_log (actor, action, detail) values (auth.uid(), case when p_block then 'block_customer' else 'unblock_customer' end,
    left((select email from auth.users where id = p_user) || ': ' || trim(p_reason), 300));
end $$;

revoke all on function public.my_purchases(date, date) from public, anon;
grant execute on function public.my_purchases(date, date) to authenticated;
