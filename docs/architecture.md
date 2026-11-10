# Architecture

## Overview

```
Browser (React SPA)
   │  supabase-js: Auth (email OTP), PostgREST, Storage, Realtime
   ▼
Supabase
   ├─ PostgreSQL ── tables + row-level security + functions (supabase/schema.sql)
   ├─ Storage ───── product-photos (public), order-photos (private)
   ├─ Realtime ──── notifications and chat messages
   └─ Edge Function "push" ── Web Push and SMTP email
                    ▲
        pg_cron / pg_net (scheduled jobs)
```

There is no application server. The client talks to Supabase directly, and everything that must be trusted lives in the database.

## Client

`src/App.jsx` maps paths to pages without a routing library:

| Path | Page |
|---|---|
| `/` | Vendor app (sign-in, shop setup, then Sales, Orders, Stock and Shop tabs) |
| `/<shop>` | A shop's public page and cart |
| `/<shop>/checkout` | Checkout for that shop |
| `/o/<token>` | A single order, addressed by an unguessable token |
| `/orders` | A customer's order history and saved details |
| `/admin` | Admin console |
| `/privacy`, `/email-off` | Privacy notice, email unsubscribe |

State is local to each page. The cart is kept per shop in `localStorage` (`src/customer/cart.js`) and is reconciled against current stock whenever it is restored.

`src/lib/database.js` wraps `fetch` with timeouts and retries for idempotent reads. `src/lib/errors.js` turns every failure (network, auth, PostgREST, Postgres and the app's own rule violations) into a plain sentence, so raw errors never reach the interface.

## Database

`supabase/schema.sql` is the single source of truth. It is organised as: tables, upgrades for older databases, helpers, row-level security, then functions grouped by actor (customers, vendors, admin), realtime, scheduled jobs, function grants and storage policies.

### Security model

- **Row-level security** is enabled on every table. A vendor can read only rows belonging to their own shop. Customers and anonymous visitors cannot read any table directly.
- **Functions.** Reads for customers (`get_storefront`, `get_order_public`) and all state changes (`place_order`, `save_product`, `hand_to_rider`, …) are `SECURITY DEFINER` functions that check the caller and validate input. Violations are raised as exceptions with a user-facing message (`P0001`), which the client displays as written.
- **Grants.** Execute rights are revoked from `public` and `anon` and granted per function. Internal helpers are not callable by clients.
- **Column grants.** Vendors may update only the `active` flag on products directly; every other change goes through `save_product`.
- **Admin.** A single owner account, pinned by `supabase/owner-lock.sql`. Admin functions return aggregate data. Customer details are returned only by `admin_support_view`, which requires a written reason and writes to `audit_log`.
- **One email, one role.** An account that owns a shop cannot place orders, and an account that has placed orders cannot open a shop.

### Orders

An order moves through `awaiting → (part) → paid → out → delivered`, or to `cancelled`. Stock is reserved inside `place_order` under row locks, so concurrent orders cannot oversell, and is returned by `restock` when an order is cancelled. Each order line stores the product name, option, price and photo at the time of ordering, so later edits or deletions never alter past orders.

A product either has its own price and stock or a list of options (`product_options`), each with a price, optional sale price and stock. For a product with options, a trigger keeps the product's price (the lowest option price) and stock (the sum) in step.

### Disputes and fair use

Customers can report one problem per order within a time window. The shop has 48 hours to respond before the case escalates to the admin, who can order a refund. Rate limits, account blocking and automatic expiry of unpaid orders are implemented in the same functions. See [rules.md](rules.md).

### Data retention

`purge_customer_details(days)` blanks names, phone numbers, addresses and map pins on closed orders older than the given age. Deleting a shop first stores a private archive for the admin.

## Notifications

Every relevant change inserts a row into `notifications` through `notify()`. From there:

1. **Realtime** delivers it to open pages.
2. **Web Push.** The client calls the `push` Edge Function, which sends to the recipient's registered devices. `public/sw.js` displays the notification and opens the right page.
3. **Email digest.** `email_claim()` selects recipients who have unseen notifications older than 10 minutes and have not been active since, applying the per-user limits. The function renders one HTML and plain-text email per recipient and sends it over SMTP with implicit TLS. Failed sends are released with `email_unclaim()` and retried later.

The Edge Function connects to Postgres directly and holds no state besides its VAPID keys, which are stored in the database.

## Third-party services

- **OpenStreetMap Nominatim** for reverse geocoding when a customer shares their location (`src/lib/location.js`). The request is made only on the customer's tap and failure is non-fatal.
- **Google Maps** links for opening a delivery pin. No API key is involved.
