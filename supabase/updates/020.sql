-- 020: ShopDesk is free for shops. No monthly plan (shops never close for not paying) and no invite rewards. ShopDesk earns
-- from Pay online (its small fee) and ShopDesk Delivery instead. Past plan payments and invites stay in the database as
-- records. Run after 019. Safe to run more than once.

-- A shop takes orders once you've approved it. ShopDesk is free for shops: there's no plan to run out.
create or replace function public.shop_open(s public.shops) returns boolean
language sql stable security definer set search_path = public as $$
  select s.status = 'active';
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
    select jsonb_build_object('kind', 'quiet', 'level', 3, 'shop_id', s.id, 'shop', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'since', s.last_active_at,
      'text', 'Hasn''t opened ShopDesk in ' || extract(day from now() - s.last_active_at)::int || ' days'
        || case when not exists (select 1 from public.products p where p.shop_id = s.id and p.active) then ', and has no products' else '' end)
    from public.shops s where s.status = 'active' and s.last_active_at < now() - interval '7 days'
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

drop trigger if exists plan_payments_invite on public.plan_payments;
drop trigger if exists plan_payments_money_out on public.plan_payments;
drop function if exists public.money_out_from_plan();
drop function if exists public.invite_reward();
drop function if exists public.claim_invite(text);
drop function if exists public.my_invites();
drop function if exists public.admin_invites();
drop function if exists public.admin_billing();
drop function if exists public.admin_record_payment(uuid, int, int, text);
drop function if exists public.my_plan();
drop function if exists public.shop_month(uuid);
update public.settings set close_unpaid = false, invites_on = false where id = 1;
