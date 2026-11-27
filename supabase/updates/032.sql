-- 032: ideas from other shop platforms.
--   - Note for the shop: customers can leave a short note at checkout.
--   - Discount codes: a shop makes codes (% off or ₦ off, with an optional minimum order, end date and number of uses); customers
--     type one at checkout and place_order checks it on the real prices. items_total is the amount after the discount.
--   - Sale banner: one line at the top of the shop's page, until a date the shop picks.
--   - Receipt emails: "order placed" and "payment confirmed" to the customer, always (the push function sends them).
--   - Pay links: the customer can send a link so someone else pays (by transfer or online). The link shows the shop, the items
--     and the amount, never the customer's address or phone.
-- Safe to run more than once.

-- shop links can't be "pay" (pay links live at /pay/...)
alter table public.shops drop constraint if exists shops_slug_reserved;
alter table public.shops add constraint shops_slug_reserved check (slug not in ('admin', 'privacy', 'orders', 'order', 'login', 'signin', 'shopdesk', 'help', 'support', 'api', 'app', 'email-off', 'account', 'shops', 'carts', 'legal', 'terms', 'prohibited', 'pay'));

-- ---------- note for the shop, discount codes, sale banner, receipt emails, pay links ----------
-- A note the customer leaves for the shop at checkout ("Leave it with the gateman").
alter table public.orders add column if not exists note text not null default '' check (char_length(note) <= 200);
-- A one-line sale banner at the top of the shop's page ("Sale ends 1 Dec"), shown until banner_until (Lagos date) if set.
alter table public.shops add column if not exists banner text not null default '' check (char_length(banner) <= 80);
alter table public.shops add column if not exists banner_until date;
grant update (banner, banner_until) on public.shops to authenticated;

-- A shop's discount codes. Customers type the code at checkout; place_order checks it on the real prices.
-- Shops read their own; every change goes through save_coupon and delete_coupon.
create table if not exists public.coupons (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{3,20}$'),
  kind text not null check (kind in ('percent', 'amount')),
  value integer not null check (value > 0 and (kind <> 'percent' or value <= 90) and value <= 10000000),
  min_total integer not null default 0 check (min_total between 0 and 100000000),
  ends_on date,
  max_uses integer check (max_uses is null or max_uses between 1 and 100000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists coupons_shop_code on public.coupons (shop_id, code);
alter table public.coupons enable row level security;
revoke all on public.coupons from anon, authenticated;
grant select on public.coupons to authenticated;
drop policy if exists coupons_owner_read on public.coupons;
create policy coupons_owner_read on public.coupons for select to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));
-- the code on an order, and what it took off (items_total is already after the discount)
alter table public.orders add column if not exists coupon_id bigint references public.coupons(id) on delete set null;
alter table public.orders add column if not exists coupon_code text not null default '';
alter table public.orders add column if not exists discount integer not null default 0 check (discount >= 0);
create index if not exists orders_coupon on public.orders (coupon_id) where coupon_id is not null;

-- A second secret link to an order, only for paying it: whoever has it sees the shop, the items and what's left to pay,
-- never the customer's address or phone.
alter table public.orders add column if not exists pay_token uuid not null default gen_random_uuid();
create unique index if not exists orders_pay_token on public.orders (pay_token);

