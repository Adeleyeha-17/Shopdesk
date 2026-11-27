-- 033: more ways to pay online. Monnify and Flutterwave beside Paystack: Admin picks which ones customers see, each shop
-- gets a payout account at each gateway (its own bank account, so its share goes straight to it, as with Paystack), and
-- each online payment records which gateway took it. Run after 032. Safe to run more than once.

-- ---------- more ways to pay online: Monnify and Flutterwave beside Paystack ----------
-- Which gateways customers can pick from (Admin switches them on once their keys are in). A test shop sees them all.
alter table public.settings add column if not exists pay_gateways text[] not null default '{paystack}';
alter table public.settings drop constraint if exists settings_pay_gateways_check;
alter table public.settings add constraint settings_pay_gateways_check
  check (pay_gateways <@ array['paystack', 'monnify', 'flutterwave']::text[] and cardinality(pay_gateways) >= 1);
-- which gateway took each online payment
alter table public.online_payments add column if not exists provider text not null default 'paystack';
alter table public.online_payments drop constraint if exists online_payments_provider_check;
alter table public.online_payments add constraint online_payments_provider_check check (provider in ('paystack', 'monnify', 'flutterwave'));
-- Each shop's payout account at Monnify and Flutterwave (its own bank account): the shop's share of every payment goes
-- straight there, like a Paystack subaccount (those stay on shops.paystack_subaccount). for_account: the bank and number it
-- was made for, so a new bank account gets a new one.
create table if not exists public.shop_payouts (
  shop_id uuid not null references public.shops(id) on delete cascade,
  provider text not null check (provider in ('monnify', 'flutterwave')),
  code text not null check (char_length(code) between 3 and 80),
  for_account text not null,
  updated_at timestamptz not null default now(),
  primary key (shop_id, provider)
);
alter table public.shop_payouts enable row level security;
revoke all on public.shop_payouts from anon, authenticated;

-- The order page: can it be paid online (and the card fee the customer pays on top), and how its ShopDesk Delivery is going.
create or replace function public.order_money(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'online', (st.online_pay_on or s.pay_test) and s.status = 'active' and s.bank <> 'Other bank' and s.account_number ~ '^[0-9]{10}$'
      and o.status in ('awaiting', 'part') and not (o.mode = 'delivery' and o.delivery_paid_by = 'customer' and o.delivery_fee is null),
    'fee', case when st.paystack_fee_by = 'customer' then public.online_fee(st.online_service_fee +
      o.items_total + case when o.delivery_paid_by = 'customer' then coalesce(o.delivery_fee, 0) else 0 end - o.amount_paid) else 0 end,
    'service', st.online_service_fee,
    -- the gateways the customer can pick from
    'gateways', case when s.pay_test then array['paystack', 'monnify', 'flutterwave'] else st.pay_gateways end,
    -- a ShopDesk Delivery order is paid online only; wait: the shop hasn't picked the courier yet
    'online_only', o.delivery_by = 'shopdesk',
    'wait', st.delivery_on and o.mode = 'delivery' and o.delivery_by <> 'shopdesk' and o.confirmed_at is null and o.status = 'awaiting',
    'delivery_by', o.delivery_by,
    'courier', o.delivery_quote->>'name',
    'shipment', (select jsonb_build_object('courier', sh.courier, 'status', sh.status, 'tracking_url', sh.tracking_url, 'tracking_code', sh.tracking_code,
        'steps', sh.steps, 'rider', sh.rider) from public.shipments sh where sh.order_id = o.id))
  from public.orders o join public.shops s on s.id = o.shop_id cross join public.settings st where o.public_token = p_token and st.id = 1;
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
    'service', st.online_service_fee,
    'gateways', case when s.pay_test then array['paystack', 'monnify', 'flutterwave'] else st.pay_gateways end,
    'test', s.pay_test)
  from public.orders o join public.shops s on s.id = o.shop_id cross join public.settings st where o.pay_token = p_pay and st.id = 1;
$$;

create or replace function public.admin_save_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  update public.settings set
    monthly_price = coalesce((p->>'monthly_price')::int, monthly_price), trial_days = coalesce((p->>'trial_days')::int, trial_days),
    grace_days = coalesce((p->>'grace_days')::int, grace_days), close_unpaid = coalesce((p->>'close_unpaid')::boolean, close_unpaid),
    pay_bank = left(trim(coalesce(p->>'pay_bank', pay_bank)), 30), pay_account_number = left(regexp_replace(coalesce(p->>'pay_account_number', pay_account_number), '\s', '', 'g'), 20),
    pay_account_name = left(trim(coalesce(p->>'pay_account_name', pay_account_name)), 60), admin_whatsapp = left(trim(coalesce(p->>'admin_whatsapp', admin_whatsapp)), 20),
    invites_on = coalesce((p->>'invites_on')::boolean, invites_on), invite_months = coalesce((p->>'invite_months')::int, invite_months),
    invited_months = coalesce((p->>'invited_months')::int, invited_months),
    online_pay_on = coalesce((p->>'online_pay_on')::boolean, online_pay_on), delivery_on = coalesce((p->>'delivery_on')::boolean, delivery_on),
    delivery_margin = coalesce((p->>'delivery_margin')::int, delivery_margin), paystack_fee_by = coalesce(p->>'paystack_fee_by', paystack_fee_by),
    online_service_fee = coalesce((p->>'online_service_fee')::int, online_service_fee),
    pay_gateways = coalesce((select array_agg(distinct g) from jsonb_array_elements_text(p->'pay_gateways') g), pay_gateways),
    free_orders = coalesce((p->>'free_orders')::int, free_orders),
    updated_at = now()
  where id = 1;
  if (select delivery_on and not online_pay_on from public.settings where id = 1) then
    raise exception 'ShopDesk Delivery is paid online, so Pay online has to be on while it''s on.'; end if;
  insert into public.audit_log (actor, action, detail) values (auth.uid(), 'settings', left(p::text, 300));
end $$;

-- Admin > Payments & delivery.
create or replace function public.admin_money() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object(
    'settings', (select jsonb_build_object('online_pay_on', online_pay_on, 'delivery_on', delivery_on, 'delivery_margin', delivery_margin,
      'paystack_fee_by', paystack_fee_by, 'online_service_fee', online_service_fee, 'pay_gateways', pay_gateways) from public.settings where id = 1),
    'online', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0), 'delivery', coalesce(sum(delivery_part), 0), 'fees', coalesce(sum(fee), 0), 'service', coalesce(sum(service), 0),
        'by_gateway', coalesce((select jsonb_object_agg(provider, n) from (select provider, count(*) n from public.online_payments where status = 'paid' group by provider) g), '{}'::jsonb))
      from public.online_payments where status = 'paid'),
    'shipments', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select sh.order_id, sh.created_at, sh.courier, sh.status, sh.cost, sh.price, sh.tracking_url,
        s.name as shop, s.id as shop_id, public.order_code(s.order_prefix, sh.order_id) as code
      from public.shipments sh join public.shops s on s.id = sh.shop_id order by sh.created_at desc limit 200) x), '[]'::jsonb));
end $$;
