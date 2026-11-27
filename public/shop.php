<?php
// A shop's link (shopdesk.com.ng/<shop>), opened by Google, X, WhatsApp or a browser: the app page (index.html) with the
// shop's own title, description, preview picture and search details in its head, so the link shows the shop. The shop
// comes from the same database function the app uses (get_storefront), kept for 10 minutes. If anything goes wrong it's
// simply the app page, which opens the shop as before.
declare(strict_types=1);
require __DIR__ . '/seo-lib.php';

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
$page = @file_get_contents(__DIR__ . '/index.html');
if ($page === false) {
    http_response_code(500);
    exit;
}
$slug = strtolower((string) ($_GET['s'] ?? ''));
$data = preg_match('/^[a-z0-9][a-z0-9-]{1,59}$/', $slug) ? seo_rpc('get_storefront', ['p_slug' => $slug], 600) : null;
if (!is_array($data) || empty($data['shop']['name'])) {
    echo $page;
    exit;
}

$shop = $data['shop'];
$products = is_array($data['products'] ?? null) ? $data['products'] : [];
$name = (string) $shop['name'];
$url = 'https://shopdesk.com.ng/' . $shop['slug'];
$items = array_slice(array_values(array_filter(array_map(fn($p) => trim((string) ($p['name'] ?? '')), $products))), 0, 4);
$description = $items ? "Order from {$name} on ShopDesk: " . implode(', ', $items) . '.' : "Order from {$name} on ShopDesk.";
$rating = (float) ($shop['rating'] ?? 0);
$ratings = (int) ($shop['ratings'] ?? 0);
if ($ratings > 0) $description .= ' Rated ' . rtrim(rtrim(number_format($rating, 1), '0'), '.') . '/5 by ' . $ratings . ' customer' . ($ratings === 1 ? '' : 's') . '.';
$photo = '';
foreach ($products as $p) {
    if (!empty($p['photo_path'])) {
        $photo = (string) $p['photo_path'];
        break;
    }
}
$image = seo_photo($photo ?: null);
$title = "{$name} | Order on ShopDesk";

$offers = [];
foreach (array_slice($products, 0, 20) as $p) {
    $price = (int) (($p['sale_price'] ?? 0) ?: ($p['price'] ?? 0));
    if ($price <= 0 || empty($p['name'])) continue;
    $offers[] = ['@type' => 'Offer', 'price' => $price, 'priceCurrency' => 'NGN',
        'availability' => ((int) ($p['stock'] ?? 0)) > 0 || !empty($p['options']) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        'itemOffered' => array_filter(['@type' => 'Product', 'name' => (string) $p['name'], 'image' => empty($p['photo_path']) ? null : seo_photo((string) $p['photo_path'])])];
}
$ld = array_filter(['@context' => 'https://schema.org', '@type' => 'Store', 'name' => $name, 'url' => $url, 'image' => $image,
    'makesOffer' => $offers ?: null,
    'aggregateRating' => $ratings > 0 ? ['@type' => 'AggregateRating', 'ratingValue' => $rating, 'reviewCount' => $ratings, 'bestRating' => 5] : null]);

$head = '<title>' . seo_e($title) . "</title>\n"
    . '<meta name="description" content="' . seo_e($description) . "\">\n"
    . '<link rel="canonical" href="' . seo_e($url) . "\">\n"
    . "<meta property=\"og:type\" content=\"website\">\n<meta property=\"og:site_name\" content=\"ShopDesk\">\n"
    . '<meta property="og:url" content="' . seo_e($url) . "\">\n"
    . '<meta property="og:title" content="' . seo_e($name) . "\">\n"
    . '<meta property="og:description" content="' . seo_e($description) . "\">\n"
    . '<meta property="og:image" content="' . seo_e($image) . "\">\n"
    . "<meta name=\"twitter:card\" content=\"summary_large_image\">\n"
    . '<meta name="twitter:title" content="' . seo_e($name) . "\">\n"
    . '<meta name="twitter:description" content="' . seo_e($description) . "\">\n"
    . '<meta name="twitter:image" content="' . seo_e($image) . "\">\n"
    . '<script type="application/ld+json">' . json_encode($ld, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) . "</script>\n";

// take out the site-wide ones, then put the shop's in
$page = preg_replace([
    '#<title>.*?</title>\s*#s',
    '#<meta name="description"[^>]*>\s*#',
    '#<meta (property="og:|name="twitter:)[^>]*>\s*#',
    '#<link rel="canonical"[^>]*>\s*#',
    '#<script type="application/ld\+json">.*?</script>\s*#s',
], '', $page);
echo str_replace('</head>', $head . '</head>', $page);