-- Receipt emails to the customer: "order placed" and "payment confirmed". Always sent (they're receipts), whatever the
-- customer chose for alert emails. The push function sends them.
create table if not exists public.receipt_emails (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  kind text not null check (kind in ('placed', 'paid')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  tries integer not null default 0,
  unique (order_id, kind)
);
alter table public.receipt_emails enable row level security;
revoke all on public.receipt_emails from anon, authenticated;

-- What a code takes off an order of p_total: a percentage (rounded down) or a fixed amount, always leaving ₦100 to pay.
create or replace function public.coupon_discount(c public.coupons, p_total int) returns int
language sql immutable set search_path = public as $$
  select greatest(0, least(case when c.kind = 'percent' then p_total * c.value / 100 else c.value end, p_total - 100));
$$;

-- The shop's code, if p_user can use it now on an order of p_total. Otherwise a plain reason why not.
create or replace function public.coupon_for(p_shop uuid, p_code text, p_total int, p_user uuid) returns public.coupons
language plpgsql stable security definer set search_path = public as $$
declare c public.coupons;
begin
  select * into c from public.coupons where shop_id = p_shop and code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  if not found or not c.active then raise exception 'That code doesn''t work in this shop.'; end if;
  if c.ends_on is not null and c.ends_on < (now() at time zone 'Africa/Lagos')::date then raise exception 'That code has ended.'; end if;
  if c.max_uses is not null and (select count(*) from public.orders o where o.coupon_id = c.id and o.status <> 'cancelled') >= c.max_uses then
    raise exception 'That code has been used up.';
  end if;
  if p_user is not null and exists (select 1 from public.orders o where o.coupon_id = c.id and o.customer_id = p_user and o.status <> 'cancelled') then
    raise exception 'You''ve already used this code.';
  end if;
  if p_total < c.min_total then raise exception 'This code is for orders of % or more.', public.naira(c.min_total); end if;
  if public.coupon_discount(c, p_total) <= 0 then raise exception 'This order is too small for that code.'; end if;
  return c;
end $$;
revoke all on function public.coupon_discount(public.coupons, int), public.coupon_for(uuid, text, int, uuid) from public, anon, authenticated;

-- The storefront now carries the sale banner, and whether the shop has codes (so checkout shows the code box).
create or replace function public.get_storefront(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shop', jsonb_build_object('name', s.name, 'slug', s.slug, 'bank', s.bank, 'account_number', s.account_number, 'account_name', s.account_name,
      'allow_part_payment', s.allow_part_payment, 'delivery_paid_by', s.delivery_paid_by,
      'banner', case when s.banner <> '' and (s.banner_until is null or s.banner_until >= (now() at time zone 'Africa/Lagos')::date) then s.banner end,
      'has_coupons', exists (select 1 from public.coupons c where c.shop_id = s.id and c.active
        and (c.ends_on is null or c.ends_on >= (now() at time zone 'Africa/Lagos')::date))) || public.shop_rating(s.id),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price, 'sale_price', p.sale_price, 'stock', p.stock,
        'photo_path', p.photo_path, 'option_label', p.option_label, 'description', p.description,
        'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price', o.price, 'sale_price', o.sale_price, 'stock', o.stock)
          order by o.sort_order, o.created_at) from public.product_options o where o.product_id = p.id), '[]'::jsonb)) order by p.created_at desc)
      from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin), '[]'::jsonb))
  from public.shops s where s.slug = lower(p_slug) and public.shop_open(s) and not public.shop_owes(s.id);
$$;

