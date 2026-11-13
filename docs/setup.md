# Setup

This guide takes a new Supabase project to a working ShopDesk backend. Steps 1 to 3 are required; the rest add notifications and email.

## 1. Create the database

1. In the Supabase dashboard, open **SQL Editor → New query**.
2. Paste the whole of `supabase/schema.sql` and run it.

The script is idempotent: it can be run again at any time. A database created from an older version of the schema is brought up to date either by running `schema.sql` again or by running the files in `supabase/updates/` in order.

`schema.sql` creates the two storage buckets as well: `product-photos` (public) and `order-photos` (private).

## 2. Configure the app

Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the publishable key) and `VITE_PRIVACY_EMAIL`. The secret key must never appear in this file or anywhere in the client.

## 3. Create the admin account

1. Start the app and sign in once with the admin's email address. This creates the account.
2. In `supabase/owner-lock.sql`, replace `you@example.com` with that address and run the file in the SQL Editor.

The owner lock makes that account the only admin: `is_admin()` is pinned to its id, and a trigger refuses any other row in `admins`. Run `owner-lock.sql` again after every full run of `schema.sql`.

The admin console is at `/admin`. It has its own sign-in and never creates accounts.

## 4. Authentication

- **Authentication → URL Configuration:** set the Site URL to the production origin and add `https://<domain>/**` and `http://localhost:5173/**` as redirect URLs.
- **Authentication → Emails → SMTP Settings:** configure a custom SMTP sender. Supabase's built-in sender is limited to a few emails per hour.
- **Authentication → Emails → Templates:** use `supabase/email/sign-in-code.html` for *Magic link or OTP* and `supabase/email/welcome-code.html` for *Confirm sign up*.
- **Authentication → Rate Limits:** raise the hourly email limit to match expected sign-ins.

## 5. Push notifications

1. **Edge Functions → Deploy a new function**, named `push`, with the contents of `supabase/functions/push/index.ts`.
2. In the function's settings, turn **Enforce JWT verification** off. The function needs no API keys: it reaches the database through `SUPABASE_DB_URL`. It generates its VAPID key pair on first use.

Devices that enable alerts in the app receive a push for each event. Open pages update through Supabase Realtime.

## 6. Scheduled jobs

Enable the **pg_cron** and **pg_net** extensions (**Database → Extensions**), then run `schema.sql` once more. It registers two jobs:

| Job | Schedule | Purpose |
|---|---|---|
| `shopdesk-tidy` | every 10 minutes | Cancels orders unpaid for 48 hours and returns their stock; closes refunds left unanswered for 48 hours |
| `shopdesk-email` | every 5 minutes | Asks the `push` function to send email digests that are due |

The email job posts to the project's own function URL. When setting up a different Supabase project, update that URL in the scheduling block at the end of `schema.sql`.

Without the extensions the same work still runs opportunistically whenever a shop opens its app or an order is placed.

## 7. Email digests

When something happens and the recipient has not opened ShopDesk for 10 minutes, they receive one email listing what they missed. Limits: one email per 30 minutes, 10 per day, nothing older than 24 hours. Every email carries a one-click unsubscribe link.

Set these secrets under **Edge Functions → Secrets**:

| Secret | Value |
|---|---|
| `SMTP_HOST` | SMTP server (defaults to Gmail's when omitted) |
| `SMTP_PORT` | Optional, defaults to `465`. The server must accept implicit TLS |
| `SMTP_USER` | Mailbox username |
| `SMTP_PASS` | Mailbox password |
| `EMAIL_FROM` | Optional sender address, defaults to `SMTP_USER` |

The sending domain should have valid SPF and DKIM records.

## 8. Pay online and ShopDesk Delivery

Both are off until switched on in **Admin → Payments & delivery**, and the app hides them while they are off.

- **Pay online (Paystack).** The customer pays once on the order page. The goods money settles to the shop's own bank account through a Paystack subaccount, created from the bank details the shop already gave (OPay, Moniepoint, Kuda or PalmPay). When the order goes with ShopDesk Delivery, the delivery fee goes to ShopDesk's Paystack balance in the same payment. ShopDesk never holds a shop's money. Paystack's fee (1.5% + ₦100, the ₦100 waived under ₦2,500, at most ₦2,000) and ShopDesk's own fee (₦50 by default, set in Admin) are added on top for the customer who chooses to pay online, so the shop gets the full amount; paying the shop by transfer stays free. Admin can change who pays Paystack's fee.
- **ShopDesk Delivery (Shipbubble).** ShopDesk has the one courier account and pays couriers from its Shipbubble wallet. A shop gets courier prices on a new order, picks one (its price becomes the delivery fee, plus the margin set in Admin), and books the pickup once the order is paid and packed. The shop and the customer follow the delivery on the order. When the customer paid the shop by transfer, the delivery fee goes on the shop's delivery bill in Admin.

Setup:

1. Run `supabase/updates/016.sql` (or the full `schema.sql`).
2. **Edge Functions → Deploy a new function**, named `money`, with the contents of `supabase/functions/money/index.ts`. Turn **Enforce JWT verification** off: the function checks who is asking itself, and the webhooks carry no sign-in.
3. Set these secrets under **Edge Functions → Secrets**. Use test keys while testing and swap in live keys once the accounts are approved:

| Secret | Value |
|---|---|
| `PAYSTACK_SECRET_KEY` | Paystack secret key (`sk_test_…`, later `sk_live_…`) |
| `SHIPBUBBLE_API_KEY` | Shipbubble API key (`sb_sandbox_…`, later `sb_prod_…`) |

4. Set the webhook URLs:
   - Paystack (**Settings → API Keys & Webhooks**): `https://<project>.supabase.co/functions/v1/money?hook=paystack`
   - Shipbubble (**Settings → Webhooks**): `https://<project>.supabase.co/functions/v1/money?hook=shipbubble`
5. In Paystack, leave **Settings → Preferences → Pass fees to customers** off: the money function already adds the fee.
6. Top up the Shipbubble wallet, then switch each one on in **Admin → Payments & delivery**. The page shows whether the keys are test or live and the wallet balance.

The money function's checks run in `tests/functions/money.mjs` (after `tests/db/run.sh`), with Paystack, Shipbubble and sign-in faked.

## 9. Hardening checklist

- Enable two-factor authentication on the Supabase account and on the admin's mailbox.
- Disable the legacy JWT-based API keys (**Project Settings → API Keys**). ShopDesk uses only the publishable key.
- Run `select purge_customer_details(180);` monthly to remove customer details from old orders.
