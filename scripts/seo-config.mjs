// After the build: writes dist/seo-config.php with the database address and the publishable key (the same ones already in
// the app's JavaScript), for shop.php and sitemap.php. The secret key never goes here.
import { writeFileSync } from 'node:fs';

const url = process.env.VITE_SUPABASE_URL || '';
const key = process.env.VITE_SUPABASE_ANON_KEY || '';
if (/^sb_secret_|service_role/.test(key)) throw new Error('seo-config: only the publishable key belongs in the site.');
const q = (s) => "'" + String(s).replace(/[\\']/g, (c) => '\\' + c) + "'";
writeFileSync('dist/seo-config.php', `<?php\nreturn ['url' => ${q(url)}, 'key' => ${q(key)}];\n`);
console.log(url && key ? 'seo-config.php written' : 'seo-config.php written without a database (shop pages use the plain app page)');
