\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Sizes (choices), sale prices, editing products and the customer's map pin. Runs after the other test files.
reset role;
insert into auth.users values ('a0000000-0000-4000-8000-000000000001', 'sizes@example.com'), ('a0000000-0000-4000-8000-000000000002', 'nosy@example.com'),
  ('a1000000-0000-4000-8000-000000000001', 'ada@example.com') on conflict do nothing;
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location) values (auth.uid(), 'Size Shop', 'sizeshop', 'OPay', '0222333444', 'SIZE SHOP', '08000000007', 'Perfume', 'Ikeja');
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000002';
insert into shops (owner_id, name, slug, bank, account_number, account_name, whatsapp, sells, location) values (auth.uid(), 'Nosy Shop', 'nosyshop', 'OPay', '0222333445', 'NOSY', '08000000006', 'Things', 'Yaba');
reset role; update shops set status = 'active', paid_until = now() + interval '30 days' where slug in ('sizeshop', 'nosyshop');
select id as sizeshop from shops where slug = 'sizeshop' \gset

\echo O1 a plain product with a sale price (expect the id, then 9500|8000|12|3|):
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select save_product(null, jsonb_build_object('name', 'Kettle', 'photo_path', :'sizeshop' || '/k.jpg', 'price', 9500, 'sale_price', 8000, 'stock', 12, 'low_at', 3)) as kettle \gset
select :'kettle' <> '';
select price || '|' || sale_price || '|' || stock || '|' || low_at || '|' || option_label from products where id = :'kettle';

\echo O2 what the form checks (expect 9 plain errors):
select save_product(null, '{"name": "Mug", "price": 500, "stock": 1}');
select save_product(null, jsonb_build_object('name', '', 'photo_path', :'sizeshop' || '/m.jpg', 'price', 500, 'stock', 1));
select save_product(null, jsonb_build_object('name', repeat('a', 61), 'photo_path', :'sizeshop' || '/m.jpg', 'price', 500, 'stock', 1));
select save_product(null, jsonb_build_object('name', 'Mug', 'photo_path', :'sizeshop' || '/m.jpg', 'price', 0, 'stock', 1));
select save_product(null, jsonb_build_object('name', 'Mug', 'photo_path', :'sizeshop' || '/m.jpg', 'price', 500, 'sale_price', 500, 'stock', 1));
select save_product(null, jsonb_build_object('name', 'Mug', 'photo_path', :'sizeshop' || '/m.jpg', 'price', 500));
select save_product(null, jsonb_build_object('name', 'Mug', 'photo_path', 'someone-else/m.jpg', 'price', 500, 'stock', 1));
select save_product(null, jsonb_build_object('name', 'Mug', 'photo_path', :'sizeshop' || '/m.jpg', 'option_label', 'Size',
  'options', jsonb_build_array(jsonb_build_object('name', 'Big', 'price', 500, 'stock', 1), jsonb_build_object('name', 'big', 'price', 600, 'stock', 1))));
select save_product(null, jsonb_build_object('name', 'Mug', 'photo_path', :'sizeshop' || '/m.jpg',
  'options', (select jsonb_agg(jsonb_build_object('name', 'S' || g, 'price', 100, 'stock', 1)) from generate_series(1, 21) g)));
reset role; select count(*) from products where shop_id = :'sizeshop';

\echo O3 a product with sizes: the label defaults to Size, its price is the lowest and its stock the total (expect Size|15000|9|null, then 3 sizes):
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select save_product(null, jsonb_build_object('name', 'Sweet Obsession', 'photo_path', :'sizeshop' || '/so.jpg', 'low_at', 1,
  'options', jsonb_build_array(jsonb_build_object('name', '30ml', 'price', 15000, 'stock', 4),
    jsonb_build_object('name', '50ml', 'price', 22000, 'sale_price', 19500, 'stock', 3), jsonb_build_object('name', '100ml', 'price', 38000, 'stock', 2)))) as so \gset
