-- 017: free plan. A shop whose plan has run out (or whose free trial ended) keeps taking orders for free, up to a number of
-- orders a month you set in Admin > Plans & payments (30 to start). Past that, it pays the monthly price; it has the grace
-- days to pay, then its page closes until you record a payment or the month ends (its free orders come back on the 1st).
-- Cancelled orders don't count. Set it to 0 to go back to every shop paying after its trial.
-- Run after 016. Safe to run more than once.

alter table public.settings add column if not exists free_orders integer not null default 30 check (free_orders between 0 and 10000);

create or replace function public.shop_month(p_shop uuid) returns table (orders int, passed_at timestamptz)
language sql stable security definer set search_path = public as $$
  with m as (
    select o.created_at from public.orders o
    where o.shop_id = p_shop and o.status <> 'cancelled'
      and o.created_at >= (date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'))
  select (select count(*)::int from m),
    (select created_at from m order by created_at offset (select free_orders from public.settings where id = 1) limit 1);
$$;

create or replace function public.shop_open(s public.shops) returns boolean
language sql stable security definer set search_path = public as $$
  select s.status = 'active' and coalesce((select not st.close_unpaid or st.monthly_price = 0 or s.paid_until is null
      or s.paid_until + make_interval(days => st.grace_days) > now()
      or (st.free_orders > 0 and (m.orders <= st.free_orders or m.passed_at + make_interval(days => st.grace_days) > now()))
    from public.settings st cross join public.shop_month(s.id) m where st.id = 1), true);
$$;

create or replace function public.admin_attention() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare st public.settings;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  select * into st from public.settings where id = 1;
  return coalesce((select jsonb_agg(x order by (x->>'level')::int, x->>'since') from (
    select jsonb_build_object('kind', 'says_paid', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(o.customer_says_paid_at),
      'text', count(*) || case when count(*) = 1 then ' order: the customer says they paid' else ' orders: customers say they paid' end || ', and the shop hasn''t confirmed it for over a day') as x
    from public.orders o join public.shops s on s.id = o.shop_id
    where o.customer_says_paid and o.status in ('awaiting', 'part') and o.customer_says_paid_at < now() - interval '1 day' group by s.id
    union all
    select jsonb_build_object('kind', 'not_sent', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(o.paid_at),
      'text', count(*) || case when count(*) = 1 then ' paid order hasn''t' else ' paid orders haven''t' end || ' been sent after 3 days')
    from public.orders o join public.shops s on s.id = o.shop_id where o.status = 'paid' and o.paid_at < now() - interval '3 days' group by s.id
    union all
    select jsonb_build_object('kind', 'not_delivered', 'level', 2, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(o.paid_at),
      'text', count(*) || case when count(*) = 1 then ' order is' else ' orders are' end || ' marked on its way but not delivered a week after payment')
    from public.orders o join public.shops s on s.id = o.shop_id where o.status = 'out' and o.paid_at < now() - interval '7 days' group by s.id
    union all
    select jsonb_build_object('kind', 'late', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(o.deliver_by),
      'text', count(*) || case when count(*) = 1 then ' order is' else ' orders are' end || ' past the delivery time the shop promised')
    from public.orders o join public.shops s on s.id = o.shop_id where o.status = 'out' and o.deliver_by < now() - interval '2 hours' group by s.id
    union all
    select jsonb_build_object('kind', 'bank_changed', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', s.details_changed_at,
      'text', 'Bank details changed after approval. Check the new account name fits the business.')
    from public.shops s where s.details_changed_at > now() - interval '14 days'
    union all
    select jsonb_build_object('kind', 'reports', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(r.created_at),
      'text', count(*) || case when count(*) = 1 then ' open report from a customer' else ' open reports from customers' end)
    from public.reports r join public.shops s on s.id = r.shop_id where r.resolved_at is null group by s.id
    union all
    select jsonb_build_object('kind', 'cancellations', 'level', 2, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(o.created_at),
      'text', count(*) || ' cancelled orders in the last 30 days')
    from public.orders o join public.shops s on s.id = o.shop_id where o.status = 'cancelled' and o.created_at > now() - interval '30 days' group by s.id having count(*) >= 5
    union all
    select jsonb_build_object('kind', 'plan', 'level', 2, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp,
      'since', case when st.free_orders > 0 then m.passed_at else s.paid_until end,
      'text', case when st.free_orders > 0 then
          case when public.shop_open(s) then 'Passed the ' || st.free_orders || ' free orders this month. The shop closes on ' || to_char(m.passed_at + make_interval(days => st.grace_days), 'Dy DD Mon') || ' unless they pay'
            else 'Passed the ' || st.free_orders || ' free orders this month and closed for not paying' end
        when public.shop_open(s) then 'Plan ran out. The shop closes on ' || to_char(s.paid_until + make_interval(days => st.grace_days), 'Dy DD Mon') || ' unless they pay'
        else 'Closed for not paying since ' || to_char(s.paid_until + make_interval(days => st.grace_days), 'Dy DD Mon') end)
    from public.shops s cross join public.shop_month(s.id) m
    where st.close_unpaid and st.monthly_price > 0 and s.status = 'active' and s.paid_until < now() and (st.free_orders = 0 or m.orders > st.free_orders)
    union all
    select jsonb_build_object('kind', 'waiting', 'level', 2, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', s.created_at,
      'text', 'Waiting for approval for ' || extract(day from now() - s.created_at)::int || ' days')
    from public.shops s where s.status = 'pending' and s.created_at < now() - interval '2 days'
    union all
    select jsonb_build_object('kind', 'problems', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(p.created_at),
      'text', count(*) || case when count(*) = 1 then ' problem is' else ' problems are' end || ' waiting for your decision (see Problems)')
    from public.problems p join public.shops s on s.id = p.shop_id where public.problem_status(p) = 'with_shopdesk' group by s.id
    union all
    select jsonb_build_object('kind', 'upheld', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(p.decided_at),
      'text', count(*) || ' complaints decided against this shop in the last 30 days. Think about suspending it.')
    from public.problems p join public.shops s on s.id = p.shop_id where p.decision = 'customer' and p.decided_at > now() - interval '30 days' group by s.id having count(*) >= 3
    union all
    select jsonb_build_object('kind', 'refund_overdue', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(p.owed_by),
      'text', 'Owes ' || public.naira(sum(p.owed_amount)::int) || ' in refunds past the deadline. Its page is paused.')
    from public.problems p join public.shops s on s.id = p.shop_id where p.owed_amount is not null and p.owed_paid_at is null and p.owed_by < now() group by s.id
    union all
    select jsonb_build_object('kind', 'refund_disputed', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(p.owed_disputed_at),
      'text', count(*) || case when count(*) = 1 then ' customer says' else ' customers say' end || ' a refund didn''t arrive. Check the receipt in Problems.')
    from public.problems p join public.shops s on s.id = p.shop_id where p.owed_disputed_at is not null and p.owed_paid_at is null group by s.id
    union all
    select jsonb_build_object('kind', 'other_account', 'level', 1, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(m.created_at),
      'text', 'Sent a different account number to ' || count(distinct m.order_id) || case when count(distinct m.order_id) = 1 then ' customer' else ' customers' end || ' in chat. Possible scam.')
    from public.messages m join public.shops s on s.id = m.shop_id where m.flag = 'other_account' and m.created_at > now() - interval '30 days' group by s.id
    union all
    select jsonb_build_object('kind', 'chat_reports', 'level', 2, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', min(r.created_at),
      'text', count(*) || ' messages from this shop reported in 30 days')
    from public.reports r join public.shops s on s.id = r.shop_id where r.message_id is not null and r.about = 'shop' and r.created_at > now() - interval '30 days'
    group by s.id having count(*) >= 2
  ) t), '[]'::jsonb);
end $$;

create or replace function public.admin_billing() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(st) - 'id' from public.settings st where id = 1),
    'shops', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'status', s.status, 'whatsapp', s.whatsapp, 'paid_until', s.paid_until, 'open', public.shop_open(s),
        'month_orders', (select orders from public.shop_month(s.id)), 'passed_at', (select passed_at from public.shop_month(s.id)),
        'last_paid', (select max(created_at) from public.plan_payments pp where pp.shop_id = s.id), 'paid_total', (select coalesce(sum(amount), 0) from public.plan_payments pp where pp.shop_id = s.id))
        order by s.paid_until nulls last), '[]'::jsonb) from public.shops s where s.status in ('active', 'suspended')),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('shop', s.name, 'amount', pp.amount, 'months', pp.months, 'note', pp.note, 'paid_until', pp.paid_until, 'created_at', pp.created_at)
        order by pp.created_at desc), '[]'::jsonb) from (select * from public.plan_payments order by created_at desc limit 50) pp join public.shops s on s.id = pp.shop_id),
    'months', (select jsonb_agg(jsonb_build_object('month', m::date, 'income', (select coalesce(sum(amount), 0) from public.plan_payments pp where pp.created_at >= m and pp.created_at < m + interval '1 month')) order by m)
      from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m));
end $$;

create or replace function public.my_plan() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('paid_until', s.paid_until, 'open', public.shop_open(s), 'monthly_price', st.monthly_price, 'grace_days', st.grace_days, 'close_unpaid', st.close_unpaid,
    'free_orders', st.free_orders, 'month_orders', (select orders from public.shop_month(s.id)), 'passed_at', (select passed_at from public.shop_month(s.id)),
    'pay_bank', st.pay_bank, 'pay_account_number', st.pay_account_number, 'pay_account_name', st.pay_account_name, 'admin_whatsapp', st.admin_whatsapp)
  from public.shops s cross join public.settings st where s.owner_id = auth.uid() and st.id = 1;
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
    free_orders = coalesce((p->>'free_orders')::int, free_orders),
    updated_at = now()
  where id = 1;
  if (select delivery_on and not online_pay_on from public.settings where id = 1) then
    raise exception 'ShopDesk Delivery is paid online, so Pay online has to be on while it''s on.'; end if;
  insert into public.audit_log (actor, action, detail) values (auth.uid(), 'settings', left(p::text, 300));
end $$;

revoke all on function public.shop_month(uuid) from public, anon, authenticated;
