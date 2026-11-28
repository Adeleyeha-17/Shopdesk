-- 035: alerts that bring people back.
--   - Cart reminders: a signed-in customer's cart is kept on their account too (it opens on another phone), and if they
--     leave it, ShopDesk reminds them: 3 hours later, then once more after a day.
--   - A Monday summary for each shop: last week's sales, orders, the change on the week before, and the best seller.
--   - Sales are slower: when a shop's week is well behind last week's, an alert, and a card on the Sales tab that starts
--     a discount (code and banner) in one tap, ready to announce.
-- Run after 034. Safe to run more than once.

create table if not exists public.saved_carts (
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  items jsonb not null,               -- { "product id" or "product id:size id": quantity }, as on the phone
  count int not null default 0,
  updated_at timestamptz not null default now(),
  reminders smallint not null default 0 check (reminders between 0 and 2),
  primary key (user_id, shop_id)
);
alter table public.saved_carts enable row level security;
revoke all on public.saved_carts from anon, authenticated;

alter table public.shop_nudges drop constraint if exists shop_nudges_kind_check;
alter table public.shop_nudges add constraint shop_nudges_kind_check
  check (kind in ('orders_waiting', 'no_products', 'quiet', 'weekly', 'slow'));

-- The phone sends the cart a moment after it changes (an empty cart is forgotten). Signed out: nothing is kept.
create or replace function public.save_cart(p_slug text, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_shop uuid; v_items jsonb; v_count int;
begin
  if auth.uid() is null then return; end if;
  select id into v_shop from public.shops where slug = lower(p_slug);
  if v_shop is null then return; end if;
  select coalesce(jsonb_object_agg(k, least(q, 99)), '{}'::jsonb), coalesce(sum(least(q, 99)), 0) into v_items, v_count
  from (select key as k, (value #>> '{}')::numeric::int as q from jsonb_each(case when jsonb_typeof(p_items) = 'object' then p_items else '{}' end)
        where key ~ '^[0-9a-f-]{36}(:[0-9a-zA-Z_-]{1,40})?$' and (value #>> '{}') ~ '^[0-9]{1,3}$' limit 50) x
  where q > 0;
  if v_count = 0 then
    delete from public.saved_carts where user_id = auth.uid() and shop_id = v_shop;
    return;
  end if;
  insert into public.saved_carts (user_id, shop_id, items, count) values (auth.uid(), v_shop, v_items, v_count)
  on conflict (user_id, shop_id) do update set items = excluded.items, count = excluded.count,
    updated_at = case when saved_carts.items is distinct from excluded.items then now() else saved_carts.updated_at end,
    reminders = case when saved_carts.items is distinct from excluded.items then 0 else saved_carts.reminders end;
end $$;

-- (not once they've ordered from the shop since: that cart became the order)
create or replace function public.my_cart(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select c.items from public.saved_carts c join public.shops s on s.id = c.shop_id
    where c.user_id = auth.uid() and s.slug = lower(p_slug)
      and not exists (select 1 from public.orders o where o.shop_id = c.shop_id and o.customer_id = c.user_id and o.created_at > c.updated_at)),
    '{}'::jsonb);
$$;

-- Reminds customers about carts they left, from 9am to 8pm Lagos time: 3 hours after the last change, and once more a
-- day after. Not if they've ordered from that shop since, the shop isn't open, or nothing in it is for sale any more.
-- Carts older than 3 days are left alone. p_hour stands in for the Lagos hour, for tests.
create or replace function public.remind_carts(p_hour int default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; h int := coalesce(p_hour, extract(hour from now() at time zone 'Africa/Lagos')::int);
  v_first text; v_left int;
begin
  if h not between 9 and 20 then return 0; end if;
  perform set_config('shopdesk.system', 'on', true);
  for r in
    select c.user_id, c.shop_id, c.items, c.count, c.reminders, s.name, s.slug from public.saved_carts c join public.shops s on s.id = c.shop_id
    where public.shop_open(s) and c.updated_at > now() - interval '3 days'
      and ((c.reminders = 0 and c.updated_at < now() - interval '3 hours') or (c.reminders = 1 and c.updated_at < now() - interval '24 hours'))
      and not exists (select 1 from public.orders o where o.shop_id = c.shop_id and o.customer_id = c.user_id and o.created_at > c.updated_at)
  loop
    -- the dearest thing still for sale leads the reminder
    select (array_agg(p.name order by coalesce(p.sale_price, p.price) desc, p.name))[1], count(*) into v_first, v_left
    from public.products p
    where p.id in (select split_part(k, ':', 1)::uuid from jsonb_object_keys(r.items) k) and p.active and not p.hidden_by_admin;
    if v_left = 0 then
      update public.saved_carts set reminders = 2 where user_id = r.user_id and shop_id = r.shop_id;
      continue;
    end if;
    perform public.notify(r.user_id, null, 'cart_reminder',
      case when r.count = 1 then 'You left 1 item' else 'You left ' || r.count || ' items' end,
      v_first || case when v_left > 1 then ' and ' || (v_left - 1) || ' more are' else ' is' end || ' waiting at ' || r.name || '.',
      '/' || r.slug || '/cart');
    update public.saved_carts set reminders = reminders + 1 where user_id = r.user_id and shop_id = r.shop_id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- What a shop sold between two moments: money in for paid orders (without delivery), how many, and the best seller.
create or replace function public.shop_sold(p_shop uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total', coalesce(sum(o.items_total), 0), 'orders', count(*),
    'best', (select i.name from public.order_items i join public.orders x on x.id = i.order_id
      where x.shop_id = p_shop and x.status in ('paid', 'out', 'delivered') and x.paid_at >= p_from and x.paid_at < p_to
      group by i.name order by sum(i.qty) desc, i.name limit 1))
  from public.orders o
  where o.shop_id = p_shop and o.status in ('paid', 'out', 'delivered') and o.paid_at >= p_from and o.paid_at < p_to;
$$;

-- This week so far against the same days and hours last week (weeks start Monday, Lagos time).
create or replace function public.week_pace(p_shop uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with w as (select (date_trunc('week', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos') as monday)
  select jsonb_build_object(
    'so_far', (public.shop_sold(p_shop, w.monday, now())->>'total')::int,
    'last', (public.shop_sold(p_shop, w.monday - interval '7 days', now() - interval '7 days')->>'total')::int)
  from w;
$$;

-- The Sales tab: is this week slower? slow when last week had ₦10,000 or more by now and this week has under 60% of it,
-- from Wednesday on. sale_on: a quick sale is already running.
create or replace function public.sales_pace() returns jsonb
language sql stable security definer set search_path = public as $$
  select p || jsonb_build_object('slow', extract(isodow from now() at time zone 'Africa/Lagos') >= 3
      and (p->>'last')::int >= 10000 and (p->>'so_far')::int < (p->>'last')::int * 0.6,
    'sale_on', exists (select 1 from public.coupons c where c.shop_id = s.id and c.code ~ '^SAVE(5|10|15|20)$' and c.active
      and c.ends_on >= (now() at time zone 'Africa/Lagos')::date))
  from public.shops s, lateral (select public.week_pace(s.id) as p) x
  where s.owner_id = auth.uid();
$$;

-- One tap from the slow-sales card: a discount code (SAVE10 and the like) on for 3 days, and the sale banner saying so.
-- Returns the code, ready to announce.
create or replace function public.quick_sale(p_percent int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.shops; v_code text; v_id bigint; v_end date := (now() at time zone 'Africa/Lagos')::date + 3;
begin
  select * into s from public.shops where owner_id = auth.uid();
  if not found then raise exception 'Not allowed.'; end if;
  if p_percent not in (5, 10, 15, 20) then raise exception 'Pick 5, 10, 15 or 20 percent.'; end if;
  v_code := 'SAVE' || p_percent;
  insert into public.coupons (shop_id, code, kind, value, ends_on, active) values (s.id, v_code, 'percent', p_percent, v_end, true)
  on conflict (shop_id, code) do update set kind = 'percent', value = excluded.value, ends_on = excluded.ends_on, active = true,
    min_total = 0, max_uses = null
  returning id into v_id;
  update public.shops set banner = p_percent || '% off everything with code ' || v_code || ' until ' || to_char(v_end, 'FMDay'),
    banner_until = v_end where id = s.id;
  return jsonb_build_object('id', v_id, 'code', v_code, 'ends_on', v_end);
end $$;

-- Monday summaries (8 to 11am Lagos time) and slow-week alerts (Wednesday to Saturday, 10am to 6pm), at most one of each
-- a week per shop. p_hour and p_dow (1 Monday … 7 Sunday) stand in for the Lagos time, for tests.
create or replace function public.shop_summaries(p_hour int default null, p_dow int default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; h int := coalesce(p_hour, extract(hour from now() at time zone 'Africa/Lagos')::int);
  d int := coalesce(p_dow, extract(isodow from now() at time zone 'Africa/Lagos')::int);
  v_mon timestamptz := date_trunc('week', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  v_last jsonb; v_prev jsonb; v_pace jsonb; v_change text;
begin
  perform set_config('shopdesk.system', 'on', true);
  if d = 1 and h between 8 and 11 then
    for r in select s.id, s.owner_id from public.shops s where s.status = 'active'
      and not exists (select 1 from public.shop_nudges sn where sn.shop_id = s.id and sn.kind = 'weekly' and sn.sent_at > now() - interval '6 days')
    loop
      v_last := public.shop_sold(r.id, v_mon - interval '7 days', v_mon);
      v_prev := public.shop_sold(r.id, v_mon - interval '14 days', v_mon - interval '7 days');
      continue when (v_last->>'orders')::int = 0;
      v_change := case when (v_prev->>'total')::int > 0 then
          case when (v_last->>'total')::int >= (v_prev->>'total')::int then ', up ' else ', down ' end
          || round(abs((v_last->>'total')::numeric - (v_prev->>'total')::int) * 100 / (v_prev->>'total')::int) || '%'
        else '' end;
      perform public.notify(r.owner_id, null, 'weekly', 'Your week: ' || public.naira((v_last->>'total')::int),
        (v_last->>'orders') || case when (v_last->>'orders')::int = 1 then ' order' else ' orders' end || v_change || '.'
          || coalesce(' Best seller: ' || (v_last->>'best') || '.', ''),
        '/#sales');
      insert into public.shop_nudges (shop_id, kind) values (r.id, 'weekly');
      n := n + 1;
    end loop;
  end if;
  if d between 3 and 6 and h between 10 and 17 then
    for r in select s.id, s.owner_id from public.shops s where s.status = 'active'
      and not exists (select 1 from public.shop_nudges sn where sn.shop_id = s.id and sn.kind = 'slow' and sn.sent_at > now() - interval '6 days')
    loop
      v_pace := public.week_pace(r.id);
      continue when (v_pace->>'last')::int < 10000 or (v_pace->>'so_far')::int >= (v_pace->>'last')::int * 0.6;
      perform public.notify(r.owner_id, null, 'slow_sales', 'Sales are slower this week',
        public.naira((v_pace->>'so_far')::int) || ' so far, ' || public.naira((v_pace->>'last')::int)
          || ' by now last week.', '/#sales');
      insert into public.shop_nudges (shop_id, kind) values (r.id, 'slow');
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;

revoke all on function public.save_cart(text, jsonb), public.my_cart(text), public.remind_carts(int), public.shop_sold(uuid, timestamptz, timestamptz),
  public.week_pace(uuid), public.sales_pace(), public.quick_sale(int), public.shop_summaries(int, int) from public, anon, authenticated;
grant execute on function public.save_cart(text, jsonb), public.my_cart(text), public.sales_pace(), public.quick_sale(int) to authenticated;

-- Every hour: shop nudges, payment reminders, cart reminders, summaries; then the push sender sends them straight away.
do $nudge$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'shopdesk-nudge';
    perform cron.schedule('shopdesk-nudge', '7 * * * *',
      $job$select public.nudge_shops(); select public.remind_buyers(); select public.remind_carts(); select public.shop_summaries(); select net.http_post(url := 'https://buvzjgzoctmpgthelddr.supabase.co/functions/v1/push', body := '{"action":"flush"}'::jsonb)$job$);
  end if;
end $nudge$;
