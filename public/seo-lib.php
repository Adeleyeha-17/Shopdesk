<?php
// Shared by shop.php and sitemap.php: calls a public database function the same way the app does (with the publishable
// key from seo-config.php, written when the site is built) and keeps the answer for a while, so Google and link previews
// don't wait on the database. Never served on its own (.htaccess).
declare(strict_types=1);

function seo_config(): ?array
{
    static $c = false;
    if ($c === false) {
        $f = __DIR__ . '/seo-config.php';
        $c = is_file($f) ? include $f : null;
    }
    return is_array($c) && !empty($c['url']) && !empty($c['key']) ? $c : null;
}

// The function's answer (decoded JSON), or null when it can't be reached. ttl: seconds to keep it.
function seo_rpc(string $fn, array $args, int $ttl)
{
    $c = seo_config();
    if (!$c) return null;
    $file = sys_get_temp_dir() . '/shopdesk-seo-' . md5($c['url'] . $fn . json_encode($args)) . '.json';
    if (is_file($file) && time() - (int) filemtime($file) < $ttl) {
        $kept = json_decode((string) @file_get_contents($file), true);
        if (is_array($kept) && array_key_exists('v', $kept)) return $kept['v'];
    }
    $url = rtrim($c['url'], '/') . '/rest/v1/rpc/' . $fn;
    $body = json_encode((object) $args);
    $headers = ['Content-Type: application/json', 'apikey: ' . $c['key'], 'Authorization: Bearer ' . $c['key']];
    $status = 0;
    $out = false;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 4, CURLOPT_CONNECTTIMEOUT => 3]);
        $out = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $body,
            'timeout' => 4, 'ignore_errors' => true]]);
        $out = @file_get_contents($url, false, $ctx);
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) $status = (int) $m[1];
    }
    if ($out === false || $status !== 200) return null;
    $v = json_decode((string) $out, true);
    @file_put_contents($file, json_encode(['v' => $v]), LOCK_EX);
    return $v;
}

function seo_e($s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function seo_photo(?string $path): string
{
    $c = seo_config();
    if (!$c || !$path) return 'https://shopdesk.com.ng/og.jpg';
    return rtrim($c['url'], '/') . '/storage/v1/object/public/product-photos/' . implode('/', array_map('rawurlencode', explode('/', $path)));
}
