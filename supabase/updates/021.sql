-- 021: every order is paid in full (no more part payments), and shops hear when someone looks at their shop.
-- Run after 020. Safe to run more than once.

update public.shops set allow_part_payment = false where allow_part_payment;
revoke insert (allow_part_payment), update (allow_part_payment) on public.shops from authenticated;

-- ---------- Visitors: shops hear when someone looks at their shop ----------
-- One row per person per shop per day (a random id kept on the visitor's phone, or their account when signed in); the
-- shop owner's own visits don't count. Kept for 90 days.
create table if not exists public.shop_visits (
  shop_id uuid not null references public.shops(id) on delete cascade,
  visitor text not null check (char_length(visitor) between 8 and 64),
  day date not null default ((now() at time zone 'Africa/Lagos')::date),
  at timestamptz not null default now(),
  primary key (shop_id, visitor, day)
);
alter table public.shop_visits enable row level security;
revoke all on public.shop_visits from anon, authenticated;

-- Someone opened a shop's page. The shop hears "Someone is looking at your shop" at most once every 2 hours, from 7am to
-- 10pm. Returns true when the shop was told (the page then asks the push sender to send it). p_hour stands in for the
-- Lagos hour, for tests.
create or replace function public.note_visit(p_slug text, p_visitor text, p_hour int default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare s public.shops; n int; h int := coalesce(p_hour, extract(hour from now() at time zone 'Africa/Lagos')::int);
begin
  select * into s from public.shops where slug = lower(p_slug);
  if not found or s.status <> 'active' or s.owner_id = auth.uid() then return false; end if;
  if auth.uid() is null and (p_visitor is null or char_length(p_visitor) not between 8 and 64) then return false; end if;
  insert into public.shop_visits (shop_id, visitor) values (s.id, coalesce(auth.uid()::text, p_visitor)) on conflict do nothing;
  if not found then return false; end if;
  if random() < 0.01 then delete from public.shop_visits where day < current_date - 90; end if;
  if h not between 7 and 21
    or exists (select 1 from public.notifications where user_id = s.owner_id and kind = 'visit' and created_at > now() - interval '2 hours') then
    return false;
  end if;
  select count(*) into n from public.shop_visits where shop_id = s.id and day = (now() at time zone 'Africa/Lagos')::date;
  perform public.notify(s.owner_id, null, 'visit', 'Someone is looking at your shop',
    case when n = 1 then 'Your first visitor today.' else n || ' people have visited today.' end, '/#sales');
  return true;
end $$;

-- The shop's own visitor numbers, for the Sales tab.
create or replace function public.my_visits() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'today', count(*) filter (where v.day = (now() at time zone 'Africa/Lagos')::date),
    'week', count(*) filter (where v.day > (now() at time zone 'Africa/Lagos')::date - 7))
  from public.shop_visits v where v.shop_id = public.my_shop_id();
$$;

revoke all on function public.note_visit(text, text, int), public.my_visits() from public, anon, authenticated;
grant execute on function public.note_visit(text, text, int) to anon, authenticated;
grant execute on function public.my_visits() to authenticated;
