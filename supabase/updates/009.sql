-- ShopDesk update 009: shops can delete a product for good (past orders keep its details).
-- Safe to run more than once. Run in Supabase: SQL Editor -> New query -> paste -> Run.

-- A shop deletes a product for good. Past orders keep its name, price, size and photo (they're copied onto each order line).
-- Not while an open order has it (the stock is held for that order), and not one ShopDesk hid (that stays for the record).
create or replace function public.delete_product(p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.products;
begin
  select * into v from public.products where id = p_product and shop_id = public.my_shop_id() for update;
  if not found then raise exception 'That product isn''t in your shop. Refresh the page.'; end if;
  if v.hidden_by_admin then raise exception 'ShopDesk hid this product, so it stays. Message ShopDesk about it.'; end if;
  if exists (select 1 from public.order_items i join public.orders o on o.id = i.order_id
             where i.product_id = v.id and o.status in ('awaiting', 'part', 'paid', 'out')) then
    raise exception '% is in an order that isn''t finished yet. Hide it now, and delete it once that order is delivered or cancelled.', v.name;
  end if;
  delete from public.products where id = v.id;
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

