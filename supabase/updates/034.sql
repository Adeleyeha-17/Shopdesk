-- 034: shop news. A shop announces a new product, a sale, Black Friday or a restock to its customers: everyone who
-- follows it and everyone who has ordered from it, unless they unfollowed. They get a phone alert, the news shows on the
-- shop's page and in "From shops you follow" on the Shops tab. One announcement a day per shop.
-- Run after 033. Safe to run more than once.

-- following: false is a customer who unfollowed (an old customer stays off the list too)
create table if not exists public.shop_follows (
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  following boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create index if not exists shop_follows_user on public.shop_follows (user_id);
alter table public.shop_follows enable row level security;
revoke all on public.shop_follows from anon, authenticated;

create table if not exists public.shop_news (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  kind text not null check (kind in ('new', 'sale', 'black_friday', 'restock')),
  body text not null default '' check (char_length(body) <= 200),
  product_ids uuid[] not null default '{}' check (cardinality(product_ids) between 1 and 6),
  coupon_id bigint references public.coupons(id) on delete set null,
  ends_on date,
  sent int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists shop_news_shop on public.shop_news (shop_id, id desc);
alter table public.shop_news enable row level security;
revoke all on public.shop_news from anon, authenticated;

-- Who hears a shop's news: its followers and its past customers, minus anyone who unfollowed, never the owner.
create or replace function public.shop_audience(p_shop uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  (select f.user_id from public.shop_follows f where f.shop_id = p_shop and f.following
   union
   select o.customer_id from public.orders o where o.shop_id = p_shop and o.customer_id is not null
     and not exists (select 1 from public.shop_follows f where f.shop_id = p_shop and f.user_id = o.customer_id and not f.following))
  except select s.owner_id from public.shops s where s.id = p_shop;
$$;

-- The one line customers read: "Black Friday: 15% off with code BF15." / "New: Coconut oil and 2 more."
create or replace function public.news_line(a public.shop_news) returns text
language plpgsql stable security definer set search_path = public as $$
declare c public.coupons; v_first text; n int := coalesce(cardinality(a.product_ids), 0); t text;
begin
  select name into v_first from public.products where id = a.product_ids[1];
  select * into c from public.coupons where id = a.coupon_id;
  t := case a.kind when 'new' then 'New: ' || coalesce(v_first, 'new products')
    when 'restock' then 'Back in stock: ' || coalesce(v_first, 'your favourites')
    when 'black_friday' then 'Black Friday' else 'Sale' end;
  if a.kind in ('new', 'restock') and n > 1 then t := t || ' and ' || (n - 1) || ' more'; end if;
  if c.id is not null then
    t := t || case when a.kind in ('new', 'restock') then '. ' else ': ' end
      || case when c.kind = 'percent' then c.value || '% off' else '₦' || to_char(c.value, 'FM999,999,999') || ' off' end
      || ' with code ' || c.code;
  elsif a.kind in ('sale', 'black_friday') and v_first is not null then
    t := t || ' on ' || v_first || case when n > 1 then ' and more' else '' end;
  end if;
  return t || '.';
end $$;

create or replace function public.news_live(a public.shop_news) returns boolean
language sql stable set search_path = public as $$
  select a.created_at > now() - interval '14 days' and (a.ends_on is null or a.ends_on >= (now() at time zone 'Africa/Lagos')::date);
$$;

create or replace function public.news_json(a public.shop_news) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'kind', a.kind, 'line', public.news_line(a), 'body', a.body, 'ends_on', a.ends_on,
    'at', a.created_at, 'live', public.news_live(a),
    'code', (select c.code from public.coupons c where c.id = a.coupon_id),
    'off', (select jsonb_build_object('kind', c.kind, 'value', c.value) from public.coupons c where c.id = a.coupon_id),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price, 'sale_price', p.sale_price,
        'photo_path', p.photo_path) order by array_position(a.product_ids, p.id))
      from public.products p where p.id = any(a.product_ids) and p.active and not p.hidden_by_admin), '[]'::jsonb));
$$;

-- The shop page: following it or not, how many follow, and its latest live news.
create or replace function public.shop_follow(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'following', auth.uid() is not null and exists (select 1 from public.shop_audience(s.id) u where u = auth.uid()),
    'followers', (select count(*) from public.shop_audience(s.id)),
    'mine', auth.uid() is not null and s.owner_id = auth.uid(),
    'news', (select public.news_json(a) from public.shop_news a where a.shop_id = s.id and public.news_live(a) order by a.id desc limit 1))
  from public.shops s where s.slug = lower(p_slug) and public.shop_open(s);
$$;

create or replace function public.follow_shop(p_slug text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.shops;
begin
  if auth.uid() is null then raise exception 'Sign in to follow shops.'; end if;
  select * into s from public.shops where slug = lower(p_slug);
  if not found or not public.shop_open(s) then raise exception 'This shop isn''t open right now.'; end if;
  if s.owner_id = auth.uid() then raise exception 'This is your own shop.'; end if;
  insert into public.shop_follows (shop_id, user_id, following) values (s.id, auth.uid(), coalesce(p_on, true))
    on conflict (shop_id, user_id) do update set following = excluded.following;
  return public.shop_follow(p_slug);
end $$;

-- The Shops tab: live news from the shops this customer hears from, newest first.
create or replace function public.my_feed() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by id desc), '[]'::jsonb) from (
    select a.id, public.news_json(a) || jsonb_build_object('shop', jsonb_build_object('name', s.name, 'slug', s.slug)) x
    from public.shop_news a join public.shops s on s.id = a.shop_id
    where auth.uid() is not null and public.news_live(a) and public.shop_open(s)
      and exists (select 1 from public.shop_audience(s.id) u where u = auth.uid())
    order by a.id desc limit 20) q;
