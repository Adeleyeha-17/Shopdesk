// Builds the ShopDesk demo: the real app (src/) with the in-browser sample database (demo/database.js) and alerts
// (demo/alerts.js) swapped in. Used for trying the app without a backend and by the
// browser tests (tests/e2e).
//   npm run build:demo   writes demo/dist; open demo/dist/demo/index.html through any static server
// The app's code isn't changed on disk; the few lines that touch the web address or downloads are
// pointed at the demo while building (see FIXES), and the build stops if any of them can't be found.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const FIXES = [
  // [file, text in the app, demo replacement, how many times it must appear]
  ['src/lib/motion.js', 'window.location.pathname', 'window.__demo.path', 1],
  ['src/lib/helpers.js', "window.history.pushState({ k, from }, '', path);", 'window.__demo.go(path);', 1],
  ['src/lib/helpers.js', "window.history.replaceState({ k }, '', path);", 'window.__demo.go(path);', 1],
  // the rider link opens the rider page inside the demo
  ['src/vendor/RiderLive.jsx', 'const demoOpen = null;', 'const demoOpen = (l) => (window.__demo.go(new URL(l).pathname), window.dispatchEvent(new Event("popstate")), window.scrollTo(0, 0));', 1],
  // Pay online opens a pretend checkout instead of Paystack's page
  ['src/customer/OrderPage.jsx', 'window.location.assign(r.url);', 'window.__demoPay(r.url, () => (setPaying(false), load()));', 1],
  [
    'src/vendor/VendorApp.jsx',
    "window.history.replaceState(window.history.state, '', '#' + tab);",
    'window.__demo.setHash(tab);',
    1,
  ],
];

function demoPlugin() {
  return {
    name: 'shopdesk-demo',
    enforce: 'pre',
    transform(code, id) {
      const rel = path.relative(root, id.split('?')[0]).split(path.sep).join('/');
      if (!rel.startsWith('src/')) return null;
      let out = code;
      for (const [file, from, to, n] of FIXES) {
        if (file !== rel) continue;
        const found = out.split(from).length - 1;
        if (found !== n) throw new Error(`demo build: expected ${n}× "${from}" in ${file}, found ${found}`);
        out = out.split(from).join(to);
      }
      // Links the app shows (your order link, order tracking links) use the real address.
      out = out.split('window.location.origin').join('"https://shopdesk.com.ng"');
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig({
  root,
  base: './',
  plugins: [demoPlugin(), react()],
  resolve: {
    alias: [
      { find: /^(?:\.\.?\/)+(?:lib\/)?database\.js$/, replacement: path.join(here, 'database.js') },
      { find: /^(?:\.\.?\/)+(?:lib\/)?alerts\.js$/, replacement: path.join(here, 'alerts.js') },
    ],
  },
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    modulePreload: false,
    rollupOptions: { input: path.join(here, 'index.html') },
  },
});