-- Placing an order: now with the note and the discount code, and the "order placed" email.
create or replace function public.place_order(p_slug text, p_customer jsonb, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shop public.shops; v_order public.orders; v_item jsonb; v_prod public.products; v_opt public.product_options; v_qty int; v_total int := 0;
  v_mode text; v_price int; v_full int; v_addr text; v_lat float8; v_lng float8; v_area text; v_source text;
  v_note text; v_coupon public.coupons; v_discount int := 0;
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
  v_note := left(regexp_replace(trim(coalesce(p_customer->>'note', '')), '\s+', ' ', 'g'), 200);
  -- no more than 10 orders a minute per shop from the order page, to stop floods
  if (select count(*) from public.orders where shop_id = v_shop.id and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Too many orders at once. Try again in a minute.';
  end if;
  insert into public.orders (shop_id, customer_id, customer_name, customer_phone, mode, address, items_total, delivery_paid_by, delivery_lat, delivery_lng, area, source, note)
  values (v_shop.id, auth.uid(), left(trim(p_customer->>'name'), 60), left(trim(coalesce(p_customer->>'phone', '')), 20), v_mode,
          v_addr, 0, v_shop.delivery_paid_by, v_lat, v_lng, v_area, v_source, v_note)
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
  -- a discount code, checked on the real prices; items_total is what's left after it
  if char_length(trim(coalesce(p_customer->>'coupon', ''))) > 0 then
    perform 1 from public.coupons where shop_id = v_shop.id and code = upper(regexp_replace(p_customer->>'coupon', '\s', '', 'g')) for update;
    v_coupon := public.coupon_for(v_shop.id, p_customer->>'coupon', v_total, auth.uid());
    v_discount := public.coupon_discount(v_coupon, v_total);
  end if;
  update public.orders set items_total = v_total - v_discount, discount = v_discount, coupon_id = v_coupon.id, coupon_code = coalesce(v_coupon.code, '')
  where id = v_order.id;
  perform public.notify(v_shop.owner_id, v_order.id, 'new_order', 'New order ' || public.order_code(v_shop.order_prefix, v_order.id),
    v_order.customer_name || ' · ' || public.naira(v_total - v_discount) || case when v_mode = 'pickup' then ' · pick-up' else '' end
      || case when v_note <> '' then ' · note' else '' end, '/?order=' || v_order.id || '#orders');
  insert into public.receipt_emails (order_id, kind) values (v_order.id, 'placed') on conflict do nothing;
  return jsonb_build_object('order_id', v_order.id, 'token', v_order.public_token, 'items_total', v_total - v_discount, 'discount', v_discount,
    'delivery_pending', v_mode = 'delivery' and v_shop.delivery_paid_by = 'customer');
end $$;

-- Starts an online payment: records the attempt and returns what Paystack needs. p_email: the payer's, when someone else pays
-- with the order's pay link (otherwise the customer's own).
create or replace function public.money_start(p_order bigint, p_ref text, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders; s public.shops; st public.settings; v_due int; v_delivery int; v_fee int; v_service int;
begin
  select * into st from public.settings where id = 1;
  select * into v from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  select * into s from public.shops where id = v.shop_id;
  if not (st.online_pay_on or s.pay_test) then raise exception 'Paying online isn''t on yet. Pay by transfer for now.'; end if;
  if v.status not in ('awaiting', 'part') then raise exception 'This order is already paid or closed.'; end if;
  if v.mode = 'delivery' and v.delivery_paid_by = 'customer' and v.delivery_fee is null then raise exception 'Wait for the shop to confirm your order and its delivery fee.'; end if;
  if s.status <> 'active' then raise exception 'This shop isn''t taking orders.'; end if;
  v_due := v.items_total + case when v.delivery_paid_by = 'customer' then coalesce(v.delivery_fee, 0) else 0 end - v.amount_paid;
  if v_due <= 0 then raise exception 'Nothing is left to pay.'; end if;
  -- ShopDesk's part: the courier price, paid by the customer on top, or taken from the items when the shop covers delivery
  v_delivery := case when v.delivery_by = 'shopdesk' and v.amount_paid = 0 then
    case when v.delivery_paid_by = 'customer' then coalesce(v.delivery_fee, 0) else coalesce((v.delivery_quote->>'price')::int, 0) end else 0 end;
  v_service := st.online_service_fee;
  v_fee := case when st.paystack_fee_by = 'customer' then public.online_fee(v_due + v_service) else 0 end;
  insert into public.online_payments (reference, order_id, shop_id, amount, delivery_part, fee, service)
  values (p_ref, v.id, v.shop_id, v_due, v_delivery, v_fee, v_service);
  return jsonb_build_object('amount', v_due, 'delivery_part', v_delivery, 'fee', v_fee, 'service', v_service, 'fee_by', st.paystack_fee_by, 'order_id', v.id,
    'email', coalesce(p_email, (select email from auth.users where id = v.customer_id), 'order' || v.id || '@shopdesk.com.ng'),
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'bank', s.bank, 'account_number', s.account_number,
      'subaccount', s.paystack_subaccount, 'subaccount_for', s.paystack_for, 'test', s.pay_test));
end $$;

-- The customer pays their own order.
create or replace function public.money_start_payment(p_token uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders;
begin
  select * into v from public.orders where public_token = p_token;
  if not found then raise exception 'Order not found.'; end if;
  if v.customer_id is not null and v.customer_id is distinct from auth.uid() then raise exception 'Sign in with the account that placed this order.'; end if;
  return public.money_start(v.id, p_ref, null);
end $$;

-- Someone else paying with a pay link uses money_start too; only the money function can start payments.
revoke all on function public.money_start(bigint, text, text), public.money_start_payment(uuid, text) from public, anon, authenticated;

-- ---------- note for the shop, discount codes, sale banner, receipt emails, pay links (the functions) ----------
-- At checkout: does this code work here, and what does it take off? (place_order checks it again on the real prices.)
create or replace function public.check_coupon(p_slug text, p_code text, p_total int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.shops; c public.coupons;
begin
  if auth.uid() is null then raise exception 'Sign in to use a code.'; end if;
  select * into s from public.shops where slug = lower(p_slug);
  if not found then raise exception 'Shop not found.'; end if;
  c := public.coupon_for(s.id, p_code, greatest(coalesce(p_total, 0), 0), auth.uid());
  return jsonb_build_object('code', c.code, 'kind', c.kind, 'value', c.value, 'min_total', c.min_total,
    'discount', public.coupon_discount(c, greatest(coalesce(p_total, 0), 0)));
end $$;

-- The shop's codes, with how many orders used each and how much they took off.
create or replace function public.shop_coupons() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'kind', c.kind, 'value', c.value, 'min_total', c.min_total,
      'ends_on', c.ends_on, 'max_uses', c.max_uses, 'active', c.active,
      'ended', c.ends_on is not null and c.ends_on < (now() at time zone 'Africa/Lagos')::date,
      'uses', (select count(*) from public.orders o where o.coupon_id = c.id and o.status <> 'cancelled'),
      'off', (select coalesce(sum(o.discount), 0) from public.orders o where o.coupon_id = c.id and o.status <> 'cancelled'))
    order by c.created_at desc), '[]'::jsonb)
  from public.coupons c join public.shops s on s.id = c.shop_id where s.owner_id = auth.uid();
