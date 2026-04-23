# ShootiX — Editorial Redesign

A visual redesign of the ShootiX site inspired by [tura.sa](https://www.tura.sa/) —
editorial layout, numbered section dividers, and a darker, more cinematic palette.
**All original features are preserved.** Only look-and-feel and markup structure changed.

## 🎨 New palette (dark navy + creamy white)

| Token | Value | Use |
|---|---|---|
| `--clr-bg` | `#0A1428` | Page background (deep navy) |
| `--clr-bg-2` | `#10223E` | Elevated sections |
| `--clr-bg-3` | `#162C4D` | Hover / card surface |
| `--clr-navy` | `#1A2B4C` | Original ShootiX navy (kept for continuity) |
| `--clr-cream` | `#F8F5E6` | Primary text / headings |
| `--clr-cream-soft` | `#E8E3CE` | Body text |
| `--clr-cream-dim` | `#8C8B7F` | Meta / eyebrow text |
| `--clr-accent` | `#C5A059` | Gold accents (rare, for highlights) |

## 🗂️ What's in this folder

| File | Purpose |
|---|---|
| `style.css` | All styling. Drop-in replacement for the old stylesheet. |
| `index.html` | Arabic (RTL) homepage, redesigned. |
| `en.html` | English (LTR) homepage, redesigned. |
| `script.js` | JS — same behavior, small cleanups. |
| `project-<slug>.html` × 6 | Arabic project detail pages. |
| `project-<slug>-en.html` × 6 | English project detail pages. |

Just drop these files into the repo root, replacing the originals. The `assets/`
folder is untouched — keep your existing logo (`photo-output.PNG`).

## ✅ Features preserved (nothing removed)

- Floating WhatsApp button (966537614446)
- Fixed navbar with scroll-state change
- Hero with background video
- About section with 100% / +50 / +200 stats
- All 6 services (photography, video, drone, editing, content, website)
- Portfolio grid linking to 6 project pages
- 3 testimonials
- Contact form wired to `formsubmit.co/shootix.sa@gmail.com`
- Arabic + English versions with language toggle
- Mobile navigation
- AOS scroll animations
- Project detail pages with hero, overview, 6-step journey, and gallery

## ✨ What changed (design only)

1. **Dark-first palette** — the whole site is now on a deep navy base with
   creamy-white type instead of the old beige-on-navy mix.
2. **Editorial section dividers** — each section now opens with a numbered
   eyebrow (`01`, `02`, `03`…) the same way tura.sa breaks up its page.
3. **Display serif for headlines** — Playfair Display is loaded alongside
   Cairo and Montserrat for a cinematic feel.
4. **Services are a 3×2 grid** (bordered cells) instead of the zig-zag
   timeline. Cleaner, calmer, more editorial.
5. **Portfolio items** are now 4:5 tiles with a dark gradient hover reveal.
6. **Testimonials** are dark cards with a large decorative quote mark.
7. **Contact form** is a single centered dark panel with underline-only inputs.
8. **Project pages** now open with a full-bleed hero image + meta tag,
   followed by an overview (sidebar of project facts + description),
   a numbered 6-step process grid, and a 3-up gallery. Same content,
   more magazine-like presentation.
9. **Navbar** is transparent at the top and blurs into a dark translucent
   bar on scroll (like tura.sa). Uppercase, tracked letters.

## 🔧 Quick local check

Open `en.html` or `index.html` directly in a browser. No build step needed.
