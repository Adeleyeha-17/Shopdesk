-- ShopDesk update 010: the admin Support view also lists what each order was for.
-- Safe to run more than once. Run in Supabase: SQL Editor -> New query -> paste -> Run.

-- Support view: a shop's recent orders WITH customer details and what each ordered, only with a written reason, and always logged.
create or replace function public.admin_support_view(p_shop uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Write why you need to see this shop''s orders (at least a sentence).'; end if;
  insert into public.audit_log (actor, action, shop_id, detail) values (auth.uid(), 'support_view', p_shop, left(p_reason, 300));
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'created_at', o.created_at, 'status', o.status, 'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
      'address', o.address, 'items_total', o.items_total, 'delivery_fee', o.delivery_fee, 'amount_paid', o.amount_paid,
      'items', (select coalesce(string_agg(i.qty || ' × ' || i.name, ', ' order by i.id), '') from public.order_items i where i.order_id = o.id)) order by o.created_at desc)
    from (select * from public.orders where shop_id = p_shop order by created_at desc limit 50) o), '[]'::jsonb);
end $$;

-- Function rights: customers may only use the order-page functions.
revoke all on all functions in schema public from public, anon;
grant execute on function public.get_storefront(text), public.get_order_public(uuid), public.report_shop(text, text, text, uuid), public.customer_says_paid(uuid), public.customer_received(uuid) to anon, authenticated;
grant execute on function public.place_order(text, jsonb, jsonb) to authenticated;
grant execute on function public.is_admin(), public.my_shop_id(), public.set_delivery_fee(bigint, int), public.confirm_payment(bigint, text, int), public.mark_customer_says_paid(bigint),
  public.advance_order(bigint), public.add_stock(uuid, int), public.add_option_stock(uuid, int), public.save_product(uuid, jsonb), public.delete_product(uuid), public.touch_shop(), public.admin_overview(), public.admin_reports(),
  public.admin_resolve_report(bigint, text), public.admin_set_shop_status(uuid, text, text), public.admin_delete_shop(uuid, text, text), public.admin_review_shop(uuid, boolean, text), public.admin_support_view(uuid, text), public.admin_audit_log(),
  public.purge_customer_details(int), public.admin_attention(), public.admin_growth(), public.admin_shop_detail(uuid), public.admin_hide_product(uuid, boolean, text),
  public.admin_billing(), public.admin_save_settings(jsonb), public.admin_record_payment(uuid, int, int, text), public.my_plan(),
  public.admin_post_announcement(text, text, int), public.admin_end_announcement(bigint), public.admin_announcements(), public.get_announcements(),
  public.my_orders(), public.claim_orders(uuid[]), public.confirm_order(bigint), public.hand_to_rider(bigint, text, text, timestamptz), public.mark_ready(bigint, timestamptz),
  public.my_account(), public.pack_item(bigint, boolean), public.set_packing_photo(bigint, text), public.answer_problem(bigint, text, text, int, text[]),
  public.report_problem(uuid, text, text, text[]), public.problem_customer(uuid, text), public.admin_problems(), public.admin_decide_problem(bigint, text, text, int),
  public.send_message(bigint, text, text), public.mark_read(bigint, text), public.save_push_sub(text, text, text), public.delete_push_sub(text),
  public.refund_sent(bigint, text), public.admin_clear_owed(bigint, text), public.admin_order_chat(bigint, text), public.cancel_order(bigint, text, text),
  public.customer_cancel(uuid), public.report_message(bigint, text), public.admin_block_user(uuid, boolean, text),
  public.admin_find_order(text), public.admin_archives(), public.admin_archive(bigint, text),
  public.seen_app(), public.my_email_settings(), public.set_email_alerts(boolean) to authenticated;
-- the "Stop these emails" page works without signing in (the secret link is the key)
grant execute on function public.email_by_token(uuid, boolean) to anon, authenticated;
revoke execute on function public.owned_order(bigint) from authenticated;
revoke execute on function public.shops_watch_changes() from authenticated;
revoke execute on function public.shop_open(public.shops) from authenticated;
revoke execute on function public.has_shop(uuid), public.has_shopped(uuid), public.shops_one_role(), public.customers_one_role(), public.customer_order(uuid) from authenticated;
revoke execute on function public.order_prefix_for(text), public.order_code(text, bigint), public.problem_status(public.problems), public.can_report(public.orders),
  public.shops_set_prefix() from authenticated;
revoke execute on function public.naira(int), public.lagos_time(timestamptz), public.kind_text(text), public.shop_owes(uuid), public.can_chat(public.orders),
  public.notify(uuid, bigint, text, text, text, text), public.notify_admins(text, text, text, text), public.orders_notify(), public.shops_notify_admins(),
  public.admin_order_json(bigint), public.push_claim(int), public.push_drop(text[]), public.push_key(), public.push_key_init(text, jsonb),
  public.is_blocked(uuid), public.report_block(uuid), public.cancel_text(text), public.tidy(uuid),
  public.admin_chat_free(public.orders), public.shop_snapshot(uuid), public.shops_archive(), public.email_claim(int), public.email_unclaim(uuid, bigint[]) from authenticated;
revoke execute on function public.restock(bigint[]), public.product_options_sync(), public.json_int(jsonb) from authenticated;

