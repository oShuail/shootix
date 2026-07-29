# ShootiX — Site + Admin Panel + Staff Portal

The ShootiX website and the small product behind it:

1. **The public site** (Arabic + English) — cinematic, editorial, mobile-first.
2. **An admin panel** (`admin.html`) — portfolio images, team accounts, all
   receipts, and a dashboard.
3. **A staff portal** (`portal.html`) — employees issue branded client receipts
   and download them as PDF.
4. **A serverless API** (`lib/app.js`) backed by **Supabase**, so nothing is
   ever lost when the app restarts, redeploys or scales out.

---

## 🏛 Architecture

| Layer | What runs there | Why |
|---|---|---|
| **Cloudflare** | DNS for `shotix.space`, CDN, TLS | Fast worldwide, free TLS, DDoS protection |
| **Vercel** | Static site + `/api/*` serverless function | Zero-maintenance hosting, instant rollbacks |
| **Supabase** | Postgres (accounts, images, receipts) + Storage (photos, Excel ledger) | Managed Postgres that never gets wiped |

**Data never lives on the app server.** Earlier versions kept accounts and
receipts in JSON files inside the container and sessions in a memory `Map` —
both vanish on every restart, and on serverless they are effectively empty on
each cold start. Everything now lives in Supabase, and sessions are stateless
signed cookies, so a redeploy costs nobody their login or their data.

---

## 🚀 Setup

### 1. Supabase

1. Create an organization named **shotix**, then a project inside it
   (region: `eu-central-1`, or `me-central-1` for the Gulf).
2. Open **SQL Editor → New query**, paste all of
   [`supabase/schema.sql`](supabase/schema.sql) and run it once.
   It creates the tables, the atomic receipt-numbering function, row-level
   security and both storage buckets.
3. Copy from **Project Settings**:
   - **Data API → Project URL** → `SUPABASE_URL`
   - **API Keys → `service_role`** → `SUPABASE_SERVICE_ROLE_KEY` *(secret —
     server-side only, never ship it to the browser)*

### 2. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**, and
locally in a `.env` (see [`.env.example`](.env.example)):

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | ✅ | Your project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server-side database + storage access |
| `SESSION_SECRET` | recommended | Signs session cookies. Falls back to a value derived from the service key |
| `SHOOTIX_ADMIN_PASSWORD` | recommended | Password for the auto-created `admin` account on first run |

### 3. Deploy

Push to the repository — Vercel builds and deploys automatically.

### 4. Domain (`shotix.space` on Cloudflare)

In **Vercel → Project → Settings → Domains**, add `shotix.space` and
`www.shotix.space`. Then in **Cloudflare → DNS**:

| Type | Name | Content | Proxy |
|---|---|---|---|
| `A` | `@` | `76.76.21.21` | DNS only (grey cloud) |
| `CNAME` | `www` | `cname.vercel-dns.com` | DNS only (grey cloud) |

> Keep the records **grey-clouded** (DNS only). Vercel issues and renews its own
> TLS certificate; proxying through Cloudflare's orange cloud on top of that
> causes redirect loops unless Cloudflare's SSL mode is **Full (strict)**.

Then set **SSL/TLS → Overview → Full (strict)** and turn on **Always Use HTTPS**.

---

## 🧑‍💻 Running locally

```bash
npm install
cp .env.example .env      # fill in your Supabase values
npm start                 # → http://localhost:3000
npm run check             # self-tests (passwords, sessions, Excel, routes)
```

| URL | What |
|---|---|
| `/` | Arabic homepage |
| `/en.html` | English homepage |
| `/admin.html` | Admin panel (admins only) |
| `/portal.html` | Staff portal (employees + admins) |
| `/api/health` | Backend + database status |

**First run** creates the admin account `admin` with `SHOOTIX_ADMIN_PASSWORD`
(default `shootix-admin`). **Change it immediately** — Admin panel → الإعدادات.

---

## 👥 Accounts

- **Admins** — everything: site images, team, all receipts, dashboard.
- **Employees** — staff portal only: create receipts, download PDFs, see *their
  own* history. They cannot touch site images or other people's receipts.

Admins manage the team in **الفريق**: add a member (name, username, job title,
phone, role), generate a password, reset a password, suspend/reactivate, or
delete. Passwords are hashed with scrypt. The panel refuses to remove or demote
the last remaining admin, so the studio can never be locked out of its own panel.

## 🖼 Portfolio images

Admin panel → **صور الموقع**. Drag in an image (up to 15 MB), give it an
Arabic + English title, pick a section, optionally mark it **featured** so it
leads that section. The image appears immediately in the homepage portfolio and
the matching project page.

Uploads go **straight from the browser to Supabase Storage** through a one-shot
signed URL, so large photos are not limited by the ~4.5 MB serverless request
cap. The server then verifies the stored file's magic bytes before recording it
— a file merely *named* `.jpg` is rejected.

## 🧾 Receipts

Employees fill in client, project, date, payment method, payment status, line
items, optional discount and 15% VAT, plus notes. Totals update live. Saving
assigns a serial number (`SHX-2026-0001`, …) reserved atomically in Postgres, so
two people saving in the same second can never collide. **"حفظ + تحميل PDF"**
opens the print dialog with a clean bilingual branded receipt.

### 📊 Excel ledger

Every create, status change and delete rewrites a running workbook — one row per
receipt with number, date, client, phone, email, project, payment method,
status, an item summary, item count, subtotal, discount, VAT, total, notes, who
issued it and when.

- **Download** from the Excel button in the admin panel or staff portal
  (`GET /api/receipts.xlsx`). Admins get every receipt; employees get their own.
- A master copy is kept in Supabase Storage, refreshed on every change.
- Written by a dependency-free writer (`lib/xlsx.js`) — a real Office Open XML
  workbook (RTL sheet, bold header, numeric totals) that opens in Excel, Numbers
  and Google Sheets.

---

## 🗂 Files

| File | Purpose |
|---|---|
| `lib/app.js` | The API: auth, team, gallery, receipts, stats |
| `lib/supabase.js` | Supabase Postgres + Storage client (native fetch) |
| `lib/auth.js` | scrypt passwords, stateless signed session cookies |
| `lib/ledger.js` | Builds and syncs the Excel ledger |
| `lib/xlsx.js` | Dependency-free `.xlsx` writer |
| `api/index.js` | Vercel serverless entry point |
| `server.js` | Local dev server (same app) |
| `supabase/schema.sql` | One-time database setup |
| `scripts/check.js` | Self-tests — `npm run check` |
| `admin.html` / `portal.html` | The two panels |
| `panel.js` / `panel.css` | Shared panel runtime and styles |
| `style.css` / `script.js` | Public site |
| `index.html` / `en.html` | Homepages (AR / EN) |
| `project-*.html` | 6 project pages × 2 languages |

## 🎨 Palette

| Token | Value | Use |
|---|---|---|
| `--clr-bg` | `#0A1428` | Page background (deep navy) |
| `--clr-bg-2` | `#10223E` | Elevated sections |
| `--clr-bg-3` | `#162C4D` | Hover / card surface |
| `--clr-cream` | `#F8F5E6` | Primary text / headings |
| `--clr-cream-soft` | `#E8E3CE` | Body text |
| `--clr-cream-dim` | `#8C8B7F` | Meta / eyebrow text |
| `--clr-accent` | `#C5A059` | Gold accents |
