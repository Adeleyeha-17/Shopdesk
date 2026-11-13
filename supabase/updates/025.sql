-- 025: ShopDesk decides problems within 48 hours (both sides see when), writes in the order's chat while it decides
-- (both see it as "ShopDesk", and the decision lands there too), and Admin can find any customer to block them.
-- Run after 024. Safe to run more than once.

alter table public.messages drop constraint if exists messages_sender_check;
alter table public.messages add constraint messages_sender_check check (sender in ('shop', 'customer', 'shopdesk'));

-- ShopDesk decides within 48 hours of a problem coming to it (the customer asking, or the shop not answering in 48 hours).
create or replace function public.problem_decide_by(p public.problems) returns timestamptz
language sql immutable as $$
  select coalesce(p.escalated_at, p.created_at + interval '48 hours') + interval '48 hours';
$$;

revoke execute on function public.problem_decide_by(public.problems) from public, anon, authenticated;


create or replace function public.get_order_public(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('order_id', o.id, 'status', o.status, 'mode', o.mode, 'items_total', o.items_total, 'delivery_fee', o.delivery_fee,
    'delivery_paid_by', o.delivery_paid_by, 'amount_paid', o.amount_paid, 'customer_says_paid', o.customer_says_paid,
    'created_at', o.created_at, 'confirmed_at', o.confirmed_at, 'paid_at', o.paid_at, 'out_at', o.out_at, 'deliver_by', o.deliver_by,
    'received_at', o.received_at, 'received_by', o.received_by, 'done_at', o.done_at,
    'rider_name', case when o.status = 'out' or (o.status = 'delivered' and o.done_at > now() - interval '2 days') then o.rider_name end,
    'rider_phone', case when o.status = 'out' or (o.status = 'delivered' and o.done_at > now() - interval '2 days') then o.rider_phone end,
    'saved', o.customer_id is not null, 'mine', o.customer_id is not null and o.customer_id = auth.uid(),
    'to_pay', o.items_total + case when o.delivery_paid_by = 'customer' then coalesce(o.delivery_fee, 0) else 0 end,
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'price', i.price, 'qty', i.qty) order by i.id) from public.order_items i where i.order_id = o.id),
    'shop', jsonb_build_object('name', s.name, 'slug', s.slug, 'bank', s.bank, 'account_number', s.account_number, 'account_name', s.account_name),
    'code', public.order_code(s.order_prefix, o.id),
    'report_until', case when o.status = 'delivered' then o.done_at + interval '3 days' end,
    'can_report', coalesce(o.customer_id = auth.uid(), false) and public.can_report(o),
    'has_problem', exists (select 1 from public.problems p where p.order_id = o.id),
    'can_chat', coalesce(o.customer_id = auth.uid(), false) and public.can_chat(o),
    'report_block', case when o.customer_id = auth.uid() then public.report_block(auth.uid()) end,
    'pay_by', case when o.status = 'awaiting' and o.amount_paid = 0 and not o.customer_says_paid then o.created_at + interval '48 hours' end,
    'can_cancel', coalesce(o.customer_id = auth.uid(), false) and o.status = 'awaiting' and o.amount_paid = 0 and not o.customer_says_paid,
    'cancel_reason', o.cancel_reason, 'cancel_note', o.cancel_note,
    -- the problem itself, only for the customer who placed the order
    'problem', case when o.customer_id is not null and o.customer_id = auth.uid() then (select jsonb_build_object(
        'kind', p.kind, 'details', p.details, 'photos', to_jsonb(p.photos), 'status', public.problem_status(p),
        'escalated_by', coalesce(p.escalated_by, case when public.problem_status(p) = 'with_shopdesk' and p.status = 'open' then 'no_reply' end),
        'reply', p.reply, 'reply_note', p.reply_note, 'reply_photos', to_jsonb(p.reply_photos), 'refund_amount', p.refund_amount,
        'refund_received_at', p.refund_received_at, 'created_at', p.created_at, 'reply_by', p.created_at + interval '48 hours', 'answered_at', p.answered_at,
        'decision', p.decision, 'decision_note', p.decision_note, 'decided_at', p.decided_at, 'decide_by', public.problem_decide_by(p),
        'owed_amount', p.owed_amount, 'owed_by', p.owed_by, 'owed_sent_at', p.owed_sent_at, 'owed_paid_at', p.owed_paid_at,
        'owed_receipt', p.owed_receipt, 'owed_disputed_at', p.owed_disputed_at, 'owed_cleared_by', p.owed_cleared_by)
      from public.problems p where p.order_id = o.id) end)
  from public.orders o join public.shops s on s.id = o.shop_id where o.public_token = p_token;
