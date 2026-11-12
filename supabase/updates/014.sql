-- 014: ratings and Shops near you.
--   * shop_ratings: one rating per customer per shop (1 to 5 stars and a comment), only after a delivered order.
--     Ordering again lets them change it; it stays one rating. Everyone can read them.
--   * rate_shop / my_shop_rating: the customer rates from their delivered order, and sees what they gave
--   * shop_reviews: a shop's ratings page (first name and initial only)
--   * shops_near: every open shop with what it sells, where it is, a photo and its rating, for Shops near you
--   * get_storefront also returns the shop's rating
-- Safe to run more than once. Run it before publishing the app version with ratings and Shops near you.

create table if not exists public.shop_ratings (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  order_id bigint references public.orders(id) on delete set null,
  stars smallint not null check (stars between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 400),
  hidden_by_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, customer_id)
);
create index if not exists shop_ratings_shop on public.shop_ratings (shop_id, updated_at desc);
-- read and written only through the functions below
alter table public.shop_ratings enable row level security;
revoke all on public.shop_ratings from anon, authenticated;

-- "Funmi Adebayo" -> "Funmi A."
create or replace function public.short_name(p text) returns text
language sql immutable set search_path = public as $$
  select case when coalesce(trim(p), '') = '' then 'A customer'
    else (regexp_split_to_array(trim(p), '\s+'))[1] ||
      coalesce(' ' || upper(left((regexp_split_to_array(trim(p), '\s+'))[2], 1)) || '.', '') end;
$$;

-- A shop's average and number of ratings (ratings ShopDesk hid don't count).
create or replace function public.shop_rating(p_shop uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('rating', round(avg(stars)::numeric, 1), 'ratings', count(*))
  from public.shop_ratings where shop_id = p_shop and not hidden_by_admin;
$$;

-- The customer rates the shop from one of their delivered orders. A second order lets them change it; it stays one rating.
create or replace function public.rate_shop(p_token uuid, p_stars int, p_comment text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; s public.shops; v_new boolean; v_comment text;
begin
  if auth.uid() is null then raise exception 'Sign in to rate this shop.'; end if;
  select * into o from public.orders where public_token = p_token and customer_id = auth.uid();
  if not found then raise exception 'Only the customer who placed this order can rate the shop.'; end if;
  if o.status <> 'delivered' then raise exception 'You can rate the shop once your order is delivered.'; end if;
  if p_stars is null or p_stars not between 1 and 5 then raise exception 'Pick 1 to 5 stars.'; end if;
  if public.is_blocked(auth.uid()) then raise exception 'Your account can''t rate shops. Contact ShopDesk.'; end if;
  v_comment := left(trim(coalesce(p_comment, '')), 400);
  select * into s from public.shops where id = o.shop_id;
  v_new := not exists (select 1 from public.shop_ratings where shop_id = o.shop_id and customer_id = auth.uid());
  insert into public.shop_ratings (shop_id, customer_id, order_id, stars, comment)
  values (o.shop_id, auth.uid(), o.id, p_stars, v_comment)
  on conflict (shop_id, customer_id) do update
    set stars = excluded.stars, comment = excluded.comment, order_id = excluded.order_id, updated_at = now();
  perform public.notify(s.owner_id, o.id, 'rating',
    case when v_new then 'New rating: ' else 'Rating changed: ' end || p_stars || ' star' || case when p_stars = 1 then '' else 's' end,
    public.short_name(o.customer_name) || case when v_comment <> '' then ': ' || v_comment else ' rated your shop.' end,
    '/' || s.slug || '/ratings');
  return public.shop_rating(o.shop_id) || jsonb_build_object('stars', p_stars, 'comment', v_comment);
end $$;

-- What this customer gave the shop of this order, or null if they haven't rated it.
create or replace function public.my_shop_rating(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('stars', r.stars, 'comment', r.comment, 'at', r.updated_at)
  from public.orders o join public.shop_ratings r on r.shop_id = o.shop_id and r.customer_id = o.customer_id
  where o.public_token = p_token and o.customer_id = auth.uid();
$$;

-- A shop's ratings page: the average, how many of each star, and the newest 50 comments.
create or replace function public.shop_reviews(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', s.name, 'slug', s.slug) || public.shop_rating(s.id) || jsonb_build_object(
    'stars', (select jsonb_object_agg(k, (select count(*) from public.shop_ratings r where r.shop_id = s.id and not r.hidden_by_admin and r.stars = k))
      from generate_series(1, 5) k),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('who', x.who, 'stars', x.stars, 'comment', x.comment, 'at', x.updated_at, 'bought', x.bought)
        order by x.updated_at desc)
      from (select public.short_name(coalesce(nullif(c.name, ''), o.customer_name)) who, r.stars, r.comment, r.updated_at,
              (select string_agg(i.name, ', ' order by i.id) from public.order_items i where i.order_id = r.order_id) bought
            from public.shop_ratings r
            left join public.customers c on c.user_id = r.customer_id
            left join public.orders o on o.id = r.order_id
            where r.shop_id = s.id and not r.hidden_by_admin
            order by r.updated_at desc limit 50) x), '[]'::jsonb))
  from public.shops s where s.slug = lower(p_slug) and s.status = 'active';
$$;

-- Shops near you: every shop taking orders that has something to sell. The app sorts them by the customer's area.
create or replace function public.shops_near() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'slug', s.slug, 'sells', s.sells, 'location', s.location,
      'photo_path', (select p.photo_path from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin
        order by p.created_at desc limit 1)) || public.shop_rating(s.id) order by s.created_at), '[]'::jsonb)
  from public.shops s
  where public.shop_open(s) and not public.shop_owes(s.id)
    and exists (select 1 from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin);
$$;

create or replace function public.get_storefront(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'shop', jsonb_build_object('name', s.name, 'slug', s.slug, 'bank', s.bank, 'account_number', s.account_number, 'account_name', s.account_name,
      'allow_part_payment', s.allow_part_payment, 'delivery_paid_by', s.delivery_paid_by) || public.shop_rating(s.id),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price, 'sale_price', p.sale_price, 'stock', p.stock,
        'photo_path', p.photo_path, 'option_label', p.option_label,
        'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price', o.price, 'sale_price', o.sale_price, 'stock', o.stock)
          order by o.sort_order, o.created_at) from public.product_options o where o.product_id = p.id), '[]'::jsonb)) order by p.created_at desc)
      from public.products p where p.shop_id = s.id and p.active and not p.hidden_by_admin), '[]'::jsonb))
  from public.shops s where s.slug = lower(p_slug) and public.shop_open(s) and not public.shop_owes(s.id);
$$;

revoke all on function public.short_name(text), public.shop_rating(uuid), public.rate_shop(uuid, int, text), public.my_shop_rating(uuid),
  public.shop_reviews(text), public.shops_near() from public, anon, authenticated;
grant execute on function public.shop_reviews(text), public.shops_near() to anon, authenticated;
grant execute on function public.rate_shop(uuid, int, text), public.my_shop_rating(uuid) to authenticated;
