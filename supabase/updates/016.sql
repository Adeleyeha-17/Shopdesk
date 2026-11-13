-- 016: Pay online (Paystack) and ShopDesk Delivery (Shipbubble). Both are off until you switch them on in Admin > Payments & delivery.
--   * Pay online: the customer pays once through Paystack. The goods money goes to the shop's bank (a Paystack subaccount made
--     from the bank details the shop already gave); the ShopDesk Delivery fee comes to ShopDesk. ShopDesk never holds the shop's money.
--     Paystack's fee and a small ShopDesk fee are added on top for the customer who chooses to pay online, so the shop gets the
--     full amount. Paying the shop by transfer stays free.
--   * ShopDesk Delivery: the shop gets courier prices on a new order, picks one, and books the pickup once it's paid and packed.
--     ShopDesk pays the courier from its own courier wallet; the customer and the shop follow the delivery on the order.
--     While it's on, every new delivery order goes with ShopDesk Delivery and is paid online: no own riders, and no "Money in"
--     or transfer for those orders. Pick-up orders can still be paid to the shop by transfer.
--   * The money server function ("money") talks to Paystack and Shipbubble with keys kept only in Supabase, and calls these functions.
-- Safe to run more than once.

alter table public.settings add column if not exists online_pay_on boolean not null default false;
alter table public.settings add column if not exists delivery_on boolean not null default false;
alter table public.settings add column if not exists delivery_margin integer not null default 0 check (delivery_margin between 0 and 20000);
-- who pays Paystack's fee: the customer (added on top when they choose to pay online, so the shop gets the full amount),
-- the shop (taken from its share), or ShopDesk (when the delivery fee is in the payment)
alter table public.settings add column if not exists paystack_fee_by text not null default 'customer';
alter table public.settings drop constraint if exists settings_paystack_fee_by_check;
alter table public.settings add constraint settings_paystack_fee_by_check check (paystack_fee_by in ('customer', 'shop', 'shopdesk'));
alter table public.settings alter column paystack_fee_by set default 'customer';
-- ShopDesk's own fee on each online payment (naira), paid by the customer on top, like the card fee
alter table public.settings add column if not exists online_service_fee integer not null default 50 check (online_service_fee between 0 and 1000);

alter table public.shops add column if not exists pickup_address text not null default '' check (char_length(pickup_address) <= 200);
alter table public.shops add column if not exists pickup_code bigint;
alter table public.shops add column if not exists paystack_subaccount text;
alter table public.shops add column if not exists paystack_for text;
grant update (pickup_address) on public.shops to authenticated;

-- a new pickup address has to be checked by the courier service again
create or replace function public.shops_pickup_reset() returns trigger
language plpgsql as $$
begin
  if new.pickup_address is distinct from old.pickup_address then new.pickup_code := null; end if;
  return new;
end $$;
drop trigger if exists shops_pickup_reset on public.shops;
create trigger shops_pickup_reset before update on public.shops for each row execute function public.shops_pickup_reset();

alter table public.orders add column if not exists delivery_by text not null default 'shop' check (delivery_by in ('shop', 'shopdesk'));
alter table public.orders add column if not exists delivery_quotes jsonb;
alter table public.orders add column if not exists delivery_quote jsonb;

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (method in ('tap', 'alert', 'notification', 'online'));

