-- Owner lock: ShopDesk has exactly one owner account, and nothing (the app, a vendor, a leaked key) can add another.
-- Run once in SQL Editor after you've signed in to the app once with your owner email. Put your email on the next line.
-- If you ever run schema.sql again, run this file again straight after it.
do $lock$
declare v uuid;
begin
  select id into v from auth.users where email = lower('you@example.com');
  if v is null then raise exception 'Sign in to ShopDesk once with this email first, then run this again.'; end if;
  execute format($f$create or replace function public.is_admin() returns boolean
    language sql stable security definer set search_path = public as $b$
      select auth.uid() = %L::uuid and exists (select 1 from public.admins where user_id = auth.uid());
    $b$$f$, v);
  execute format($f$create or replace function public.admins_owner_only() returns trigger
    language plpgsql set search_path = public as $b$
    begin
      if new.user_id <> %L::uuid then raise exception 'ShopDesk has one owner account. No other account can be added.'; end if;
      return new;
    end $b$$f$, v);
  drop trigger if exists admins_owner_only on public.admins;
  delete from public.admins where user_id <> v;
  insert into public.admins (user_id) values (v) on conflict do nothing;
  create trigger admins_owner_only before insert or update on public.admins for each row execute function public.admins_owner_only();
  revoke all on function public.admins_owner_only() from public, anon, authenticated;
end $lock$;
