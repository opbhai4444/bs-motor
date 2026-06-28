# BS Motors — Project Context

## What this project is
BS Motors is a **dual-panel spare parts e-commerce + business management system** for a real Indian auto-parts shop. It has two completely separate user-facing sides:

1. **Consumer Shop** — customers browse parts, log in via Phone OTP (Firebase) or Google, add to cart, place orders, write reviews.
2. **Admin Panel** — the shop owner manages inventory, purchases, orders, accounts (double-entry ledger, Tally-style), customers, and enquiries.

The project runs entirely as a **local Node.js server** on the shop owner's Windows PC. There is no cloud deployment — `localhost:3000` is the production URL.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (CommonJS, no TypeScript) |
| Framework | Express 4 |
| Database | SQLite via `better-sqlite3` — **two separate files**: `admin.db` and `consumer.db` |
| Auth | `express-session` (cookie, 7-day) + Firebase Auth (phone OTP + Google sign-in, compat SDK v10) |
| Password hashing | `bcryptjs` |
| File uploads | `multer` (part images → `public/uploads/`) |
| Environment | `dotenv` (`.env` file, never committed) |
| Frontend | Vanilla JS, no framework, no build step |
| CSS | Single file `public/css/style.css`, custom design system |
| i18n | `locales/en.json` + `locales/hi.json` (English / Hindi toggle) |
| Firebase | Lazy-loaded CDN (`gstatic.com`), configured in `public/js/firebase-config.js` |

---

## Database layout

### `database/admin.db`
Tables: `users` (admins only), `parts`, `orders`, `order_items`, `purchases`, `purchase_items`, `accounts`, `journal_entries`, `journal_lines`, `stock_groups`, `brands`, `enquiries`

### `database/consumer.db`
Tables: `users` (consumers only), `cart`, `ratings`, `otps`

Both databases are cross-attached at startup via SQLite `ATTACH DATABASE` so cross-DB SQL JOINs work:
- On the `adb` connection → `cdb.users`, `cdb.cart`, `cdb.ratings` refer to consumer DB
- On the `cdb` connection → `adb.parts`, `adb.orders` refer to admin DB

The entry point for both is `db/index.js` which exports `{ adb, cdb }`.

---

## Project tree

```
bsmotor/
├── server.js                  # Express entry point, session, route mounting
├── .env                       # FAST2SMS_KEY (never commit)
├── package.json
│
├── db/
│   └── index.js               # Creates admin.db + consumer.db, attaches each to the other, seeds defaults
│
├── routes/
│   ├── auth.js                # /api/auth — login, register, OTP, Firebase-login, logout, /me
│   ├── admin.js               # /api/admin — inventory, orders, customers, purchases, accounts, reports
│   └── consumer.js            # /api/consumer — parts browse, cart, orders, ratings, profile, enquiry
│
├── locales/
│   ├── en.json
│   └── hi.json
│
├── public/
│   ├── landing.html           # Marketing landing page
│   │
│   ├── css/
│   │   └── style.css          # Single global stylesheet (dark-navy + gold accent theme)
│   │
│   ├── js/
│   │   ├── api.js             # Global API helper (fetch wrapper, toast, modal utilities)
│   │   ├── consumer-nav.js    # Consumer header/nav, login overlay (OTP + Google + email), cart badge
│   │   ├── admin-nav.js       # Admin sidebar, session guard
│   │   ├── firebase-config.js # Firebase app init (sets window._firebaseReady)
│   │   └── i18n.js            # Language switcher (en/hi)
│   │
│   ├── admin/
│   │   ├── index.html         # Dashboard (stats, recent orders)
│   │   ├── inventory.html     # Parts CRUD + image upload
│   │   ├── orders.html        # Order list + status update
│   │   ├── customers.html     # Customer list + detail
│   │   ├── purchases.html     # Stock intake
│   │   ├── accounts.html      # Chart of accounts
│   │   ├── journal.html       # Double-entry journal
│   │   ├── reports.html       # Sales, P&L, stock reports
│   │   ├── enquiries.html     # Contact enquiries
│   │   └── login.html         # Admin email+password login
│   │
│   └── consumer/
│       ├── index.html         # Parts browse + search + filter
│       ├── cart.html          # Cart + checkout
│       ├── orders.html        # My orders
│       ├── profile.html       # Profile + address
│       ├── contact.html       # Enquiry form
│       ├── login.html         # Standalone login page
│       └── register.html      # Email registration
│
└── database/                  # Auto-created at runtime, never committed
    ├── admin.db
    └── consumer.db
```

---

## Design / style conventions

- **Theme**: dark navy (`#0a1628`) background, gold/amber accent (`#d4a017`), white text. Clean, professional — not a generic Bootstrap look.
- **No frontend framework** — all pages are plain HTML + vanilla JS. No React, Vue, or bundler.
- **No TypeScript** — plain `.js` everywhere, CommonJS `require/module.exports` on the backend.
- **No comments** in code unless the WHY is non-obvious. Self-documenting variable names preferred.
- **No build step** — what's in `public/` is served as-is by Express static middleware.
- **CSS class naming** — BEM-ish with `bsm-` prefix for shared components (e.g. `bsm-header`, `bsm-btn`).
- **Modals** — all overlays use the pattern `<div class="overlay" id="...Ov">` toggled with `.open` class.
- **Admin shortcuts**: Alt+A = save, Alt+D = delete, Esc = close modal — consistent across every admin page.
- **Consumer login overlay**: Phone OTP tab (Firebase real SMS, Indian numbers +91 only) + Email tab + Google button. Phone normalization always strips to last 10 digits and prepends +91.
- **API responses**: always `{ ok: true/false, ... }` JSON. Never throw HTTP error codes for business logic failures.
- **Toast notifications**: `API.toast(message, type)` — types: default (green), `'warning'` (amber), `'error'` (red).

---

## Key runtime facts

- **Port**: 3000 (configurable via `PORT` env var)
- **Session secret**: `bsmotor_secret_2024` (hardcoded, local-only app)
- **Default admin**: `admin@bsmotor.com` / `admin123` (seeded on first run)
- **Firebase project**: `spare-links` (project ID), Blaze plan, India SMS region enabled, reCAPTCHA Enterprise API enabled
- **Phone auth rate-limiting**: Firebase blocks excessive attempts — use incognito or wait 1-2 hours to reset
- **File uploads**: stored in `public/uploads/`, served as static files, referenced as `/uploads/filename.ext`
- **i18n**: toggled per-user via `lang` column in consumer `users` table; `locales/*.json` are loaded client-side
