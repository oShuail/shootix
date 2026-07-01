# ShootiX — Cinematic Site + Admin Panel + Staff Portal

The ShootiX website, upgraded from a static page into a small full product:

1. **The public site** (Arabic + English) with a more cinematic, editorial look —
   same navy/cream/gold palette, more atmosphere.
2. **An admin panel** (`admin.html`) where admins upload and manage the portfolio
   images that appear on the live site.
3. **A staff portal** (`portal.html`) where employees log in, fill in a few fields,
   and issue branded client receipts as PDF.
4. **A tiny Node.js backend** (`server.js`) that powers accounts, image uploads and
   receipts. Only one dependency (Express).

## 🚀 Running

```bash
npm install
npm start          # → http://localhost:3000
```

| URL | What |
|---|---|
| `/` or `/index.html` | Arabic homepage |
| `/en.html` | English homepage |
| `/admin.html` | Admin panel (admins only) |
| `/portal.html` | Staff portal (employees + admins) |

**First run:** the server creates the admin account `admin` / `shootix-admin`
(or the value of the `SHOOTIX_ADMIN_PASSWORD` env var) and prints it to the
console. **Log in and change it immediately** (Admin panel → الإعدادات).

> The static pages still work without the server (e.g. GitHub Pages) — the
> dynamic features simply switch off and the site falls back to its built-in
> images. Accounts, uploads and receipts need the Node server running on a host
> such as Render, Railway, or any VPS.

## 🎨 Palette (unchanged)

| Token | Value | Use |
|---|---|---|
| `--clr-bg` | `#0A1428` | Page background (deep navy) |
| `--clr-bg-2` | `#10223E` | Elevated sections |
| `--clr-bg-3` | `#162C4D` | Hover / card surface |
| `--clr-cream` | `#F8F5E6` | Primary text / headings |
| `--clr-cream-soft` | `#E8E3CE` | Body text |
| `--clr-cream-dim` | `#8C8B7F` | Meta / eyebrow text |
| `--clr-accent` | `#C5A059` | Gold accents |

## ✨ Design upgrades (v3 cinematic layer)

- **Film grain** overlay across the whole site (subtle, animated).
- **Ghost typography** — a huge outlined "SHOOTIX" drifting behind the hero.
- **Gold-gradient headline** highlight in the hero.
- **Service marquee** — an endless scrolling strip of services under the hero
  (italic serif alternating with outlined type, spinning gold stars).
- **Custom cursor** — gold dot + trailing ring that grows over links (desktop
  only, respects `prefers-reduced-motion`).
- **Scroll progress hairline** in gold at the top of the page.
- **Animated stat counters** (100% / +50 / +200 count up on scroll).
- **Richer hovers** — gold sweep lines on portfolio cards and process steps,
  titles that shift and tint gold.
- Custom scrollbar + gold text selection.

All previous features preserved: WhatsApp button, hero video, services, portfolio
with 6 project pages, testimonials, contact form (formsubmit.co), AR/EN toggle,
mobile nav, AOS animations, lightbox gallery.

## 🖼️ Image management (admins only)

Admin panel → **صور الموقع**: drag & drop an image (≤ 8 MB), give it an Arabic +
English title, pick a section (cars, food & hospitality, real estate, events,
products, fashion) and upload. The image immediately appears:

- in that section of the homepage portfolio (Arabic and English), and
- in the matching project page gallery (with lightbox support).

Deleting an image in the panel removes it from the site. Files are stored in
`assets/uploads/`, metadata in `data/gallery.json`.

## 👥 Accounts

- **Admins** — full access: site images, team accounts, all receipts, settings.
- **Employees** — staff portal only: create receipts, download PDFs, view their
  own history, change their password. *They cannot touch site images.*

Admins create employee accounts in Admin panel → **حسابات الفريق** (name,
username, password, role). Passwords are hashed with scrypt; sessions are
HttpOnly cookies.

## 🧾 Receipts (staff portal)

Employees fill in: client name/phone, project, date, payment method, line items
(description × qty × price), optional discount, 15% VAT toggle, and notes.
The portal computes totals live, saves the receipt with an automatic serial
number (`SHX-2026-0001`, …), and **"حفظ + تحميل PDF"** opens the browser's
print dialog with a clean bilingual (AR/EN) branded receipt — save as PDF and
send it to the client. Every receipt can be re-downloaded from **إيصالاتي**;
admins see all receipts from all employees.

## 🗂️ Files

| File | Purpose |
|---|---|
| `server.js` | Express backend: auth, users, gallery, receipts |
| `admin.html` | Admin panel (images, team, receipts overview, settings) |
| `portal.html` | Staff portal (receipt creator + PDF, history, settings) |
| `panel.css` | Shared styles for both panels + printable receipt |
| `style.css` | Site styles incl. the new cinematic layer |
| `script.js` | Site JS incl. cursor, counters, marquee, dynamic gallery |
| `index.html` / `en.html` | Homepages (AR / EN) |
| `project-*.html` | 6 project pages × 2 languages |
| `data/` *(runtime, gitignored)* | users.json, gallery.json, receipts.json |
| `assets/uploads/` *(runtime, gitignored)* | Images uploaded via the panel |
