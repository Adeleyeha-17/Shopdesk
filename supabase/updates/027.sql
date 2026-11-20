-- Update 027: product descriptions (optional, shown in the product's details on the shop page), receipts for paid orders,
-- and payment reminders: an unpaid order reminds the customer 3 hours after it was placed and 12 hours before it cancels.
-- Safe to run more than once.

alter table public.products add column if not exists description text not null default '' check (char_length(description) <= 300);
alter table public.orders add column if not exists reminders smallint not null default 0 check (reminders between 0 and 2);
alter table public.orders add column if not exists reminded_at timestamptz;

-- Adds a product, or changes one, in a single step: name, photo, price and sale price, when to warn, and its choices
-- (what they're called, and each one's name, price, sale price and stock). Prices can change any time; orders already
-- placed keep the prices they were placed at. p is
--   { name, description, photo_path, price, sale_price, stock, low_at, option_label, options: [{ id, name, price, sale_price, stock }] }
-- With choices, price, sale_price and stock come from them. A stock left out (null) stays as it is; anything new needs one.
-- A description left out stays as it is (an empty one removes it).
-- A choice left out of the list is removed (orders keep its name). Returns the product's id.
create or replace function public.save_product(p_product uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public.my_shop_id(); v public.products; v_opts jsonb := coalesce(nullif(p->'options', 'null'::jsonb), '[]'::jsonb); o jsonb;
  v_name text := trim(coalesce(p->>'name', '')); v_photo text := trim(coalesce(p->>'photo_path', ''));
  v_label text := trim(coalesce(p->>'option_label', '')); v_price int; v_sale int; v_stock int; v_low int; v_desc text;
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
  v_desc := case when p ? 'description' then trim(coalesce(p->>'description', '')) else coalesce(v.description, '') end;
  if char_length(v_desc) > 300 then raise exception 'Shorten the description to 300 letters or fewer.'; end if;
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
    insert into public.products (shop_id, name, description, price, sale_price, stock, low_at, photo_path, option_label)
    values (v_shop, v_name, v_desc, v_price, v_sale, v_stock, v_low, v_photo, v_label) returning * into v;
  else
    update public.products set name = v_name, description = v_desc, photo_path = v_photo, low_at = v_low, option_label = v_label, sale_price = v_sale,
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

-- ---------- customers: the order page ----------
create or replace function public.get_storefront(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shop', jsonb_build_object('name', s.name, 'slug', s.slug, 'bank', s.bank, 'account_number', s.account_number, 'account_name', s.account_name,
      'allow_part_payment', s.allow_part_payment, 'delivery_paid_by', s.delivery_paid_by) || public.shop_rating(s.id),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price, 'sale_price', p.sale_price, 'stock', p.stock,
        'photo_path', p.photo_path, 'option_label', p.option_label, 'description', p.description,
        'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price', o.price, 'sale_price', o.sale_price, 'stock', o.stock)
          order by o.sort_order, o.created_at) from public.product_options o where o.product_id = p.id), '[]'::jsonb)) order by p.created_at desc)
      from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin), '[]'::jsonb))
  from public.shops s where s.slug = lower(p_slug) and public.shop_open(s) and not public.shop_owes(s.id);
$$;

-- What a customer sees about their own order (needs the private token from place_order).
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
    'shop', jsonb_build_object('name', s.name, 'slug', s.slug, 'bank', s.bank, 'account_number', s.account_number, 'account_name', s.account_name, 'location', s.location),
    'code', public.order_code(s.order_prefix, o.id),
    -- the receipt, once the shop has the money: who it's for, how it was paid, and any refund the customer got back
    'receipt', case when o.status in ('paid', 'out', 'delivered') and o.amount_paid > 0 then jsonb_build_object('customer', o.customer_name,
        'online', exists (select 1 from public.payments pm where pm.order_id = o.id and pm.method = 'online'),
        'refund', (select jsonb_build_object('amount', coalesce(p.owed_amount, p.refund_amount), 'at', p.refund_received_at) from public.problems p
          where p.order_id = o.id and p.refund_received_at is not null and coalesce(p.owed_amount, p.refund_amount) > 0)) end,
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
        'description', p.description,
        'options', (select coalesce(jsonb_agg(jsonb_build_object('name', o.name, 'price', o.price, 'sale_price', o.sale_price, 'stock', o.stock) order by o.sort_order), '[]'::jsonb)
          from public.product_options o where o.product_id = p.id)) order by p.created_at desc), '[]'::jsonb) from public.products p where p.shop_id = s.id),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'contact', r.contact, 'created_at', r.created_at, 'resolved_at', r.resolved_at, 'resolved_note', r.resolved_note)
        order by r.created_at desc), '[]'::jsonb) from public.reports r where r.shop_id = s.id),
    'plan_payments', (select coalesce(jsonb_agg(jsonb_build_object('amount', pp.amount, 'months', pp.months, 'note', pp.note, 'paid_until', pp.paid_until, 'created_at', pp.created_at)
        order by pp.created_at desc), '[]'::jsonb) from public.plan_payments pp where pp.shop_id = s.id),
    'log', (select coalesce(jsonb_agg(jsonb_build_object('at', a.created_at, 'who', u.email, 'action', a.action, 'detail', a.detail) order by a.created_at desc), '[]'::jsonb)
      from (select * from public.audit_log where shop_id = s.id order by created_at desc limit 50) a left join auth.users u on u.id = a.actor));