$$;

-- Make a code (p_id null) or change one. Codes are letters and numbers, kept in capitals.
create or replace function public.save_coupon(p_id bigint, p_code text, p_kind text, p_value int, p_min int, p_ends date, p_max int, p_active boolean)
returns bigint language plpgsql security definer set search_path = public as $$
declare s public.shops; v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')); v_id bigint;
begin
  select * into s from public.shops where owner_id = auth.uid();
  if not found then raise exception 'Only shops can make discount codes.'; end if;
  if v_code !~ '^[A-Z0-9]{3,20}$' then raise exception 'A code needs 3 to 20 letters or numbers, with no spaces.'; end if;
  if p_kind not in ('percent', 'amount') then raise exception 'Choose a percentage or an amount off.'; end if;
  if p_kind = 'percent' and (p_value is null or p_value not between 1 and 90) then raise exception 'The percentage needs to be from 1 to 90.'; end if;
  if p_kind = 'amount' and (p_value is null or p_value not between 50 and 10000000) then raise exception 'The amount off needs to be ₦50 or more.'; end if;
  if coalesce(p_min, 0) not between 0 and 100000000 then raise exception 'Check the minimum order.'; end if;
  if p_max is not null and p_max not between 1 and 100000 then raise exception 'Uses need to be 1 or more, or left empty for no limit.'; end if;
  if p_ends is not null and p_ends < (now() at time zone 'Africa/Lagos')::date then raise exception 'The end date has already passed.'; end if;
  if p_id is null then
    if (select count(*) from public.coupons where shop_id = s.id) >= 50 then raise exception 'You can have up to 50 codes. Delete an old one first.'; end if;
    insert into public.coupons (shop_id, code, kind, value, min_total, ends_on, max_uses, active)
    values (s.id, v_code, p_kind, p_value, coalesce(p_min, 0), p_ends, p_max, coalesce(p_active, true)) returning id into v_id;
  else
    update public.coupons set code = v_code, kind = p_kind, value = p_value, min_total = coalesce(p_min, 0), ends_on = p_ends, max_uses = p_max,
      active = coalesce(p_active, true)
    where id = p_id and shop_id = s.id returning id into v_id;
    if v_id is null then raise exception 'Code not found.'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'You already have a code called %.', v_code;
end $$;

create or replace function public.delete_coupon(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.coupons c using public.shops s where c.id = p_id and s.id = c.shop_id and s.owner_id = auth.uid();
  if not found then raise exception 'Code not found.'; end if;
end $$;

-- The bits of an order that came with these: the note, the code and what it took off, and (for the customer, while
-- something is left to pay) the pay link to send to someone else.
create or replace function public.order_extras(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('note', o.note, 'discount', o.discount, 'coupon', o.coupon_code,
    'pay_token', case when o.customer_id = auth.uid() and o.status in ('awaiting', 'part') then o.pay_token end)
  from public.orders o where o.public_token = p_token;
$$;

-- The pay link page: the shop, the items and what's left to pay. No customer details.
create or replace function public.get_pay_link(p_pay uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', public.order_code(s.order_prefix, o.id), 'status', o.status, 'mode', o.mode,
    'shop', jsonb_build_object('name', s.name, 'slug', s.slug, 'bank', s.bank, 'account_number', s.account_number, 'account_name', s.account_name),
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'price', i.price) order by i.id) from public.order_items i where i.order_id = o.id),
    'discount', o.discount, 'coupon', o.coupon_code,
    'delivery_fee', case when o.delivery_paid_by = 'customer' then o.delivery_fee end,
    'fee_pending', o.mode = 'delivery' and o.delivery_paid_by = 'customer' and o.delivery_fee is null,
    'to_pay', o.items_total + case when o.delivery_paid_by = 'customer' then coalesce(o.delivery_fee, 0) else 0 end,
    'amount_paid', o.amount_paid,
    'online', (st.online_pay_on or s.pay_test) and s.status = 'active' and s.bank <> 'Other bank' and s.account_number ~ '^[0-9]{10}$'
      and o.status in ('awaiting', 'part') and not (o.mode = 'delivery' and o.delivery_paid_by = 'customer' and o.delivery_fee is null),
    'online_only', o.delivery_by = 'shopdesk',
    'fee', case when st.paystack_fee_by = 'customer' then public.online_fee(st.online_service_fee +
      o.items_total + case when o.delivery_paid_by = 'customer' then coalesce(o.delivery_fee, 0) else 0 end - o.amount_paid) else 0 end,
    'service', st.online_service_fee)
  from public.orders o join public.shops s on s.id = o.shop_id cross join public.settings st where o.pay_token = p_pay and st.id = 1;
