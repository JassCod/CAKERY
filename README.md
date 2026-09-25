# 🎂 Cakery — Bakery Management System

A complete back-office app for a cake shop / bakery. It is **free to run**: the website is published by **GitHub Pages** and the data lives in a free **Supabase** project (database, logins and invoice storage). Each staff member signs in with their own account, and each role sees only what it is allowed to.

## Features

| Module | What it does |
|---|---|
| **Login** | Animated login screen. The very first visit creates the owner account. Staff must change their temporary password on first login. |
| **Dashboard** | Different for each role. Money figures (month sales vs. last month, expenses, net, vendor pending, overdue bills, 30-day chart, expense breakdown) appear only for roles allowed to see them. Also shows today's production, upcoming cake orders and low stock. |
| **Production** | Kitchen staff log what they made today (e.g. *40 × Choco Pastry*). At the end of the day they enter how many sold and how many were wasted; leftovers are calculated automatically. Has a bulk "End-of-day counts" screen. |
| **Daily Closing** | End-of-day record of **Cash** and **Online** sales, opening cash, counted cash and cash handed over. The day's expenses are pulled in automatically, and it works out expected cash and any shortage or extra. Includes a calendar that shows closed and not-closed days. |
| **Expenses** | Every expense transaction with category, payment mode, vendor, reference and who recorded it. Filters, a per-category breakdown and CSV export. |
| **Items & Stock** | Every item in the shop is on record: products, ingredients and packaging. Stores cost and selling price, stock levels, reorder alerts, stock in/out/wastage and full movement history. |
| **Vendors** | Supplier list with **pending amount**, bills (credit purchases) with due dates and overdue flags, and payments. There is a running ledger. Every payment is also recorded as an expense automatically. |
| **Invoices & Docs** | Upload invoices, receipts and quotations (PDF, images, Word, Excel). Files are stored **in a folder per vendor** (`vendors/<id>-<vendor-name>/` in the Supabase Storage bucket `documents`) and can be viewed or downloaded. |
| **Cake Orders** | Custom cake bookings with delivery date and time, message on the cake, advance paid and balance. A kanban board tracks each order: Pending → In kitchen → Ready → Delivered. |
| **Monthly History** | Month-by-month history (6 to 36 months) and a full report for any month: cash vs. online, expenses by category, vendor billed/paid/pending, production sell-through, a day-by-day table, and CSV export and print. |
| **Staff & Access** | Add, edit and disable staff accounts. A **permission matrix** lets the owner switch any permission on or off for each role. |
| **Settings** | Shop name, currency, time zone, expense and item categories, **activity log** (every action is recorded), and a one-click **backup** of all records. |

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

## Put it live — free (about 10 minutes)

You need a free **Supabase** account and this GitHub repository. Nothing here costs money.

### 1. Create the database (Supabase)
1. Go to **https://supabase.com**, sign in with GitHub, and click **New project**. Choose any name, set a database password (keep it safe) and pick the region closest to you (e.g. *Mumbai*).
2. When the project is ready, open **SQL Editor → New query**. Copy **everything** from [`supabase/setup.sql`](supabase/setup.sql), paste it, and click **Run**. You should see *Success*.
3. Open **Project Settings → API** (called **API Keys** / **Data API** in some layouts) and copy two values:
   - **Project URL**, e.g. `https://abcdxyz.supabase.co`
   - **anon public** key, a long text starting with `eyJ…` (or `sb_publishable_…`)
4. Optional but recommended: **Authentication → Sign In / Providers** → turn **off** “Allow new users to sign up”. Staff accounts are created inside the app, so public sign-ups are never needed.

### 2. Publish the website (GitHub Pages)
1. In this GitHub repository open **Settings → Secrets and variables → Actions → Variables tab → New repository variable** and add:
   - `SUPABASE_URL` = your Project URL
   - `SUPABASE_ANON_KEY` = your anon public key
2. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Open the **Actions** tab → **Deploy to GitHub Pages** → **Run workflow**. (It also runs automatically on every push to `main`.)
4. When it finishes (green tick), your app is live at:

   **https://jasscod.github.io/CAKERY/**

5. Open the link. The first screen asks you to **create the owner account** (your name, username, password). Then add your staff under **Staff & Access** and share the link with them.

> GitHub Pages is free for **public** repositories. If the repository is private, make it public under **Settings → General → Danger Zone → Change visibility** (your data stays private — it is in Supabase, protected by logins, not in the code).
> Supabase's free plan pauses a project after about a week with **no** activity; daily use keeps it awake. If it ever pauses, click **Restore** in the Supabase dashboard.

### Is the public key safe?
Yes. The *anon* key only lets the browser call the functions in `setup.sql`. Every table is locked, and each function checks who is signed in and what their role allows before reading or changing anything. A cook cannot see money even by calling the database directly.

## Updating
- Change the code on `main`; GitHub Pages redeploys automatically.
- If `supabase/setup.sql` changed, run it again in the Supabase SQL Editor. It is safe to re-run and keeps your data.

## Backups
**Settings → Backup** downloads every record as a JSON file. Invoice files stay in the Supabase Storage bucket `documents`.

## Local preview & tests (optional, for developers)

```bash
npm install
npm start      # http://localhost:5173 — fill in public/config.js with your Supabase URL + anon key first
npm test       # runs supabase/setup.sql in an in-memory Postgres and checks every role's access
```

## Project structure

```
public/                 The website published to GitHub Pages (no build step)
  index.html, config.js   page shell + your Supabase URL/key
  js/app.js, js/login.js  router, layout, login / first-run setup
  js/backend.js           connects each screen to Supabase
  js/pages/*              one file per screen
  css/app.css             design system (light & dark)
  vendor/                 Supabase and Chart.js libraries
supabase/setup.sql      tables, roles & permissions, all business logic, storage rules
test/db.test.mjs        database tests (PGlite)
.github/workflows/pages.yml  test + deploy to GitHub Pages
```
