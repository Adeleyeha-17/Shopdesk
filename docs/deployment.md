# Deployment

ShopDesk is a static single-page app backed by Supabase. A release has two parts, always in this order:

1. **Database:** apply any new file in `supabase/updates/`.
2. **Site:** build and publish `dist/`.

The order matters. A new client may call functions that only exist after the update, while every update is written so that the previous client keeps working against it.

## Database updates

Each file in `supabase/updates/` upgrades a live database by one step and is safe to run more than once. Run the files not yet applied, in numerical order, from the Supabase SQL Editor.

`supabase/schema.sql` always describes the full, current database. A fresh install from `schema.sql` and an older database with every update applied end up identical.

| Update | Contents |
|---|---|
| `007` | Order chat, notifications, refunds and fair-use rules, shop archives, email digests |
| `008` | Product options, sale prices, product editing, delivery map pins |
| `009` | Deleting products |
| `010` | Ordered items in the admin support view |

## Building

```bash
npm ci
npm run build
```

The build reads `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_PRIVACY_EMAIL` from `.env` (or the environment) and writes the site to `dist/`.

## Publishing

Any static host works, provided every path falls back to `index.html`.

**cPanel / Apache.** Upload the contents of `dist/` to the site's document root, including the hidden `.htaccess`, which provides the fallback and cache headers. Uploading a zip of `dist/` and extracting it in File Manager is the simplest route.

**Vercel.** `vercel.json` contains the equivalent rewrite. Set the three environment variables in the project settings.

`index.html` is served without caching and asset file names are content-hashed, so clients pick up a new release on their next load.

## Automatic builds and publishing

`.github/workflows/site.yml` runs on every push to `main` and on every pull request:

1. Installs dependencies and checks that the three `VITE_` settings are present and that the key is the publishable one.
2. Builds the site and confirms the bundle contains the Supabase URL, so a build without settings can never be published.
3. Keeps the built site for 30 days as the `shopdesk-site` artifact on the run's page.
4. On `main` only, uploads it to the web server over FTPS, once publishing is switched on.

**One-time setup** (Settings > Secrets and variables > Actions):

| Kind | Name | Value |
|---|---|---|
| Variable | `VITE_SUPABASE_URL` | Project URL |
| Variable | `VITE_SUPABASE_ANON_KEY` | Publishable key (`sb_publishable_...`) |
| Variable | `VITE_PRIVACY_EMAIL` | Address shown on the privacy page |
| Variable | `DEPLOY_TARGET` | `ftp` to switch publishing on |
| Secret | `FTP_SERVER` | FTP host name |
| Secret | `FTP_USERNAME` | An FTP account limited to the site's document root |
| Secret | `FTP_PASSWORD` | Its password |

Without `DEPLOY_TARGET`, every push is still built and checked, and the artifact can be uploaded by hand.

Database updates are never applied automatically. Run them from the SQL Editor before pushing a site change that needs them.

## After a release

- Open a shop page, the vendor app and `/admin`, and confirm each loads.
- Place a test order if the release touched ordering or stock.
- If the Edge Function changed, redeploy `supabase/functions/push/index.ts` and confirm JWT verification is still off.