$$;

create or replace function public.admin_problems() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'rank')::int, x->>'created_at') from (
    select jsonb_build_object('id', p.id, 'rank', case e.st when 'with_shopdesk' then 0 when 'open' then 1 when 'answered' then 2 else 3 end,
      'status', e.st, 'escalated_by', coalesce(p.escalated_by, case when e.st = 'with_shopdesk' and p.status = 'open' then 'no_reply' end),
      'kind', p.kind, 'details', p.details, 'photos', to_jsonb(p.photos), 'reply', p.reply, 'reply_note', p.reply_note, 'reply_photos', to_jsonb(p.reply_photos),
      'refund_amount', p.refund_amount, 'refund_received_at', p.refund_received_at, 'created_at', p.created_at, 'reply_by', p.created_at + interval '48 hours',
      'answered_at', p.answered_at, 'escalated_at', p.escalated_at, 'decide_by', public.problem_decide_by(p), 'decision', p.decision, 'decision_note', p.decision_note, 'decided_at', p.decided_at, 'closed_at', p.closed_at,
      'owed_amount', p.owed_amount, 'owed_by', p.owed_by, 'owed_sent_at', p.owed_sent_at, 'owed_paid_at', p.owed_paid_at, 'owed_cleared_by', p.owed_cleared_by,
      'owed_receipt', p.owed_receipt, 'owed_disputed_at', p.owed_disputed_at,
      'order', public.admin_order_json(o.id),
      'shop', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'whatsapp', s.whatsapp, 'status', s.status,
        'upheld_30d', (select count(*) from public.problems q where q.shop_id = s.id and q.decision = 'customer' and q.decided_at > now() - interval '30 days')),
      'customer', jsonb_build_object('name', o.customer_name,
        'email', case when e.st in ('with_shopdesk', 'decided') then u.email end, 'phone', case when e.st in ('with_shopdesk', 'decided') then o.customer_phone end,
        'id', p.customer_id, 'blocked', public.is_blocked(p.customer_id),
        'rejected_90d', (select count(*) from public.problems q where q.customer_id = p.customer_id and q.decision = 'shop' and q.decided_at > now() - interval '90 days'))) as x
    from public.problems p join public.orders o on o.id = p.order_id join public.shops s on s.id = p.shop_id
      left join auth.users u on u.id = p.customer_id cross join lateral (select public.problem_status(p) as st) e
    where p.closed_at is null or p.closed_at > now() - interval '30 days' or (p.owed_amount is not null and p.owed_paid_at is null)
  ) t), '[]'::jsonb);
end $$;