$$;

-- The Shop tab: who will hear, whether today's announcement is used, and the last ten.
create or replace function public.my_news() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'audience', (select count(*) from public.shop_audience(s.id)),
    'posted_today', exists (select 1 from public.shop_news a where a.shop_id = s.id
      and (a.created_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date),
    'list', coalesce((select jsonb_agg(public.news_json(a) || jsonb_build_object('sent', a.sent) order by a.id desc)
      from (select * from public.shop_news where shop_id = s.id order by id desc limit 10) a), '[]'::jsonb))
  from public.shops s where s.owner_id = auth.uid();
$$;

create or replace function public.post_news(p_kind text, p_body text, p_products uuid[], p_coupon bigint, p_ends date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.shops; a public.shop_news; v_ids uuid[]; v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_text text; v_sent int := 0; u uuid;
begin
  select * into s from public.shops where owner_id = auth.uid();
  if not found then raise exception 'Not allowed.'; end if;
  if s.status <> 'active' then raise exception 'Your shop isn''t open right now.'; end if;
  if p_kind not in ('new', 'sale', 'black_friday', 'restock') then raise exception 'Pick what you''re announcing.'; end if;
  if exists (select 1 from public.shop_news where shop_id = s.id and (created_at at time zone 'Africa/Lagos')::date = v_today) then
    raise exception 'You''ve announced today already. Announce again tomorrow.'; end if;
  select array_agg(id order by array_position(p_products, id)) into v_ids from public.products
    where shop_id = s.id and id = any(coalesce(p_products, '{}')) and active and not hidden_by_admin;
  if v_ids is null then raise exception 'Pick at least one product.'; end if;
  if cardinality(v_ids) > 6 then raise exception 'Pick up to 6 products.'; end if;
  if p_coupon is not null and not exists (select 1 from public.coupons where id = p_coupon and shop_id = s.id and active
      and (ends_on is null or ends_on >= v_today) and (max_uses is null or (select count(*) from public.orders o where o.coupon_id = p_coupon) < max_uses)) then
    raise exception 'That discount code isn''t on. Pick another or none.'; end if;
  if p_ends is not null and p_ends < v_today then raise exception 'Pick an end date from today on.'; end if;
  if exists (select 1 from regexp_matches(regexp_replace(coalesce(p_body, ''), '[\s.-]', '', 'g'), '\d+', 'g') x where char_length(x[1]) >= 10) then
    raise exception 'Leave account and phone numbers out of announcements.'; end if;
  insert into public.shop_news (shop_id, kind, body, product_ids, coupon_id, ends_on)
    values (s.id, p_kind, left(trim(coalesce(p_body, '')), 200), v_ids, p_coupon, p_ends) returning * into a;
  v_text := public.news_line(a) || case when a.body <> '' then ' ' || a.body else '' end;
  for u in select * from public.shop_audience(s.id) loop
    perform public.notify(u, null, 'shop_news', s.name, v_text, '/' || s.slug);
    v_sent := v_sent + 1;
  end loop;
  update public.shop_news set sent = v_sent where id = a.id;
  return public.news_json(a) || jsonb_build_object('sent', v_sent);
end $$;

-- Shops near you also says which shops are on sale now and which are new this week.
create or replace function public.shops_near() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'slug', s.slug, 'sells', s.sells, 'location', s.location,
      'photo_path', (select p.photo_path from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin
        order by p.created_at desc limit 1),
      -- On sale now: the newest discount code that's on ("15% OFF"), or SALE for sale news or a sale banner
      'deal', coalesce((select case when c.kind = 'percent' then c.value || '% OFF' else '₦' || to_char(c.value, 'FM999,999,999') || ' OFF' end
          from public.coupons c where c.shop_id = s.id and c.active and (c.ends_on is null or c.ends_on >= (now() at time zone 'Africa/Lagos')::date)
            and (c.max_uses is null or (select count(*) from public.orders o where o.coupon_id = c.id) < c.max_uses)
          order by c.created_at desc limit 1),
        case when exists (select 1 from public.shop_news n where n.shop_id = s.id and n.kind in ('sale', 'black_friday') and public.news_live(n))
          or (s.banner <> '' and (s.banner_until is null or s.banner_until >= (now() at time zone 'Africa/Lagos')::date)) then 'SALE' end),
      -- New this week: opened, or added products, in the last 7 days
      'fresh', s.reviewed_at > now() - interval '7 days' or exists (select 1 from public.products p where p.shop_id = s.id and p.active
        and not p.hidden_by_admin and p.created_at > now() - interval '7 days'))
      || public.shop_rating(s.id) order by s.created_at), '[]'::jsonb)
  from public.shops s
  where public.shop_open(s) and not public.shop_owes(s.id) and not s.pay_test
    and exists (select 1 from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin);
$$;

revoke all on function public.shop_audience(uuid), public.news_line(public.shop_news), public.news_json(public.shop_news),
  public.shop_follow(text), public.follow_shop(text, boolean), public.my_feed(), public.my_news(),
  public.post_news(text, text, uuid[], bigint, date) from public, anon, authenticated;
grant execute on function public.shop_follow(text) to anon, authenticated;
grant execute on function public.follow_shop(text, boolean), public.my_feed(), public.my_news(),
  public.post_news(text, text, uuid[], bigint, date) to authenticated;
