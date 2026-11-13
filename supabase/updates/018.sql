-- 018: bringing shops back. Every hour the database sends a shop a nudge (phone alert, and the email backup if it doesn't open
-- ShopDesk) when orders are waiting for it, when it has nothing for sale a day after approval, or when it has gone quiet for
-- 5 days. Each kind is spaced out and limited, so nobody is spammed. Needs Admin > Needs attention lists shops that haven't
-- opened ShopDesk in a week, with a WhatsApp button. Run after 017. Safe to run more than once.

-- Nudges: alerts (phone and email) that bring a shop back when orders are waiting, it has no products yet, or it has gone quiet.
-- One row per nudge sent, so each kind goes out at most so often.
create table if not exists public.shop_nudges (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  kind text not null check (kind in ('orders_waiting', 'no_products', 'quiet')),
  sent_at timestamptz not null default now()
);
create index if not exists shop_nudges_shop on public.shop_nudges (shop_id, kind, sent_at desc);
alter table public.shop_nudges enable row level security;
revoke all on public.shop_nudges from anon, authenticated;

-- Sends the nudges that are due (the database runs it every hour). p_hour stands in for the Lagos hour, for tests.
--   orders_waiting: new orders not confirmed, or customers who say they paid, waiting over 3 hours while the shop hasn't
--                   opened ShopDesk; at most once every 20 hours, from 7am to 9pm
--   no_products:    approved over a day ago with nothing for sale; up to 3 times, 2 days apart, from 9am to 8pm
--   quiet:          has products but hasn't opened ShopDesk in 5 days; once a week, up to 4 times until it comes back,
--                   from 9am to 8pm
create or replace function public.nudge_shops(p_hour int default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; h int := coalesce(p_hour, extract(hour from now() at time zone 'Africa/Lagos')::int);
begin
  perform set_config('shopdesk.system', 'on', true);
  if h between 7 and 21 then
    for r in
      select s.id, s.owner_id, count(*)::int as c from public.shops s join public.orders o on o.shop_id = s.id
      where s.status = 'active' and o.status = 'awaiting' and (o.confirmed_at is null or o.customer_says_paid)
        and o.created_at < now() - interval '3 hours' and s.last_active_at < now() - interval '3 hours'
        and not exists (select 1 from public.shop_nudges sn where sn.shop_id = s.id and sn.kind = 'orders_waiting' and sn.sent_at > now() - interval '20 hours')
      group by s.id, s.owner_id
    loop
      perform public.notify(r.owner_id, null, 'nudge',
        case when r.c = 1 then '1 order is waiting for you' else r.c || ' orders are waiting for you' end,
        'Confirm them and check payments, so your customers can get their things. Unpaid orders cancel after 48 hours.', '/#orders');
      insert into public.shop_nudges (shop_id, kind) values (r.id, 'orders_waiting');
      n := n + 1;
    end loop;
  end if;
  if h between 9 and 20 then
    for r in
      select s.id, s.owner_id from public.shops s
      where s.status = 'active' and coalesce(s.reviewed_at, s.created_at) < now() - interval '1 day'
        and not exists (select 1 from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin)
        and (select count(*) from public.shop_nudges sn where sn.shop_id = s.id and sn.kind = 'no_products') < 3
        and not exists (select 1 from public.shop_nudges sn where sn.shop_id = s.id and sn.kind = 'no_products' and sn.sent_at > now() - interval '2 days')
    loop
      perform public.notify(r.owner_id, null, 'nudge', 'Add your first product',
        'Your shop is open, but customers can''t order until it has something to sell. A photo, a name and a price is all it takes.', '/#stock');
      insert into public.shop_nudges (shop_id, kind) values (r.id, 'no_products');
      n := n + 1;
    end loop;
    for r in
      select s.id, s.owner_id, s.slug,
        (select count(distinct coalesce(o.customer_id::text, o.customer_phone)) from public.orders o where o.shop_id = s.id and o.status in ('paid', 'out', 'delivered'))::int as buyers
      from public.shops s
      where s.status = 'active' and s.last_active_at < now() - interval '5 days'
        and exists (select 1 from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin)
        and (select count(*) from public.shop_nudges sn where sn.shop_id = s.id and sn.kind = 'quiet' and sn.sent_at > s.last_active_at) < 4
        and not exists (select 1 from public.shop_nudges sn where sn.shop_id = s.id and sn.kind = 'quiet' and sn.sent_at > now() - interval '7 days')
    loop
      perform public.notify(r.owner_id, null, 'nudge',
        case when r.buyers > 0 then 'Your customers are waiting' else 'Share your shop today' end,
        case when r.buyers > 0 then r.buyers || case when r.buyers = 1 then ' person has' else ' people have' end || ' bought from you on ShopDesk. Add something new and post your link on your status.'
          else 'Post shopdesk.com.ng/' || r.slug || ' on your WhatsApp status. Customers order straight from it.' end,
        '/#shop');
      insert into public.shop_nudges (shop_id, kind) values (r.id, 'quiet');
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke all on function public.nudge_shops(int) from public, anon, authenticated;

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

-- Nudges every hour (nudge_shops decides what is due), then the push sender sends them straight away. Needs pg_cron and pg_net.
do $nudge$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'shopdesk-nudge';
    perform cron.schedule('shopdesk-nudge', '7 * * * *',
      $job$select public.nudge_shops(); select net.http_post(url := 'https://buvzjgzoctmpgthelddr.supabase.co/functions/v1/push', body := '{"action":"flush"}'::jsonb)$job$);
  end if;
end $nudge$;