select option_label || '|' || price || '|' || stock || '|' || coalesce(sale_price::text, 'null') from products where id = :'so';
select string_agg(name || ':' || price || ':' || coalesce(sale_price::text, '-') || ':' || stock, ' ' order by sort_order) from product_options where product_id = :'so';
select id as o30 from product_options where product_id = :'so' and name = '30ml' \gset
select id as o50 from product_options where product_id = :'so' and name = '50ml' \gset
select id as o100 from product_options where product_id = :'so' and name = '100ml' \gset

\echo O4 the order page shows sale prices and sizes (expect 8000, Size, 3, 19500):
reset role; set role anon;
select (select p->>'sale_price' from jsonb_array_elements(get_storefront('sizeshop')->'products') p where p->>'name' = 'Kettle');
select (select p->>'option_label' || chr(10) || jsonb_array_length(p->'options') || chr(10) || (p->'options'->1->>'sale_price')
  from jsonb_array_elements(get_storefront('sizeshop')->'products') p where p->>'name' = 'Sweet Obsession');

\echo O5 ordering: the size is needed, the sale price is paid, each line names its size (expect the choose error, then 2 lines, 47000):
reset role; set role authenticated; set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select place_order('sizeshop', '{"name":"Ada","phone":"0803","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'so', 'qty', 1)));
select place_order('sizeshop', '{"name":"Ada","phone":"0803","mode":"pickup"}', jsonb_build_array(
  jsonb_build_object('product_id', :'so', 'option_id', :'o50', 'qty', 2), jsonb_build_object('product_id', :'kettle', 'qty', 1)))->>'token' as t1 \gset
reset role; select id as ord1 from orders where public_token = :'t1' \gset
select string_agg(name || ' x' || qty || ' @' || price || ' [' || option_name || ']', ' / ' order by id) from order_items where order_id = :ord1;
select items_total from orders where id = :ord1;

\echo O6 stock: the size goes down and the product follows (expect 1|7, then 11):
select (select stock from product_options where id = :'o50') || '|' || (select stock from products where id = :'so');
select stock from products where id = :'kettle';

\echo O7 not enough of a size (expect the only-left error naming the size):
set role authenticated; set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select place_order('sizeshop', '{"name":"Ada","phone":"0803","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'so', 'option_id', :'o100', 'qty', 3)));

\echo O8 prices change any time; orders already placed keep theirs (expect 47000, then 9000|null, then 21000):
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select save_product(:'kettle', '{"name": "Kettle", "price": 9000, "sale_price": null}') is not null;
select save_product(:'so', jsonb_build_object('name', 'Sweet Obsession', 'options', jsonb_build_array(
  jsonb_build_object('id', :'o30', 'name', '30ml', 'price', 16000), jsonb_build_object('id', :'o50', 'name', '50ml', 'price', 21000),
  jsonb_build_object('id', :'o100', 'name', '100ml', 'price', 40000)))) is not null;
reset role; select items_total from orders where id = :ord1;
select price || '|' || coalesce(sale_price::text, 'null') || '|' || stock from products where id = :'kettle';
select price || ':' || coalesce(sale_price::text, '-') || ':' || stock from product_options where id = :'o50';

\echo O9 the photo stays when none is sent; the warning level stays (expect so.jpg|1):
select split_part(photo_path, '/', 2) || '|' || low_at from products where id = :'so';

\echo O10 cancelling puts each size back (expect 3|9, kettle 12):
set role authenticated; set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select customer_cancel(:'t1');
reset role; select (select stock from product_options where id = :'o50') || '|' || (select stock from products where id = :'so');
select stock from products where id = :'kettle';

\echo O11 the same product twice in one order goes back twice (expect 12 -> 9 -> 12):
set role authenticated; set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select place_order('sizeshop', '{"name":"Ada","phone":"0803","mode":"pickup"}', jsonb_build_array(
  jsonb_build_object('product_id', :'kettle', 'qty', 1), jsonb_build_object('product_id', :'kettle', 'qty', 2)))->>'token' as t2 \gset
reset role; select stock from products where id = :'kettle';
set role authenticated; select customer_cancel(:'t2');
reset role; select stock from products where id = :'kettle';

\echo O12 a size removed while an order holds it: the order keeps its name; cancelling it puts nothing back anywhere (expect 2 sizes, 7|7, name kept, 7):
set role authenticated; set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select place_order('sizeshop', '{"name":"Ada","phone":"0803","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'so', 'option_id', :'o100', 'qty', 1)))->>'token' as t3 \gset
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select save_product(:'so', jsonb_build_object('name', 'Sweet Obsession', 'options', jsonb_build_array(
  jsonb_build_object('id', :'o30', 'name', '30ml', 'price', 16000), jsonb_build_object('id', :'o50', 'name', '50 ml', 'price', 21000)))) is not null;
reset role; select count(*) from product_options where product_id = :'so';
select (select sum(stock) from product_options where product_id = :'so') || '|' || (select stock from products where id = :'so');
select name || ' [' || option_name || '] ' || coalesce(option_id::text, 'gone') from order_items where order_id = (select id from orders where public_token = :'t3');
set role authenticated; set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select customer_cancel(:'t3');
reset role; select stock from products where id = :'so';

\echo O13 adding stock: to a size, not to a product with sizes (expect 7, then the each-size error, then 15):
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select add_option_stock(:'o30', 3);
select add_stock(:'so', 1);
select add_stock(:'kettle', 3);

\echo O14 another shop can’t see, change or stock your sizes (expect 0, the not-in-your-shop error, the not-found error, 7):
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000002';
select count(*) from product_options;
select save_product(:'so', '{"name": "Mine now", "price": 1, "stock": 1}');
select add_option_stock(:'o30', 100);
reset role; select stock from product_options where id = :'o30';

\echo O15 changes go through save_product: price can’t be set directly; hiding still works (expect permission denied, then f):
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
update products set price = 1 where id = :'kettle';
update products set active = false where id = :'kettle';
select active from products where id = :'kettle';
update products set active = true where id = :'kettle';

\echo O16 the helpers aren’t for the app (expect 2 permission errors, f) and anon sees no sizes table (expect permission denied):
select restock(array[1::bigint]);
select json_int('1');
select has_function_privilege('authenticated', 'public.product_options_sync()', 'execute');
reset role; set role anon;
select count(*) from product_options;

\echo O17 from sizes back to one price: it needs a stock (expect the stock error, then 12000|6|)
reset role; set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select save_product(:'so', '{"name": "Sweet Obsession", "price": 12000, "options": []}');
select save_product(:'so', '{"name": "Sweet Obsession", "price": 12000, "stock": 6, "options": []}') is not null;
reset role; select price || '|' || stock || '|' || option_label from products where id = :'so';
select count(*) from product_options where product_id = :'so';

\echo O18 map pin: no address needed with a pin; the address says so; saved details keep the typed address (expect Map pin 6.52440, 3.37920|6.5244|3.3792, then Ikeja home):
reset role; delete from customers where user_id = 'a1000000-0000-4000-8000-000000000001';
set role authenticated; set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select place_order('sizeshop', '{"name":"Ada","phone":"0803","mode":"delivery","address":"12 Allen Avenue, Ikeja home"}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)))->>'token' as t4 \gset
select place_order('sizeshop', '{"name":"Ada","phone":"0803","mode":"delivery","address":"","lat":6.5244,"lng":3.3792}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)))->>'token' as t5 \gset
reset role; select address || '|' || delivery_lat || '|' || delivery_lng from orders where public_token = :'t5';
select address from customers where user_id = 'a1000000-0000-4000-8000-000000000001';

\echo O19 a typed address with a pin keeps both; pick-up and a bad pin keep none; no address and no pin is refused (expect 3 lines, then the address error):
set role authenticated; set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select place_order('sizeshop', '{"name":"Ada","phone":"0803","mode":"delivery","address":"Blue gate by the church","lat":6.6,"lng":3.35}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)))->>'token' as t6 \gset
reset role; update orders set status = 'cancelled', done_at = now() where customer_id = 'a1000000-0000-4000-8000-000000000001' and status = 'awaiting';
set role authenticated; set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select place_order('sizeshop', '{"name":"Ada","phone":"0803","mode":"pickup","lat":6.6,"lng":3.35}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)))->>'token' as t7 \gset
select place_order('sizeshop', '{"name":"Ada","phone":"0803","mode":"delivery","address":"Somewhere in Yaba","lat":"6.6","lng":999}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)))->>'token' as t8 \gset
reset role;
select address || '|' || coalesce(delivery_lat::text, '-') || '|' || coalesce(delivery_lng::text, '-') from orders where public_token in (:'t6', :'t7', :'t8') order by id;
set role authenticated; set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select place_order('sizeshop', '{"name":"Ada","phone":"0803","mode":"delivery","address":""}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)));

\echo O20 the pin goes with the address after 180 days (expect t, then |-|-):
reset role; set request.jwt.claim.sub = ''; update orders set status = 'delivered', done_at = now() - interval '200 days' where public_token = :'t5';
select purge_customer_details(180) >= 1;
select address || '|' || coalesce(delivery_lat::text, '-') || '|' || coalesce(delivery_lng::text, '-') from orders where public_token = :'t5';

\echo O21 unpaid for 48 hours: the size goes back by itself (expect 5 -> 4 -> 5):
reset role; select stock from product_options where id = :'o50';
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select save_product(:'so', jsonb_build_object('name', 'Sweet Obsession', 'options', jsonb_build_array(
  jsonb_build_object('name', '30ml', 'price', 16000, 'stock', 4), jsonb_build_object('name', '50ml', 'price', 21000, 'stock', 5)))) is not null;
reset role; select id as n50 from product_options where product_id = :'so' and name = '50ml' \gset
update orders set status = 'cancelled', done_at = now() where customer_id = 'a1000000-0000-4000-8000-000000000001' and status = 'awaiting';
set role authenticated; set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select place_order('sizeshop', '{"name":"Ada","phone":"0803","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'so', 'option_id', :'n50', 'qty', 1)))->>'token' as t9 \gset
reset role; select stock from product_options where id = :'n50';
update orders set created_at = now() - interval '49 hours' where public_token = :'t9';
select tidy(:'sizeshop') >= 1;
select stock from product_options where id = :'n50';

\echo O22 your shop page and records show sizes (expect 2, then 2):
insert into admins values ('33333333-3333-3333-3333-333333333333') on conflict do nothing;
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select jsonb_array_length((select p->'options' from jsonb_array_elements(admin_shop_detail(:'sizeshop')->'products') p where p->>'name' = 'Sweet Obsession'));
reset role; select jsonb_array_length((select p->'options' from jsonb_array_elements(shop_snapshot(:'sizeshop')->'products') p where p->>'name' = 'Sweet Obsession'));

\echo O23 deleting a product: not while an open order has it; not someone else’s; not one ShopDesk hid (expect 3 errors):
reset role; set role authenticated; set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
select place_order('sizeshop', '{"name":"Ada","phone":"0803","mode":"pickup"}', jsonb_build_array(jsonb_build_object('product_id', :'kettle', 'qty', 1)))->>'token' as t10 \gset
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select delete_product(:'kettle');
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000002';
select delete_product(:'so');
reset role;
update products set hidden_by_admin = true, hidden_reason = 'Test' where id = :'kettle';
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select delete_product(:'kettle');
reset role; update products set hidden_by_admin = false, hidden_reason = '' where id = :'kettle';

\echo O24 deleting a product with sizes: it and its sizes go; past orders keep their lines (expect 0|0, then lines kept with no product):
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select delete_product(:'so');
reset role;
select (select count(*) from products where id = :'so') || '|' || (select count(*) from product_options where product_id = :'so');
select count(*) || ' lines kept, ' || count(*) filter (where product_id is null) || ' without a product, names: ' || string_agg(distinct name, ', ')
from order_items where name like 'Sweet Obsession%';
\echo O25 the app can call it; visitors can’t (expect t|f):
select has_function_privilege('authenticated', 'public.delete_product(uuid)', 'execute'), has_function_privilege('anon', 'public.delete_product(uuid)', 'execute');