-- Each time a customer starts paying online. amount and delivery_part are in naira.
create table if not exists public.online_payments (
  reference text primary key check (char_length(reference) between 8 and 60),
  order_id bigint not null references public.orders(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  amount integer not null check (amount > 0),
  delivery_part integer not null default 0 check (delivery_part >= 0),
  fee integer not null default 0 check (fee >= 0), -- Paystack's fee, paid by the customer on top of amount
  service integer not null default 0 check (service >= 0), -- ShopDesk's fee, paid by the customer on top of amount
  status text not null default 'started' check (status in ('started', 'paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists online_payments_order on public.online_payments (order_id);
alter table public.online_payments enable row level security;
revoke all on public.online_payments from anon, authenticated;

-- ShopDesk Delivery bookings. cost: what the courier took from ShopDesk's wallet; price: what the customer paid for delivery.
create table if not exists public.shipments (
  order_id bigint primary key references public.orders(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  sb_order text unique,
  courier text not null default '' check (char_length(courier) <= 80),
  status text not null default 'pending' check (char_length(status) <= 40),
  tracking_url text check (char_length(tracking_url) <= 300),
  tracking_code text check (char_length(tracking_code) <= 80),
  rider jsonb,
  steps jsonb not null default '[]'::jsonb,
  cost integer not null default 0 check (cost >= 0),
  price integer not null default 0 check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shipments_shop on public.shipments (shop_id, created_at desc);
alter table public.shipments enable row level security;
drop policy if exists shipments_own on public.shipments;
create policy shipments_own on public.shipments for select to authenticated using (shop_id = public.my_shop_id());
revoke all on public.shipments from anon, authenticated;
grant select on public.shipments to authenticated;

-- What the apps need to know: is Pay online on, is ShopDesk Delivery on.
create or replace function public.money_switches() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('online', online_pay_on, 'delivery', delivery_on, 'fee_by', paystack_fee_by) from public.settings where id = 1;
$$;

-- Everything the money function needs to get courier prices for a new delivery order (the shop's own order, unpaid).
-- ShopDesk Delivery is paid online, so the shop's payout account has to be one Paystack can pay.
create or replace function public.money_quote_info(p_order bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order); s public.shops; st public.settings;
begin
  select * into st from public.settings where id = 1;
  if not st.delivery_on then raise exception 'ShopDesk Delivery isn''t on yet.'; end if;
  if v.mode <> 'delivery' then raise exception 'This order is a pick-up.'; end if;
  if v.status <> 'awaiting' or v.amount_paid > 0 then raise exception 'The fee is locked once paid.'; end if;
  if char_length(trim(v.address)) < 5 then raise exception 'This order has no delivery address.'; end if;
  select * into s from public.shops where id = v.shop_id;
  if char_length(trim(s.pickup_address)) < 5 then raise exception 'Add your pickup address on the Shop tab first.'; end if;
  if s.bank not in ('OPay', 'Moniepoint', 'Kuda', 'PalmPay') or s.account_number !~ '^[0-9]{10}$' then
    raise exception 'ShopDesk Delivery is paid online, so your account under Your shop has to be OPay, Moniepoint, Kuda or PalmPay.'; end if;
  return jsonb_build_object(
    'order', jsonb_build_object('id', v.id, 'name', v.customer_name, 'phone', v.customer_phone, 'address', v.address, 'area', v.area,
      'lat', v.delivery_lat, 'lng', v.delivery_lng, 'email', (select email from auth.users where id = v.customer_id)),
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.whatsapp, 'pickup_address', s.pickup_address, 'pickup_code', s.pickup_code,
      'sells', s.sells, 'email', (select email from auth.users where id = s.owner_id)),
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'price', i.price, 'qty', i.qty) order by i.id) from public.order_items i where i.order_id = v.id),
    'margin', st.delivery_margin);
end $$;

-- The courier prices the money function got, kept on the order so the shop can only pick one of them.
create or replace function public.money_save_quotes(p_order bigint, p_quotes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if v.status <> 'awaiting' or v.amount_paid > 0 then raise exception 'The fee is locked once paid.'; end if;
  update public.orders set delivery_quotes = jsonb_build_object('at', now(), 'list', coalesce(p_quotes, '[]'::jsonb)) where id = v.id;
end $$;

-- The shop picks a courier and the order is confirmed. When the customer pays delivery, that price is the delivery fee; when the
-- shop covers delivery, the price comes out of the customer's payment for the items.
create or replace function public.money_pick_quote(p_order bigint, p_courier text, p_service text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order); q jsonb;
begin
  if v.status <> 'awaiting' or v.amount_paid > 0 then raise exception 'The fee is locked once paid.'; end if;
  if v.delivery_quotes is null or (v.delivery_quotes->>'at')::timestamptz < now() - interval '6 days' then raise exception 'Get the courier prices again.'; end if;
  select x into q from jsonb_array_elements(v.delivery_quotes->'list') x where x->>'courier_id' = p_courier and x->>'service_code' = p_service limit 1;
  if q is null then raise exception 'Get the courier prices again.'; end if;
  if v.delivery_paid_by <> 'customer' and v.items_total <= (q->>'price')::int then
    raise exception 'Delivery costs more than this order. Cancel it, or set Customer pays delivery for new orders.'; end if;
  update public.orders set delivery_fee = case when v.delivery_paid_by = 'customer' then (q->>'price')::int else delivery_fee end,
    delivery_by = 'shopdesk', delivery_quote = q, confirmed_at = coalesce(confirmed_at, now()) where id = v.id;
  return q;
end $$;

-- While ShopDesk Delivery is on, delivery orders go with a courier the shop picks and are paid online: the shop can't type its
-- own fee, mark the money in, or hand it to its own rider, and the customer pays on the order page.
create or replace function public.set_delivery_fee(p_order bigint, p_fee int) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if v.mode <> 'delivery' then raise exception 'This order is a pick-up.'; end if;
  if v.status not in ('awaiting', 'part') then raise exception 'The fee is locked once paid.'; end if;
  if p_fee is null or p_fee < 0 or p_fee > 1000000 then raise exception 'Enter a delivery fee in naira.'; end if;
  -- with ShopDesk Delivery on, new deliveries go with a courier the shop picks (orders confirmed before keep their fee)
  if (select delivery_on from public.settings where id = 1) and (v.delivery_fee is null or v.delivery_by = 'shopdesk') then
    raise exception 'Pick a courier: deliveries go with ShopDesk Delivery.'; end if;
  update public.orders set delivery_fee = p_fee, delivery_by = 'shop', delivery_quote = null, confirmed_at = coalesce(confirmed_at, now()) where id = v.id;
end $$;

create or replace function public.confirm_order(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if v.status = 'cancelled' then raise exception 'This order was cancelled.'; end if;
  if v.mode = 'delivery' and v.delivery_paid_by = 'customer' and v.delivery_fee is null then raise exception 'Set the delivery fee first.'; end if;
  if v.mode = 'delivery' and v.delivery_by <> 'shopdesk' and v.confirmed_at is null and (select delivery_on from public.settings where id = 1) then raise exception 'Pick a courier first.'; end if;
  update public.orders set confirmed_at = coalesce(confirmed_at, now()) where id = v.id;
end $$;

create or replace function public.confirm_payment(p_order bigint, p_method text default 'tap', p_amount int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order); v_shop public.shops; v_due int; v_amt int;
begin
  select * into v_shop from public.shops where id = v.shop_id;
  if v.status not in ('awaiting', 'part') then raise exception 'This order is already paid or closed.'; end if;
  if v.mode = 'delivery' and v.delivery_paid_by = 'customer' and v.delivery_fee is null then raise exception 'Set the delivery fee first.'; end if;
  if v.delivery_by = 'shopdesk' then raise exception 'The customer pays this order online. It shows as paid the moment they do.'; end if;
  v_due := v.items_total + case when v.delivery_paid_by = 'customer' then coalesce(v.delivery_fee, 0) else 0 end - v.amount_paid;
  v_amt := coalesce(p_amount, v_due);
  if v_amt <= 0 or v_amt > v_due then raise exception 'Enter an amount up to %.', public.naira(v_due); end if;
  if v_amt < v_due and not v_shop.allow_part_payment then raise exception 'Part payments are off. Ask for the full %.', public.naira(v_due); end if;
  insert into public.payments (order_id, shop_id, amount, method) values (v.id, v.shop_id, v_amt, coalesce(p_method, 'tap'));
  update public.orders set amount_paid = amount_paid + v_amt, customer_says_paid = false, confirmed_at = coalesce(confirmed_at, now()),
    status = case when v_amt >= v_due then 'paid' else 'part' end,
    paid_at = case when v_amt >= v_due then now() else paid_at end
  where id = v.id;
  return jsonb_build_object('paid', v_amt, 'left', v_due - v_amt);
end $$;

create or replace function public.hand_to_rider(p_order bigint, p_rider_name text, p_rider_phone text, p_deliver_by timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if v.mode <> 'delivery' then raise exception 'This is a pick-up order.'; end if;
  if v.delivery_by = 'shopdesk' then raise exception 'Book the courier for this order.'; end if;
  if v.status not in ('paid', 'out') then raise exception 'Only paid orders can go out.'; end if;
  if v.status = 'paid' and exists (select 1 from public.order_items where order_id = v.id and not packed) then raise exception 'Tick every item as packed first.'; end if;
  if char_length(trim(coalesce(p_rider_name, ''))) < 2 then raise exception 'Enter the rider''s name.'; end if;
  -- the customer taps "Call rider", so it must be a Nigerian mobile number that rings (0803 123 4567, +234 803 123 4567)
  if regexp_replace(coalesce(p_rider_phone, ''), '\D', '', 'g') !~ '^(234|0)?[789][01][0-9]{8}$' then raise exception 'Check the rider''s number, like 0803 123 4567.'; end if;
  if p_deliver_by is null or p_deliver_by < now() - interval '5 minutes' or p_deliver_by > now() + interval '14 days' then raise exception 'Pick a delivery time within 14 days.'; end if;
  if v.status = 'out' and v.deliver_by is distinct from p_deliver_by then
    insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'delivery_moved', v.shop_id,
      'Order #' || v.id || ': promised ' || to_char(v.deliver_by at time zone 'Africa/Lagos', 'Dy DD Mon HH24:MI') || ', now ' || to_char(p_deliver_by at time zone 'Africa/Lagos', 'Dy DD Mon HH24:MI'));
  end if;
  update public.orders set status = 'out', out_at = coalesce(out_at, now()), rider_name = left(trim(p_rider_name), 60), rider_phone = left(trim(p_rider_phone), 20),
    deliver_by = p_deliver_by, confirmed_at = coalesce(confirmed_at, now()) where id = v.id;
end $$;

create or replace function public.customer_says_paid(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.customer_order(p_token);
begin
  if v.delivery_by = 'shopdesk' then raise exception 'Pay this order online on this page.'; end if;
  update public.orders set customer_says_paid = true, customer_says_paid_at = coalesce(customer_says_paid_at, now())
  where id = v.id and status in ('awaiting', 'part');
  if not found then raise exception 'This order is already paid or closed.'; end if;
end $$;

drop function if exists public.money_own_rider(bigint);
drop function if exists public.admin_delivery_paid(uuid);
alter table public.shipments drop column if exists paid_online;
alter table public.shipments drop column if exists billed_at;

-- The customer starts paying online: records the attempt and returns what Paystack needs.
create or replace function public.money_start_payment(p_token uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders; s public.shops; st public.settings; v_due int; v_delivery int; v_fee int; v_service int;
begin
  select * into st from public.settings where id = 1;
  if not st.online_pay_on then raise exception 'Paying online isn''t on yet. Pay by transfer for now.'; end if;
  select * into v from public.orders where public_token = p_token for update;
  if not found then raise exception 'Order not found.'; end if;
  if v.customer_id is not null and v.customer_id is distinct from auth.uid() then raise exception 'Sign in with the account that placed this order.'; end if;
  if v.status not in ('awaiting', 'part') then raise exception 'This order is already paid or closed.'; end if;
  if v.mode = 'delivery' and v.delivery_paid_by = 'customer' and v.delivery_fee is null then raise exception 'Wait for the shop to confirm your order and its delivery fee.'; end if;
  select * into s from public.shops where id = v.shop_id;
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
      'subaccount', s.paystack_subaccount, 'subaccount_for', s.paystack_for));
end $$;

-- Paystack confirmed the payment (the money function checked it with Paystack first). Safe to call twice for the same payment.
create or replace function public.money_paid(p_ref text, p_kobo bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.online_payments; v public.orders; v_due int; v_amt int;
begin
  select * into p from public.online_payments where reference = p_ref for update;
  if not found then raise exception 'Unknown payment.'; end if;
  if p.status = 'paid' then return jsonb_build_object('order_id', p.order_id, 'already', true); end if;
  if coalesce(p_kobo, 0) < (p.amount + p.fee + p.service)::bigint * 100 then raise exception 'The amount paid doesn''t match.'; end if;
  select * into v from public.orders where id = p.order_id for update;
  v_due := v.items_total + case when v.delivery_paid_by = 'customer' then coalesce(v.delivery_fee, 0) else 0 end - v.amount_paid;
  v_amt := least(p.amount, greatest(v_due, 0));
  update public.online_payments set status = 'paid', paid_at = now() where reference = p.reference;
  if v_amt > 0 and v.status in ('awaiting', 'part') then
    insert into public.payments (order_id, shop_id, amount, method) values (v.id, v.shop_id, v_amt, 'online');
    update public.orders set amount_paid = amount_paid + v_amt, customer_says_paid = false, confirmed_at = coalesce(confirmed_at, now()),
      status = case when v_amt >= v_due then 'paid' else 'part' end, paid_at = case when v_amt >= v_due then now() else paid_at end
    where id = v.id;
  else
    v_amt := 0;
  end if;
  -- the shop covers delivery: what it paid ShopDesk for the courier shows in its money out
  if v_amt > 0 and p.delivery_part > 0 and v.delivery_paid_by <> 'customer' then
    insert into public.money_out (shop_id, amount, kind, note) values (v.shop_id, p.delivery_part, 'transport',
      left('ShopDesk Delivery for ' || public.order_code((select order_prefix from public.shops where id = v.shop_id), v.id), 80));
  end if;
  if v_amt < p.amount then
    insert into public.audit_log (actor, action, shop_id, detail) values (null, 'online_overpaid', p.shop_id,
      'Order #' || p.order_id || ': paid ' || public.naira(p.amount) || ' online, ' || public.naira(p.amount - v_amt) || ' more than was due. Refund it in Paystack.');
  end if;
  return jsonb_build_object('order_id', p.order_id, 'credited', v_amt);
end $$;

-- Everything the money function needs to book the courier for a paid, packed order.
create or replace function public.money_book_info(p_order bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order);
begin
  if not (select delivery_on from public.settings where id = 1) then raise exception 'ShopDesk Delivery isn''t on yet.'; end if;
  if v.delivery_by <> 'shopdesk' or v.delivery_quote is null then raise exception 'This order isn''t set up for ShopDesk Delivery.'; end if;
  if v.status <> 'paid' then raise exception 'Only paid orders can be booked.'; end if;
  if not exists (select 1 from public.online_payments where order_id = v.id and status = 'paid') then raise exception 'This order wasn''t paid online.'; end if;
  if exists (select 1 from public.order_items where order_id = v.id and not packed) then raise exception 'Tick every item as packed first.'; end if;
  if exists (select 1 from public.shipments where order_id = v.id) then raise exception 'This order is already booked.'; end if;
  return jsonb_build_object('quote', v.delivery_quote, 'info', public.money_quote_info_paid(v.id));
end $$;

-- Same as money_quote_info, for an order that's already paid (used to get fresh prices when the old ones have expired).
create or replace function public.money_quote_info_paid(p_order bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'order', jsonb_build_object('id', o.id, 'name', o.customer_name, 'phone', o.customer_phone, 'address', o.address, 'area', o.area,
      'lat', o.delivery_lat, 'lng', o.delivery_lng, 'email', (select email from auth.users where id = o.customer_id)),
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.whatsapp, 'pickup_address', s.pickup_address, 'pickup_code', s.pickup_code,
      'sells', s.sells, 'email', (select email from auth.users where id = s.owner_id)),
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'price', i.price, 'qty', i.qty) order by i.id) from public.order_items i where i.order_id = o.id),
    'margin', (select delivery_margin from public.settings where id = 1))
  from public.orders o join public.shops s on s.id = o.shop_id where o.id = p_order;
$$;

-- The courier is booked: save it, and the order goes out with the courier.
create or replace function public.money_save_shipment(p_order bigint, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders := public.owned_order(p_order); v_eta timestamptz;
begin
  if v.status <> 'paid' then raise exception 'Only paid orders can be booked.'; end if;
  v_eta := least(greatest(coalesce((p->>'eta')::timestamptz, now() + interval '2 days'), now() + interval '1 hour'), now() + interval '14 days');
  insert into public.shipments (order_id, shop_id, sb_order, courier, status, tracking_url, tracking_code, cost, price)
  values (v.id, v.shop_id, p->>'sb_order', left(coalesce(p->>'courier', ''), 80), left(coalesce(p->>'status', 'pending'), 40),
    left(p->>'tracking_url', 300), left(p->>'tracking_code', 80), greatest(coalesce((p->>'cost')::int, 0), 0),
    coalesce((v.delivery_quote->>'price')::int, v.delivery_fee, 0));
  update public.orders set status = 'out', out_at = now(), rider_name = left(coalesce(p->>'courier', 'Courier'), 60),
    rider_phone = left(coalesce(p->>'courier_phone', ''), 20), deliver_by = v_eta, confirmed_at = coalesce(confirmed_at, now())
  where id = v.id;
end $$;

-- A status update from the courier service (the money function checked it came from Shipbubble).
create or replace function public.money_ship_update(p_sb_order text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sh public.shipments; v public.orders; st text := lower(coalesce(p->>'status', ''));
begin
  update public.shipments set status = left(coalesce(nullif(st, ''), status), 40), steps = coalesce(p->'steps', steps),
    tracking_url = coalesce(left(p->>'tracking_url', 300), tracking_url), tracking_code = coalesce(left(p->>'tracking_code', 80), tracking_code),
    rider = coalesce(p->'rider', rider), updated_at = now()
  where sb_order = p_sb_order returning * into sh;
  if not found then return jsonb_build_object('found', false); end if;
  select * into v from public.orders where id = sh.order_id for update;
  if st in ('completed', 'delivered') and v.status = 'out' then
    update public.orders set status = 'delivered', done_at = now(), received_by = 'shop' where id = v.id;
  elsif st = 'cancelled' and v.status = 'out' then
    update public.orders set status = 'paid', out_at = null, deliver_by = null, rider_name = '', rider_phone = '' where id = v.id;
    delete from public.shipments where order_id = v.id;
    perform public.notify((select owner_id from public.shops where id = v.shop_id), v.id, 'delivery_cancelled', 'Courier cancelled',
      'The courier cancelled order #' || v.id || '. Book again or use your own rider.', '/#orders');
  end if;
  return jsonb_build_object('found', true, 'status', st);
end $$;

-- Paystack's fee, added on top so that what's left after the fee is p_base (naira): 1.5% + ₦100, the ₦100 waived under
-- ₦2,500, at most ₦2,000. Rounded up, so the shop always gets the full amount.
create or replace function public.online_fee(p_base int) returns int
language sql immutable set search_path = public as $$
  select case when coalesce(p_base, 0) <= 0 then 0
    when ceil(p_base / 0.985) < 2500 then ceil(p_base / 0.985)::int - p_base
    else least(ceil((p_base + 100) / 0.985)::int - p_base, 2000) end;
$$;

-- The order page: can it be paid online (and the card fee the customer pays on top), and how its ShopDesk Delivery is going.
create or replace function public.order_money(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'online', st.online_pay_on and s.status = 'active' and s.bank in ('OPay', 'Moniepoint', 'Kuda', 'PalmPay') and s.account_number <> ''
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

-- Admin > Payments & delivery.
create or replace function public.admin_money() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object(
    'settings', (select jsonb_build_object('online_pay_on', online_pay_on, 'delivery_on', delivery_on, 'delivery_margin', delivery_margin,
      'paystack_fee_by', paystack_fee_by, 'online_service_fee', online_service_fee) from public.settings where id = 1),
    'online', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0), 'delivery', coalesce(sum(delivery_part), 0), 'fees', coalesce(sum(fee), 0), 'service', coalesce(sum(service), 0))
      from public.online_payments where status = 'paid'),
    'shipments', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select sh.order_id, sh.created_at, sh.courier, sh.status, sh.cost, sh.price, sh.tracking_url,
        s.name as shop, s.id as shop_id, public.order_code(s.order_prefix, sh.order_id) as code
      from public.shipments sh join public.shops s on s.id = sh.shop_id order by sh.created_at desc limit 200) x), '[]'::jsonb));
end $$;

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
    updated_at = now()
  where id = 1;
  if (select delivery_on and not online_pay_on from public.settings where id = 1) then
    raise exception 'ShopDesk Delivery is paid online, so Pay online has to be on while it''s on.'; end if;
  insert into public.audit_log (actor, action, detail) values (auth.uid(), 'settings', left(p::text, 300));
end $$;

revoke all on function public.money_switches(), public.money_quote_info(bigint), public.money_save_quotes(bigint, jsonb), public.money_pick_quote(bigint, text, text),
  public.money_start_payment(uuid, text), public.money_paid(text, bigint), public.money_book_info(bigint),
  public.money_quote_info_paid(bigint), public.money_save_shipment(bigint, jsonb), public.money_ship_update(text, jsonb), public.order_money(uuid),
  public.admin_money(), public.shops_pickup_reset(), public.online_fee(int) from public, anon, authenticated;
grant execute on function public.money_switches(), public.order_money(uuid) to anon, authenticated;
grant execute on function public.admin_money() to authenticated;
