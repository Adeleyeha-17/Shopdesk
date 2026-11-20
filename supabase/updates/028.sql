-- Update 028: the shop app now tells ShopDesk each time a shop opens it (the call was never sent before, so a shop's
-- "last active" stayed at the day it signed up, and Admin's attention list kept every shop older than a week).
-- This fills in when each shop owner really last used ShopDesk, from their sign-ins and their app's session refreshes,
-- so shops that came back leave the list. Nothing else changes. Safe to run more than once.
do $back$
begin
  if to_regclass('auth.sessions') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'last_sign_in_at') then
    execute $q$
      update public.shops s set last_active_at = x.seen
      from (select sh.id, greatest(sh.last_active_at,
              coalesce((select u.last_sign_in_at from auth.users u where u.id = sh.owner_id), sh.last_active_at),
              coalesce((select max(se.updated_at) from auth.sessions se where se.user_id = sh.owner_id), sh.last_active_at)) as seen
            from public.shops sh) x
      where x.id = s.id and x.seen > s.last_active_at and x.seen <= now()
    $q$;
  end if;
end $back$;
