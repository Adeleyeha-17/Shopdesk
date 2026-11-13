-- 024: the "approved" message in the ShopDesk chat gives the shop's full link (https://...), so it opens with a tap.
-- Run after 023. Safe to run more than once.

create or replace function public.admin_review_shop(p_shop uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.shops; v_note text := left(trim(coalesce(p_note, '')), 300);
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  select * into v from public.shops where id = p_shop for update;
  if not found then raise exception 'Shop not found.'; end if;
  if v.status not in ('pending', 'rejected') then raise exception 'This shop is not waiting for approval.'; end if;
  if not p_approve and char_length(v_note) < 5 then raise exception 'Write why the shop is not approved (the vendor sees it).'; end if;
  update public.shops set status = case when p_approve then 'active' else 'rejected' end, reviewed_at = now(), review_note = v_note,
    paid_until = case when p_approve then coalesce(paid_until, now() + make_interval(days => (select trial_days from public.settings where id = 1))) else paid_until end
  where id = p_shop;
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), case when p_approve then 'approve' else 'reject' end, p_shop, coalesce(nullif(v_note, ''), case when p_approve then 'approved' else '' end));
  perform public.shopdesk_says(v.id, case when p_approve
    then 'Good news: ' || v.name || ' is approved and open for orders. Your link: https://shopdesk.com.ng/' || v.slug || E'\nShare it on your WhatsApp status, in your chats and in your Instagram bio.'
    else 'We can''t open ' || v.name || ' yet: ' || v_note || E'\nFix it in the Shop tab, then reply here and we''ll check again.' end);
end $$;
