<?php
// /sitemap.xml: the pages Google should know about, with every open shop (shops_near, the same list as Shops near you),
// kept for an hour.
declare(strict_types=1);
require __DIR__ . '/seo-lib.php';

header('Content-Type: application/xml; charset=utf-8');
$base = 'https://shopdesk.com.ng';
$urls = [[$base . '/', 'daily', '1.0'], [$base . '/shops', 'daily', '0.8'], [$base . '/terms', 'monthly', '0.3'],
    [$base . '/privacy', 'monthly', '0.3'], [$base . '/prohibited', 'monthly', '0.3']];
$shops = seo_rpc('shops_near', [], 3600);
foreach (is_array($shops) ? $shops : [] as $s) {
    if (!empty($s['slug']) && preg_match('/^[a-z0-9-]+$/', (string) $s['slug'])) $urls[] = [$base . '/' . $s['slug'], 'daily', '0.9'];
}
echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
foreach ($urls as [$loc, $freq, $prio]) {
    echo '  <url><loc>' . seo_e($loc) . '</loc><changefreq>' . $freq . '</changefreq><priority>' . $prio . "</priority></url>\n";
}
echo "</urlset>\n";
