-- ShopDesk update 008: sizes, sale prices, editing products, and "Use my current location" at checkout.
--   A product can have one list of choices (Size, Colour, Pack...), each with its own price, sale price and stock.
--   Shops can change a product's name, photo, prices, choices and stock at any time; orders already placed keep their prices.
--   Customers can share a map pin instead of typing an address; it is removed with the address after 180 days.
-- Safe to run more than once. Run in Supabase: SQL Editor -> New query -> paste -> Run.

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

alter table public.product_options enable row level security;

-- A shop reads its products' choices. They're only changed through save_product, add_option_stock and orders.
drop policy if exists product_options_owner_read on public.product_options;
create policy product_options_owner_read on public.product_options for select to authenticated using (shop_id = public.my_shop_id());

revoke all on public.product_options from anon, authenticated;
-- Changes to a product (name, photo, prices, choices, stock) go through save_product, which checks them; only hiding is direct.
revoke update on public.products from authenticated;
grant select on public.products, public.product_options to authenticated;
grant update (active) on public.products to authenticated;

create or replace function public.get_storefront(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shop', jsonb_build_object('name', s.name, 'slug', s.slug, 'bank', s.bank, 'account_number', s.account_number, 'account_name', s.account_name,
      'allow_part_payment', s.allow_part_payment, 'delivery_paid_by', s.delivery_paid_by),
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
  v_mode text; v_price int; v_addr text; v_lat float8; v_lng float8;
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
  -- no more than 10 orders a minute per shop from the order page, to stop floods
  if (select count(*) from public.orders where shop_id = v_shop.id and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Too many orders at once. Try again in a minute.';
  end if;
  insert into public.orders (shop_id, customer_id, customer_name, customer_phone, mode, address, items_total, delivery_paid_by, delivery_lat, delivery_lng)
  values (v_shop.id, auth.uid(), left(trim(p_customer->>'name'), 60), left(trim(coalesce(p_customer->>'phone', '')), 20), v_mode,
          v_addr, 0, v_shop.delivery_paid_by, v_lat, v_lng)
  returning * into v_order;
  -- signed-in customers: remember their details for next time (an address they typed, not a map pin)
  if auth.uid() is not null then
    insert into public.customers (user_id, name, phone, address)
    values (auth.uid(), v_order.customer_name, v_order.customer_phone, case when v_addr like 'Map pin %' then '' else v_addr end)
    on conflict (user_id) do update set name = excluded.name, phone = excluded.phone,
      address = case when excluded.address <> '' then excluded.address else public.customers.address end, updated_at = now();
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
      v_price := coalesce(v_opt.sale_price, v_opt.price);
    else
      if v_prod.stock = 0 then raise exception '% is sold out.', v_prod.name; end if;
      if v_prod.stock < v_qty then raise exception '% has only % left.', v_prod.name, v_prod.stock; end if;
      update public.products set stock = stock - v_qty where id = v_prod.id;
      v_price := coalesce(v_prod.sale_price, v_prod.price);
    end if;
    insert into public.order_items (order_id, product_id, option_id, option_name, name, price, qty, photo_path)
    values (v_order.id, v_prod.id, v_opt.id, coalesce(v_opt.name, ''), v_prod.name || coalesce(' · ' || v_opt.name, ''), v_price, v_qty, v_prod.photo_path);
    v_total := v_total + v_price * v_qty;
  end loop;
  update public.orders set items_total = v_total where id = v_order.id;
  perform public.notify(v_shop.owner_id, v_order.id, 'new_order', 'New order ' || public.order_code(v_shop.order_prefix, v_order.id),
    v_order.customer_name || ' · ' || public.naira(v_total) || case when v_mode = 'pickup' then ' · pick-up' else '' end, '/?order=' || v_order.id || '#orders');
  return jsonb_build_object('order_id', v_order.id, 'token', v_order.public_token, 'items_total', v_total,
    'delivery_pending', v_mode = 'delivery' and v_shop.delivery_paid_by = 'customer');
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

-- Function rights: customers may only use the order-page functions.
revoke all on all functions in schema public from public, anon;
grant execute on function public.get_storefront(text), public.get_order_public(uuid), public.report_shop(text, text, text, uuid), public.customer_says_paid(uuid), public.customer_received(uuid) to anon, authenticated;
grant execute on function public.place_order(text, jsonb, jsonb) to authenticated;
grant execute on function public.is_admin(), public.my_shop_id(), public.set_delivery_fee(bigint, int), public.confirm_payment(bigint, text, int), public.mark_customer_says_paid(bigint),
  public.advance_order(bigint), public.add_stock(uuid, int), public.add_option_stock(uuid, int), public.save_product(uuid, jsonb), public.touch_shop(), public.admin_overview(), public.admin_reports(),
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
revoke execute on function public.restock(bigint[]), public.product_options_sync(), public.json_int(jsonb) from authenticated;


drop policy if exists photos_owner_read on storage.objects;
create policy photos_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] = public.my_shop_id()::text);