end $$;

-- Reminds customers to pay (the database runs it every hour, with the shop nudges). An unpaid order the customer can pay
-- right now (its delivery fee is set, and it isn't waiting for the shop to pick a courier) gets two reminders, from 7am to
-- 9pm Lagos time: 3 hours after it was placed, and 36 hours after (unpaid orders cancel at 48 hours). A reminder that falls
-- at night goes in the morning; if the second is already due by then, only the second goes. Nothing once the customer says
-- they've paid, the shop has the money, the order is cancelled or the shop isn't open. p_hour stands in for the Lagos hour, for tests.
create or replace function public.remind_buyers(p_hour int default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; h int := coalesce(p_hour, extract(hour from now() at time zone 'Africa/Lagos')::int); v_end timestamp; v_last boolean;
begin
  if h not between 7 and 20 then return 0; end if;
  perform set_config('shopdesk.system', 'on', true);
  for r in
    select o.id, o.customer_id, o.public_token, o.created_at, s.name, public.order_code(s.order_prefix, o.id) as code,
      o.items_total + case when o.delivery_paid_by = 'customer' then coalesce(o.delivery_fee, 0) else 0 end as due
    from public.orders o join public.shops s on s.id = o.shop_id cross join public.settings st
    where st.id = 1 and o.status = 'awaiting' and o.amount_paid = 0 and not o.customer_says_paid and o.customer_id is not null
      and s.status = 'active' and o.created_at between now() - interval '48 hours' and now() - interval '3 hours'
      and not (o.mode = 'delivery' and o.delivery_paid_by = 'customer' and o.delivery_fee is null)
      and not (st.delivery_on and o.mode = 'delivery' and o.delivery_by <> 'shopdesk' and o.confirmed_at is null)
      and (o.reminders = 0 or (o.reminders = 1 and o.created_at < now() - interval '36 hours'))
    order by o.id
  loop
    v_last := r.created_at < now() - interval '36 hours';
    v_end := (r.created_at + interval '48 hours') at time zone 'Africa/Lagos';
    perform public.notify(r.customer_id, r.id, 'pay_reminder', r.name,
      case when v_last then r.code || ' cancels at ' || lower(to_char(v_end, 'FMHH12:MIAM'))
          || case when v_end::date = (now() at time zone 'Africa/Lagos')::date then ' today' else ' tomorrow' end
          || ' if it isn''t paid. Pay ' || public.naira(r.due) || ' to keep it.'
        else r.code || ' is waiting for ' || public.naira(r.due) || '. Pay to keep your order.' end,
      '/o/' || r.public_token);
    update public.orders set reminders = case when v_last then 2 else 1 end, reminded_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.remind_buyers(int) from public, anon, authenticated;

-- Nudges and payment reminders every hour (nudge_shops and remind_buyers decide what is due), then the push sender sends
-- them straight away. Needs pg_cron and pg_net.
do $nudge$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'shopdesk-nudge';
    perform cron.schedule('shopdesk-nudge', '7 * * * *',
      $job$select public.nudge_shops(); select public.remind_buyers(); select net.http_post(url := 'https://buvzjgzoctmpgthelddr.supabase.co/functions/v1/push', body := '{"action":"flush"}'::jsonb)$job$);
  end if;
end $nudge$;