$$;

-- Someone else pays with the pay link: their email goes to Paystack for the receipt.
create or replace function public.money_start_link_payment(p_pay uuid, p_ref text, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_email text := lower(trim(coalesce(p_email, '')));
begin
  select id into v_id from public.orders where pay_token = p_pay;
  if not found then raise exception 'This pay link isn''t right. Ask for a new one.'; end if;
  if v_email !~ '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$' or char_length(v_email) > 120 then raise exception 'Enter your email for the receipt.'; end if;
  return public.money_start(v_id, p_ref, v_email);
end $$;

-- Receipt emails: what the email needs about the order.
create or replace function public.receipt_json(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'kind', r.kind, 'email', u.email, 'name', o.customer_name, 'shop', s.name, 'slug', s.slug,
    'code', public.order_code(s.order_prefix, o.id), 'token', o.public_token, 'status', o.status, 'mode', o.mode, 'address', o.address, 'note', o.note,
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'price', i.price) order by i.id) from public.order_items i where i.order_id = o.id),
    'discount', o.discount, 'coupon', o.coupon_code, 'delivery_fee', o.delivery_fee, 'delivery_paid_by', o.delivery_paid_by,
    'to_pay', o.items_total + case when o.delivery_paid_by = 'customer' then coalesce(o.delivery_fee, 0) else 0 end, 'amount_paid', o.amount_paid,
    'fee_pending', o.mode = 'delivery' and o.delivery_paid_by = 'customer' and o.delivery_fee is null,
    'online_only', o.delivery_by = 'shopdesk', 'pay_by', o.created_at + interval '48 hours',
    'bank', s.bank, 'account_number', s.account_number, 'account_name', s.account_name, 'at', o.created_at, 'paid_at', o.paid_at)
  from public.receipt_emails r join public.orders o on o.id = r.order_id join public.shops s on s.id = o.shop_id
  left join auth.users u on u.id = o.customer_id
  where r.id = p_id;
$$;

-- The push function takes up to p_limit receipts to send (each one tried up to 5 times, for 2 days).
create or replace function public.receipt_claim(p_limit int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ids bigint[];
begin
  select array_agg(id) into ids from (
    select id from public.receipt_emails where sent_at is null and tries < 5 and created_at > now() - interval '2 days'
    order by id limit greatest(1, least(coalesce(p_limit, 20), 50)) for update skip locked) x;
  if ids is null then return '[]'::jsonb; end if;
  update public.receipt_emails set sent_at = now(), tries = tries + 1 where id = any(ids);
  return (select coalesce(jsonb_agg(public.receipt_json(r.id) order by r.id), '[]'::jsonb) from public.receipt_emails r where r.id = any(ids));
end $$;

-- Sending failed for a reason that may pass (the mail server was down): try again on the next run.
create or replace function public.receipt_unclaim(p_ids bigint[]) returns void
language sql security definer set search_path = public as $$
  update public.receipt_emails set sent_at = null where id = any(p_ids);
$$;

-- The order is paid in full: queue the "payment confirmed" email.
create or replace function public.orders_receipt() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.customer_id is not null then
    insert into public.receipt_emails (order_id, kind) values (new.id, 'paid') on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists orders_receipt on public.orders;
create trigger orders_receipt after update of status on public.orders for each row execute function public.orders_receipt();

revoke all on function public.check_coupon(text, text, int), public.shop_coupons(),
  public.save_coupon(bigint, text, text, int, int, date, int, boolean), public.delete_coupon(bigint), public.order_extras(uuid),
  public.get_pay_link(uuid), public.money_start_link_payment(uuid, text, text), public.receipt_json(bigint), public.receipt_claim(int),
  public.receipt_unclaim(bigint[]), public.orders_receipt() from public, anon, authenticated;
grant execute on function public.check_coupon(text, text, int), public.shop_coupons(),
  public.save_coupon(bigint, text, text, int, int, date, int, boolean), public.delete_coupon(bigint) to authenticated;
grant execute on function public.order_extras(uuid), public.get_pay_link(uuid) to anon, authenticated;
