-- 013: the sales report.
--   * orders keep the customer's area and where they came from; order lines keep the price before a sale
--   * customers' saved details keep their area; shops get a monthly goal
--   * money out: what a shop spends (restock, packaging, transport...), with ShopDesk plan payments added automatically
--   * place_order saves the area, the source and the price before a sale
--   * shops can message their customers inside ShopDesk (message_customer)
--   * on the last day of every month each shop gets its monthly report alert (send_monthly_reports, by cron)
-- Safe to run more than once. Run it before publishing the app version with the new Sales tab.

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

alter table public.money_out enable row level security;
drop policy if exists money_out_owner on public.money_out;
create policy money_out_owner on public.money_out for all to authenticated using (shop_id = public.my_shop_id()) with check (shop_id = public.my_shop_id());
revoke all on public.money_out from anon, authenticated;
grant select, delete on public.money_out to authenticated;
grant insert (shop_id, amount, kind, note, spent_on) on public.money_out to authenticated;
grant update (monthly_goal) on public.shops to authenticated;
grant insert (area) on public.customers to authenticated;
grant update (area) on public.customers to authenticated;

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

-- plan payments recorded before this update count as money out too (once)
insert into public.money_out (shop_id, amount, kind, note, spent_on, created_at)
select pp.shop_id, pp.amount, 'shopdesk', 'ShopDesk plan · ' || pp.months || ' month' || case when pp.months = 1 then '' else 's' end,
       (pp.created_at at time zone 'Africa/Lagos')::date, pp.created_at
from public.plan_payments pp
where pp.amount > 0 and not exists (select 1 from public.money_out m where m.shop_id = pp.shop_id and m.kind = 'shopdesk' and m.created_at = pp.created_at);

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
    select coalesce(sum(amount), 0) into v_out from public.money_out where shop_id = s.id and spent_on between v_first and v_today;
    v_left := v_in - v_out;
    perform public.notify(s.owner_id, null, 'monthly_report', 'Your ' || to_char(v_today, 'FMMonth') || ' report is ready',
      public.naira(v_in::int) || ' in from ' || v_orders || ' order' || case when v_orders = 1 then '' else 's' end ||
      case when v_out > 0 then ' · ' || case when v_left < 0 then '-' else '' end || public.naira(abs(v_left)::int) || ' left after money out' else '' end ||
      '. Tap to see it.', '/?report=' || v_key || '#sales');
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.message_customer(uuid, text), public.send_monthly_reports(date), public.money_out_from_plan() from public, anon, authenticated;
grant execute on function public.message_customer(uuid, text) to authenticated;

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
