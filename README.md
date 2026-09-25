# 🎂 Cakery — Bakery Management System

A complete back-office app for a cake shop / bakery. It runs on one small server with a built-in SQLite database. Each staff member signs in with their own account, and each role sees only what it is allowed to.

## Features

| Module | What it does |
|---|---|
| **Login** | Animated login screen. Sessions use secure cookies. Accounts lock for a while after too many wrong passwords. Staff must change a temporary password on first login. |
| **Dashboard** | Different for each role. Money figures (month sales vs. last month, expenses, net, vendor pending, overdue bills, 30-day chart, expense breakdown) appear only for roles allowed to see them. Also shows today's production, upcoming cake orders and low stock. |
| **Production** | Kitchen staff log what they made today (e.g. *40 × Choco Pastry*). At the end of the day they enter how many sold and how many were wasted; leftovers are calculated automatically. Has a bulk "End-of-day counts" screen. |
| **Daily Closing** | End-of-day record of **Cash** and **Online** sales, opening cash, counted cash and cash handed over. The day's expenses are pulled in automatically, and it works out expected cash and any shortage or extra. Includes a calendar that shows closed and not-closed days. |
| **Expenses** | Every expense transaction with category, payment mode, vendor, reference and who recorded it. Filters, a per-category breakdown and CSV export. |
| **Items & Stock** | Every item in the shop is on record: products, ingredients and packaging. Stores cost and selling price, stock levels, reorder alerts, stock in/out/wastage and full movement history. |
| **Vendors** | Supplier list with **pending amount**, bills (credit purchases) with due dates and overdue flags, and payments. There is a running ledger. Every payment is also recorded as an expense automatically. |
| **Invoices & Docs** | Upload invoices, receipts and quotations (PDF, images, Word, Excel). Files are stored **in a folder per vendor** (`data/uploads/vendors/<id>-<vendor-name>/`) and can be viewed or downloaded. |
| **Cake Orders** | Custom cake bookings with delivery date and time, message on the cake, advance paid and balance. A kanban board tracks each order: Pending → In kitchen → Ready → Delivered. |
| **Monthly History** | Month-by-month history (6 to 36 months) and a full report for any month: cash vs. online, expenses by category, vendor billed/paid/pending, production sell-through, a day-by-day table, and CSV export and print. |
| **Staff & Access** | Add, edit and disable staff accounts. A **permission matrix** lets the owner switch any permission on or off for each role. |
| **Settings** | Shop name, currency, time zone, expense and item categories, **activity log** (every action is recorded), and a one-click **database backup**. |

Sales transactions are **not** stored one by one. Sales are recorded only as daily Cash and Online totals in the closing.

## Roles (default access — the owner can change any of it)

| | Owner | Manager | Cashier | Cook | Kitchen Staff | Customer Service |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Money on dashboard, reports | ✅ | ✅ | – | – | – | – |
| Daily closing | ✅ | ✅ | today/yesterday | – | – | – |
| Expenses | ✅ | ✅ | add + view | – | – | – |
| Vendors, bills | ✅ | ✅ | view, pay, upload | – | – | – |
| Items & prices | ✅ | ✅ | view | view + stock | view + stock | view |
| Production log | ✅ | ✅ | sold counts | log own | log own | sold counts |
| Cake orders | ✅ | ✅ | manage | status | status | manage |
| Staff accounts | ✅ | lower roles only | – | – | – | – |
| Roles, settings, activity log, backup | ✅ | – | – | – | – | – |

## Getting started

Requires **Node.js 22.13 or newer**, because it uses the built-in `node:sqlite`. No other database needs to be installed.

```bash
npm install
npm start                # http://localhost:3000
```

On first start it creates the owner account: **username `owner` / password `owner123`**. You will be asked to change the password right away. You can set a different first password with `CAKERY_OWNER_PASSWORD=... npm start`.

### Try it with demo data

```bash
npm run seed:demo        # 4 months of sample sales, expenses, vendors, production, orders
```

Demo staff logins (password `cakery123`): `manager`, `cashier`, `cook`, `kitchen`, `support`.

### Other commands

```bash
npm run dev                                   # auto-restart on code changes
npm test                                      # API + permission tests
npm run reset-password -- <username> <newpw>  # if someone is locked out
```

### Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `CAKERY_DATA_DIR` | `./data` | Where the database (`cakery.db`) and uploaded files are kept |
| `CAKERY_OWNER_PASSWORD` | `owner123` | Password for the auto-created owner (first run only) |
| `TRUST_PROXY` | – | Set to `1` behind a reverse proxy / HTTPS host (already set in the Dockerfile) |
| `NODE_ENV=production` | – | Sends cookies over HTTPS only (set `CAKERY_INSECURE_COOKIE=1` if you serve over plain HTTP on a LAN) |

## Put it live on Railway

1. Go to **https://railway.com**, click **Login → GitHub**, and choose a plan (Hobby, about $5/month).
2. Click **New Project → Deploy from GitHub repo** and pick **JassCod/CAKERY**. Railway finds `railway.json` and builds with the `Dockerfile`.
3. In the new service, open **Variables** and add `CAKERY_OWNER_PASSWORD` = the password you want for the `owner` login.
4. **Important: keep your data.** Right-click the service → **Attach Volume** and set the mount path to **`/var/data`**. The database and invoices are stored here; without a volume they are lost on every redeploy.
5. Open **Settings → Networking → Generate Domain**. You get a link like `https://cakery-production.up.railway.app`. That is your live app.
6. Open the link, sign in as `owner`, and add your staff under **Staff & Access**.

Every push to `main` redeploys automatically. Any other host works too: use the `Dockerfile`, mount a volume at `/var/data`, and set `CAKERY_OWNER_PASSWORD`.

### Backups

Download a full database backup from **Settings → Backup**, and also copy the `data/uploads` folder, which holds the invoice files. Everything lives in the `data/` directory.

## Project structure

```
server/            Express API
  db.js            schema, defaults, first-run owner
  permissions.js   roles + permission catalogue + default access
  auth.js          sessions, permission checks
  routes/          auth, users, items, production, closing, expenses, vendors, orders, reports, admin
public/            Single-page app (no build step)
  js/app.js        router + layout;  js/login.js  login screen;  js/pages/*  each screen
  css/app.css      design system (light & dark)
scripts/           demo seeder, password reset
test/              API tests (node --test)
```