create or replace function public.report_message(p_message bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.messages; v public.orders; s public.shops; who text;
begin
  select * into m from public.messages where id = p_message;
  if not found then raise exception 'Message not found.'; end if;
  select * into v from public.orders where id = m.order_id;
  select * into s from public.shops where id = m.shop_id;
  if s.owner_id = auth.uid() then who := 'shop';
  elsif v.customer_id is not null and v.customer_id = auth.uid() then who := 'customer';
  else raise exception 'Message not found.'; end if;
  if m.sender = who then raise exception 'You can''t report your own message.'; end if;
  if m.sender = 'shopdesk' then raise exception 'That message is from ShopDesk.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Say what''s wrong with it.'; end if;
  if exists (select 1 from public.reports where message_id = m.id and reporter_id = auth.uid()) then raise exception 'You''ve already reported this message.'; end if;
  if (select count(*) from public.reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve sent a lot of reports today. Try again tomorrow.'; end if;
  insert into public.reports (shop_id, reason, order_id, reporter_id, message_id, about)
  values (s.id, left(trim(p_reason), 500), v.id, auth.uid(), m.id, case when m.sender = 'shop' then 'shop' else 'customer' end);
  perform public.notify_admins('report', 'Message reported · ' || s.name, left(trim(p_reason), 200), '/admin#reports');
end $$;

create or replace function public.admin_decide_problem(p_problem bigint, p_decision text, p_note text, p_owed int default null) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.problems; v public.orders; s public.shops; c text; cap int; due timestamptz := now() + interval '48 hours';
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  select * into pr from public.problems where id = p_problem for update;
  if not found then raise exception 'Problem not found.'; end if;
  if pr.status in ('sorted', 'decided') then raise exception 'This problem is already closed.'; end if;
  if p_decision is null or p_decision not in ('customer', 'shop') then raise exception 'Choose who was right.'; end if;
  if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Write your decision.'; end if;
  select * into v from public.orders where id = pr.order_id;
  select * into s from public.shops where id = pr.shop_id;
  cap := greatest(v.amount_paid, v.items_total + case when v.delivery_paid_by = 'customer' then coalesce(v.delivery_fee, 0) else 0 end);
  if p_owed is not null and (p_decision <> 'customer' or p_owed < 1 or p_owed > cap) then
    raise exception 'The refund must be between ₦1 and %.', public.naira(cap); end if;
  update public.problems set status = 'decided', decision = p_decision, decision_note = left(trim(p_note), 600), decided_at = now(), closed_at = now(),
    escalated_at = coalesce(escalated_at, now()), owed_amount = p_owed, owed_by = case when p_owed is not null then due end where id = pr.id;
  c := public.order_code(s.order_prefix, pr.order_id);
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'problem_decided', pr.shop_id,
    left('Order ' || c || ': ' || case when p_decision = 'customer' then 'the customer was right. ' else 'the shop was right. ' end
      || case when p_owed is not null then 'Refund ' || public.naira(p_owed) || '. ' else '' end || trim(p_note), 300));
  insert into public.messages (order_id, shop_id, customer_id, sender, body) values (v.id, v.shop_id, v.customer_id, 'shopdesk', left(
    'ShopDesk decided: ' || case when p_decision = 'shop' then 'the shop was right.'
      else 'the customer was right.' || case when p_owed is not null then ' ' || s.name || ' refunds ' || public.naira(p_owed) || ' by ' || public.lagos_time(due) || '.' else '' end end
    || E'\n' || trim(p_note), 1000));
  perform public.notify(v.customer_id, v.id, 'decided', 'ShopDesk decided · ' || c,
    case when p_decision = 'shop' then 'The shop was right.'
         when p_owed is not null then 'You were right. ' || s.name || ' must refund ' || public.naira(p_owed) || ' by ' || public.lagos_time(due) || '.'
         else 'You were right.' end, '/o/' || v.public_token);
  perform public.notify(s.owner_id, v.id, 'decided', 'ShopDesk decided · ' || c,
    case when p_decision = 'shop' then 'You were right.'
         when p_owed is not null then 'Refund ' || public.naira(p_owed) || ' by ' || public.lagos_time(due) || ' or your page pauses.'
         else 'The customer was right.' end, '/?order=' || v.id || '#orders');
end $$;

create or replace function public.admin_case_message(p_problem bigint, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr public.problems; v public.orders; s public.shops; m public.messages; b text := left(trim(coalesce(p_body, '')), 1000); c text;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  select * into pr from public.problems where id = p_problem;
  if not found then raise exception 'Problem not found.'; end if;
  if public.problem_status(pr) <> 'with_shopdesk' then raise exception 'You can write in the chat only while the problem is with you.'; end if;
  if b = '' then raise exception 'Write a message.'; end if;
  select * into v from public.orders where id = pr.order_id;
  select * into s from public.shops where id = v.shop_id;
  insert into public.messages (order_id, shop_id, customer_id, sender, body) values (v.id, v.shop_id, v.customer_id, 'shopdesk', b) returning * into m;
  c := public.order_code(s.order_prefix, v.id);
  perform public.notify(v.customer_id, v.id, 'message', 'ShopDesk · ' || c, b, '/o/' || v.public_token || '#chat');
  perform public.notify(s.owner_id, v.id, 'message', 'ShopDesk · ' || c, b, '/?chat=' || v.id || '#orders');
  return jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'photo', m.photo, 'flag', m.flag, 'created_at', m.created_at);
end $$;

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
        'blocked', public.is_blocked(u.id), 'block_reason', (select b.reason from public.blocked_users b where b.user_id = u.id)) x
    from auth.users u left join public.customers c on c.user_id = u.id
    where not public.has_shop(u.id) and not exists (select 1 from public.admins a where a.user_id = u.id)
      and (lower(coalesce(u.email, '')) like '%' || q || '%' or lower(coalesce(c.name, '')) like '%' || q || '%'
        or (char_length(d) >= 4 and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || d || '%')
        or exists (select 1 from public.orders o where o.customer_id = u.id
                   and (lower(o.customer_name) like '%' || q || '%' or (char_length(d) >= 4 and regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g') like '%' || d || '%'))))
    limit 30) z), '[]'::jsonb);
end $$;

revoke all on function public.admin_case_message(bigint, text), public.admin_find_customers(text) from public, anon;
grant execute on function public.admin_case_message(bigint, text), public.admin_find_customers(text) to authenticated;

