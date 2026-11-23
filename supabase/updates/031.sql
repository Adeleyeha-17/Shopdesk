-- 031: test shops for paying online. In Admin, a shop can be marked as a test shop: paying online works for it even
-- while Pay online is off for everyone, and it stays out of Shops near you. While the Paystack key is a test key, the money
-- function lets only test shops pay online, so a test payment can never mark a real shop's order as paid.
-- Safe to run more than once.
alter table public.shops add column if not exists pay_test boolean not null default false;

-- The customer starts paying online: records the attempt and returns what Paystack needs.
create or replace function public.money_start_payment(p_token uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders; s public.shops; st public.settings; v_due int; v_delivery int; v_fee int; v_service int;
begin
  select * into st from public.settings where id = 1;
  select * into v from public.orders where public_token = p_token for update;
  if not found then raise exception 'Order not found.'; end if;
  select * into s from public.shops where id = v.shop_id;
  if not (st.online_pay_on or s.pay_test) then raise exception 'Paying online isn''t on yet. Pay by transfer for now.'; end if;
  if v.customer_id is not null and v.customer_id is distinct from auth.uid() then raise exception 'Sign in with the account that placed this order.'; end if;
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
    'email', coalesce((select email from auth.users where id = v.customer_id), 'order' || v.id || '@shopdesk.com.ng'),
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'bank', s.bank, 'account_number', s.account_number,
      'subaccount', s.paystack_subaccount, 'subaccount_for', s.paystack_for, 'test', s.pay_test));
end $$;

-- The order page: can it be paid online (and the card fee the customer pays on top), and how its ShopDesk Delivery is going.
create or replace function public.order_money(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'online', (st.online_pay_on or s.pay_test) and s.status = 'active' and s.bank <> 'Other bank' and s.account_number ~ '^[0-9]{10}$'
      and o.status in ('awaiting', 'part') and not (o.mode = 'delivery' and o.delivery_paid_by = 'customer' and o.delivery_fee is null),
    'fee', case when st.paystack_fee_by = 'customer' then public.online_fee(st.online_service_fee +
      o.items_total + case when o.delivery_paid_by = 'customer' then coalesce(o.delivery_fee, 0) else 0 end - o.amount_paid) else 0 end,
    'service', st.online_service_fee,
    -- a ShopDesk Delivery order is paid online only; wait: the shop hasn't picked the courier yet
    'online_only', o.delivery_by = 'shopdesk',
    'wait', st.delivery_on and o.mode = 'delivery' and o.delivery_by <> 'shopdesk' and o.confirmed_at is null and o.status = 'awaiting',
    'delivery_by', o.delivery_by,
    'courier', o.delivery_quote->>'name',
    'shipment', (select jsonb_build_object('courier', sh.courier, 'status', sh.status, 'tracking_url', sh.tracking_url, 'tracking_code', sh.tracking_code,
        'steps', sh.steps, 'rider', sh.rider) from public.shipments sh where sh.order_id = o.id))
  from public.orders o join public.shops s on s.id = o.shop_id cross join public.settings st where o.public_token = p_token and st.id = 1;
$$;

-- Shops near you: every shop taking orders that has something to sell (test shops left out). The app sorts them by the customer's area.
create or replace function public.shops_near() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'slug', s.slug, 'sells', s.sells, 'location', s.location,
      'photo_path', (select p.photo_path from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin
        order by p.created_at desc limit 1)) || public.shop_rating(s.id) order by s.created_at), '[]'::jsonb)
  from public.shops s
  where public.shop_open(s) and not public.shop_owes(s.id) and not s.pay_test
    and exists (select 1 from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin);
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
      'last_active_at', s.last_active_at, 'paid_until', s.paid_until, 'details_changed_at', s.details_changed_at, 'pay_test', s.pay_test),
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

-- Admin marks a shop as a test shop for paying online, or takes the mark off. Logged.
create or replace function public.admin_set_pay_test(p_shop uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  update public.shops set pay_test = p_on where id = p_shop;
  if not found then raise exception 'Shop not found.'; end if;
  insert into public.audit_log (actor, action, shop_id, detail)
  values (auth.uid(), 'pay_test', p_shop, case when p_on then 'marked as a test shop for paying online' else 'no longer a test shop' end);
end $$;

revoke all on function public.admin_set_pay_test(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_pay_test(uuid, boolean) to authenticated;
