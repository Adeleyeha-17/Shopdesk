-- 015: invites. A shop invites another shop with its link (shopdesk.com.ng/?invite=its-link-name).
--   * settings: invites on or off (off until you switch it on in Admin), and the free months for each side
--   * shops remember which shop invited them, and when the reward was given
--   * claim_invite: a new shop that signed up from an invite link records who invited it
--   * when you record the invited shop's first paid month (Plans & payments), both shops get their free months
--   * my_invites (the Shop tab) and admin_invites (Admin > Invites); admin_save_settings saves the invite settings too
-- Safe to run more than once.

alter table public.settings add column if not exists invites_on boolean not null default false;
alter table public.settings add column if not exists invite_months integer not null default 1 check (invite_months between 0 and 12);
alter table public.settings add column if not exists invited_months integer not null default 1 check (invited_months between 0 and 12);
alter table public.shops add column if not exists invited_by uuid references public.shops(id) on delete set null;
alter table public.shops add column if not exists invite_rewarded_at timestamptz;
create index if not exists shops_invited_by on public.shops (invited_by) where invited_by is not null;

-- A new shop (not yet reviewed, set up in the last two days) says which shop's invite link brought it.
create or replace function public.claim_invite(p_slug text) returns boolean
language plpgsql security definer set search_path = public as $$
declare me public.shops; inv public.shops; st public.settings;
begin
  select * into me from public.shops where owner_id = auth.uid();
  if not found or me.invited_by is not null or me.reviewed_at is not null or me.created_at < now() - interval '2 days' then return false; end if;
  select * into inv from public.shops where slug = lower(trim(coalesce(p_slug, ''))) and status = 'active' and id <> me.id;
  if not found then return false; end if;
  update public.shops set invited_by = inv.id where id = me.id;
  select * into st from public.settings where id = 1;
  if st.invites_on then
    perform public.notify(inv.owner_id, null, 'invite_joined', me.name || ' joined from your invite',
      case when st.invite_months > 0 then 'You get ' || st.invite_months || ' free month' || case when st.invite_months = 1 then '' else 's' end ||
        ' when they pay for their first month.' else 'Thanks for bringing them to ShopDesk.' end, '/#shop');
  end if;
  return true;
end $$;

-- The first paid month of an invited shop gives both shops their free months (once), while invites are on.
create or replace function public.invite_reward() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.shops; inv public.shops; st public.settings; v_until timestamptz;
begin
  select * into st from public.settings where id = 1;
  select * into s from public.shops where id = new.shop_id;
  if not st.invites_on or new.amount <= 0 or s.invited_by is null or s.invite_rewarded_at is not null then return new; end if;
  select * into inv from public.shops where id = s.invited_by;
  update public.shops set invite_rewarded_at = now(),
    paid_until = case when st.invited_months > 0 then greatest(coalesce(paid_until, now()), now()) + make_interval(months => st.invited_months) else paid_until end
  where id = s.id returning paid_until into v_until;
  if st.invited_months > 0 then
    perform public.notify(s.owner_id, null, 'invite_reward', 'A free month from your invite',
      'Your plan now runs to ' || to_char(v_until at time zone 'Africa/Lagos', 'FMDD FMMonth YYYY') || '.', '/#shop');
  end if;
  if inv.id is not null and st.invite_months > 0 then
    update public.shops set paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(months => st.invite_months)
    where id = inv.id returning paid_until into v_until;
    perform public.notify(inv.owner_id, null, 'invite_reward', 'You''ve earned ' || st.invite_months || ' free month' || case when st.invite_months = 1 then '' else 's' end,
      s.name || ' paid for their first month. Your plan now runs to ' || to_char(v_until at time zone 'Africa/Lagos', 'FMDD FMMonth YYYY') || '.', '/#shop');
  end if;
  insert into public.audit_log (actor, action, shop_id, detail)
  values (auth.uid(), 'invite_reward', s.id, left('Invited by ' || coalesce(inv.name, '?') || ': ' || st.invited_months || ' month(s) to ' || s.name || ', ' || st.invite_months || ' to ' || coalesce(inv.name, '?'), 300));
  return new;
end $$;
drop trigger if exists plan_payments_invite on public.plan_payments;
create trigger plan_payments_invite after insert on public.plan_payments for each row execute function public.invite_reward();

-- The Shop tab: is it on, the shop's link name, the reward, and the shops it brought in.
create or replace function public.my_invites() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('on', st.invites_on, 'slug', s.slug, 'months', st.invite_months, 'new_months', st.invited_months,
    'rewarded', (select count(*) from public.shops x where x.invited_by = s.id and x.invite_rewarded_at is not null),
    'shops', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'joined', x.created_at,
        'state', case when x.invite_rewarded_at is not null then 'rewarded' when x.status = 'active' then 'approved' when x.status = 'pending' then 'pending' else 'closed' end)
        order by x.created_at desc) from public.shops x where x.invited_by = s.id), '[]'::jsonb))
  from public.shops s cross join public.settings st where s.owner_id = auth.uid() and st.id = 1 and st.invites_on;
$$;

-- Admin > Invites: the settings and every invite.
create or replace function public.admin_invites() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object(
    'settings', (select jsonb_build_object('invites_on', invites_on, 'invite_months', invite_months, 'invited_months', invited_months) from public.settings where id = 1),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'by', i.name, 'by_id', i.id, 'joined', x.created_at, 'status', x.status,
        'rewarded_at', x.invite_rewarded_at, 'paid', exists (select 1 from public.plan_payments pp where pp.shop_id = x.id and pp.amount > 0))
        order by x.created_at desc) from public.shops x join public.shops i on i.id = x.invited_by), '[]'::jsonb));
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
    invited_months = coalesce((p->>'invited_months')::int, invited_months), updated_at = now()
  where id = 1;
  insert into public.audit_log (actor, action, detail) values (auth.uid(), 'settings', left(p::text, 300));
end $$;

revoke all on function public.claim_invite(text), public.invite_reward(), public.my_invites(), public.admin_invites() from public, anon, authenticated;
grant execute on function public.claim_invite(text), public.my_invites(), public.admin_invites() to authenticated;
