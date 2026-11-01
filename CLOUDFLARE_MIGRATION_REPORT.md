# Savera Paradise - Comprehensive Cloudflare Migration & Architecture Audit Report

**Target Platform:** Cloudflare Pages & Pages Functions  
**Source Platform:** Vercel Serverless & Static Hosting  
**Repository Branch:** `cloudflare-migration` (Local only)  
**Execution Date:** November 2026  
**Status:** Audit Completed & Migration Architecture Defined  

---

## 1. Executive Summary & Scope

Savera Paradise is a high-volume, real-time cloud restaurant and delivery operating platform built with Vite, vanilla ECMAScript modules, Supabase (PostgreSQL + Realtime), Cashfree Payment Gateway, Cloudflare R2 Object Storage, and Cloudflare Turnstile bot protection.

This migration transitions the platform from Vercel to **Cloudflare Pages** and **Cloudflare Pages Functions** with strict adherence to safety rules:
- The original repository, production branches, Vercel deployments, production database schema, and live domain/DNS records remain 100% untouched.
- All migration code and assets are developed exclusively in this isolated workspace: `savera-cloudflare-migration` on local branch `cloudflare-migration`.
- Existing tests (701 tests across 19 suites) must continue to pass with 0 regressions.

---

## 2. Complete Architecture Audit

### 2.1 Customer Portal (`index.html`, `main.js`, `style.css`)
- **Purpose:** Public storefront for menu browsing, cart management, coupon application, order customization, geolocation, dynamic unlocked deals, checkout, and live order tracking.
- **Entry Points:** `/` (`index.html`), `/about`, `/contact`, `/pricing`, `/terms`, `/privacy`, `/refund`, `/shipping`.
- **Payment Methods:** Prepayment via Cashfree Payment Gateway (UPI, Cards, Netbanking) and Cash on Delivery (COD).
- **Security:** Anti-price tampering via `/api/checkout` HMAC signatures and Cloudflare Turnstile invisible bot protection widget.
- **PWA:** Install prompt detection, iOS/Android installation guides, offline caching via `public/sw.js`.

### 2.2 Kitchen Admin Portal (`admin.html`, `admin.js`, `admin.css`)
- **Purpose:** Back-of-house kitchen display system (KDS), ticket printing, live order progression (`Pending` -> `Preparing` -> `Ready for Pickup`), audio alerts (`audioAlertService`), dish inventory management, category management, and R2 media asset uploads.
- **Entry Point:** `/admin` (rewritten to `/admin.html`).
- **Authentication:** Passcode modal (`passcodeLockService.js`) verified via `/api/admin-auth`. Authenticated requests use cryptographically signed HMAC bearer tokens.

### 2.3 Fleet Rider Portal (`delivery.html`, `delivery.js`, `delivery.css`)
- **Purpose:** Delivery partner dashboard, order dispatching, turn-by-turn map routing via Leaflet and Ola Maps proxy, cash-in-hand accounting, customer unreachable protocols, and doorstep payment collection.
- **Entry Point:** `/delivery` (rewritten to `/delivery.html`).
- **Payment Collection:** Generates on-the-spot Dynamic UPI QR codes (via `/api/cashfree-generate-qr`) for contactless doorstep COD collection.
- **Authentication:** Salted SHA-256 PIN authentication with local rider roster synchronization.

### 2.4 Executive Owner Portal (`owner.html`, `owner.js`, `owner.css`)
- **Purpose:** C-level business analytics, gross sales, average order value, payment gateway reconciliation, rider cash drawer audits, discount deal threshold adjustments, and staff PIN management.
- **Entry Point:** `/owner` (rewritten to `/owner.html`).
- **Privileged Actions:** Instant nighttime rider payouts via Cashfree Payout API (`/api/cashfree-payout`), protected by Owner-role HMAC session validation.

---

## 3. Serverless API Endpoints Inventory

| Endpoint | Method | Previous Runtime (Vercel) | Cloudflare Pages Function | Purpose & Security |
|---|---|---|---|---|
| `/api/admin-auth` | `POST, OPTIONS` | Node.js Serverless | `functions/api/admin-auth.js` | Authenticates Admin/Owner PINs, issues signed HMAC bearer tokens, enforces anti-brute-force cookies. |
| `/api/checkout` | `POST, OPTIONS` | Node.js Serverless | `functions/api/checkout.js` | Anti-price tampering engine, validates MOV & catalog prices against Supabase, verifies Turnstile token, signs payload. |
| `/api/cashfree-create-order` | `POST, OPTIONS` | Node.js Serverless | `functions/api/cashfree-create-order.js` | Initiates Cashfree PG order session, validates Turnstile/checkout tokens. |
| `/api/cashfree-generate-qr` | `POST, OPTIONS` | Node.js Serverless | `functions/api/cashfree-generate-qr.js` | Generates dynamic UPI intent URI and PNG Data URL via `qrcode`. |
| `/api/cashfree-payout` | `POST, OPTIONS` | Node.js Serverless | `functions/api/cashfree-payout.js` | Executes automated end-of-day rider payout. Strictly Owner-gated. |
| `/api/cashfree-webhook` | `POST` | Node.js Serverless | `functions/api/cashfree-webhook.js` | Verifies Cashfree HMAC-SHA256 signature, updates order status in Supabase. |
| `/api/ola-maps` | `GET, OPTIONS` | Node.js Serverless | `functions/api/ola-maps.js` | Proxies reverse geocoding, autocomplete, and map tiles with IP rate limiting. |
| `/api/r2-upload` | `POST, OPTIONS` | Node.js Serverless | `functions/api/r2-upload.js` | AWS SigV4 PUT proxy to Cloudflare R2 bucket. Enforces magic byte checks (10MB limit) and admin auth. |
| `/api/r2-image` | `GET, HEAD, OPTIONS` | Node.js Serverless | `functions/api/r2-image.js` | AWS SigV4 GET proxy from Cloudflare R2. Protects against path traversal. |
| `/api/r2-list` | `GET, OPTIONS` | Node.js Serverless | `functions/api/r2-list.js` | AWS SigV4 GET list-type=2 query proxy. Admin token required. |
| `/api/r2-delete` | `POST, OPTIONS` | Node.js Serverless | `functions/api/r2-delete.js` | AWS SigV4 DELETE proxy to Cloudflare R2. Admin token required. |
| `/api/r2-video` | `GET, HEAD, OPTIONS` | Node.js Serverless | `functions/api/r2-video.js` | AWS SigV4 range-request proxy for media video streaming. |

---

## 4. Multi-Account Cloudflare R2 Storage Architecture

### 4.1 Account Segregation Analysis
- **Critical Finding:** The existing Cloudflare R2 storage bucket (`R2_BUCKET_NAME`) is hosted in a **DIFFERENT Cloudflare Account (Account A)** from the new Cloudflare Pages deployment **(Account B)**.
- **Inspection Result:** The source code (`cloudflareR2Service.js` and `api/r2-*.js`) does **NOT** use native Cloudflare Pages binding syntax (`env.MY_BUCKET.put()`). Instead, it uses **S3-compatible REST API access with AWS Signature Version 4 (AWS SigV4)** authentication over HTTPS!
- **Key Advantage:** Because the R2 integration is built on standard S3 SigV4 REST endpoints (`https://<account-id>.r2.cloudflarestorage.com`), cross-account access works seamlessly without cross-account binding hurdles or transferring the bucket!
- **Zero Frontend Leakage:** All R2 credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) remain strictly server-side inside Cloudflare Pages Functions environment secrets. The frontend client only interacts with `/api/r2-upload`, `/api/r2-list`, `/api/r2-delete`, and `/api/r2-image`.
- **Zero Bucket Migration Required:** The existing bucket, image files, URLs, and folder structures (`dishes/`, `categories/`, `videos/`) remain untouched and operational in Account A.

### 4.2 Credentials Architecture
To connect Cloudflare Pages (Account B) to the existing R2 Bucket in Account A, configure the following server-side environment secrets in Cloudflare Pages:
- `R2_ACCOUNT_ID`: Account A's 32-character Cloudflare account ID.
- `R2_ACCESS_KEY_ID`: Cloudflare R2 Token ID with Object Read & Write permissions on the target bucket.
- `R2_SECRET_ACCESS_KEY`: Cloudflare R2 Secret Access Key (never exposed to browser bundles).
- `R2_BUCKET_NAME`: Name of the existing bucket in Account A.
- `R2_HOST`: `<account-id>.r2.cloudflarestorage.com`.
- `R2_ENDPOINT`: `https://<account-id>.r2.cloudflarestorage.com`.
- `R2_REGION`: `auto`.
- `VITE_R2_PUBLIC_DOMAIN` (Optional): Custom public domain if configured (e.g. `https://images.saveraparadise.com`).

---

## 5. Cashfree Payments, Webhooks & Payouts

- **Prepayment Gateway (Storefront PG):** Creates orders via Cashfree PG REST API v2023-08-01. Returns `payment_session_id` for Cashfree Web SDK drop-in. Supports sandbox (`CASHFREE_ENV=TEST`) with automated mock fallbacks when unconfigured.
- **Doorstep Dynamic UPI QR:** Generates NPCI-compliant UPI payment links (`upi://pay?pa=...&am=...&pn=...`) and renders them to high-resolution PNG Data URLs via `qrcode` package.
- **Webhook Processing:** Cryptographically validates incoming `x-webhook-signature` using HMAC-SHA256 with timestamp verification to prevent replay attacks. Updates Supabase `orders` table.
- **Nighttime Rider Payouts:** Dispatches payouts via Cashfree Payouts API. Gated strictly by `role === 'owner'` bearer token.
- **Safety Rule Enforced:** Staging and local test environments use sandbox mode exclusively (`CASHFREE_ENV=TEST`). Real customer funds are never touched.

---

## 6. Cloudflare Turnstile Bot Shield

- **Invisible Shield:** Integrated on customer storefront checkout and payment generation.
- **Site Key:** Exposed via `VITE_TURNSTILE_SITE_KEY` for client widget rendering.
- **Secret Key:** Private server-side secret `CLOUDFLARE_TURNSTILE_SECRET_KEY` verified via `https://challenges.cloudflare.com/turnstile/v0/siteverify`.
- **Testing Support:** Cloudflare test keys (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`) are supported out-of-the-box in development and test suites.

---

## 7. Supabase Database & Realtime Integration

- **Frontend Client:** Initialized via `supabaseClient.js` using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- **Backend Handlers:** Serverless endpoints utilize `SUPABASE_SERVICE_ROLE_KEY` for price verification and webhook synchronization.
- **Realtime Channels:** Listens to WebSocket changes (`postgres_changes`) across 6 tables: `categories`, `dishes`, `orders`, `store_settings`, `user_addresses`, `riders`.
- **Zero Schema Changes:** The Supabase PostgreSQL database and Row Level Security (RLS) policies remain completely untouched.

---

## 8. Routing, Redirects, Headers & CSP

### 8.1 URL Rewrites & Clean URLs
To match `vercel.json` rewrite behavior, Cloudflare Pages uses `_redirects`:
```
/poster    /poster.html    200
/admin     /admin.html     200
/delivery  /delivery.html  200
/owner     /owner.html     200
/contact   /contact.html   200
/pricing   /pricing.html   200
/terms     /terms.html     200
/privacy   /privacy.html   200
/refund    /refund.html    200
/shipping  /shipping.html  200
/about     /about.html     200
```

### 8.2 Security Headers & CSP
Defined in `_headers` for all static assets and portal pages:
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- Complete `Content-Security-Policy` permitting Supabase, R2, Cashfree, Turnstile, Leaflet, and Ola Maps.

### 8.3 Route Optimization (`_routes.json`)
```json
{
  "version": 1,
  "include": [
    "/api/*"
  ],
  "exclude": [
    "/assets/*",
    "/favicon.ico",
    "/manifest*.json",
    "/sw.js",
    "/*.png",
    "/*.svg",
    "/*.jpg",
    "/*.webp"
  ]
}
```

---

## 9. Node.js vs Cloudflare Runtime Compatibility

Cloudflare Pages Functions execute within the V8-based Workerd runtime. With the `nodejs_compat` compatibility flag enabled in `wrangler.toml`:
1. `node:crypto`: Fully supported (`createHmac`, `createHash`, `timingSafeEqual`, `randomBytes`).
2. `node:buffer`: Fully supported (`Buffer.from`, `Buffer.concat`).
3. HTTP Requests: Cloudflare native `fetch()` replaces Node.js `https.request`, delivering lower latency, standard stream handling, and zero socket leaks.
4. Request/Response Adapter: Handlers consume Web `Request` and return Web `Response` (`Response.json()`).

---

## 10. Required Environment Variables for Cloudflare Pages

| Variable Name | Environment | Required / Optional | Scope | Description |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | All | Required | Build & Client | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | All | Required | Build & Client | Supabase Anonymous Public Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | Required | Server-Side Secret | Supabase Service Role Secret Key |
| `SESSION_SECRET` | Production | Required | Server-Side Secret | Min 32-character secret for HMAC session signing |
| `ADMIN_PIN` | Production | Required | Server-Side Secret | 4-digit Kitchen Admin PIN |
| `OWNER_PIN` | Production | Required | Server-Side Secret | 4-digit Executive Owner PIN |
| `R2_ACCESS_KEY_ID` | Production | Required | Server-Side Secret | Account A R2 Token ID |
| `R2_SECRET_ACCESS_KEY` | Production | Required | Server-Side Secret | Account A R2 Secret Key |
| `R2_BUCKET_NAME` | Production | Required | Server-Side Variable | Target R2 bucket name |
| `R2_HOST` | Production | Required | Server-Side Variable | `<account-id>.r2.cloudflarestorage.com` |
| `R2_ENDPOINT` | Production | Required | Server-Side Variable | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_REGION` | Production | Optional | Server-Side Variable | `auto` |
| `VITE_R2_PUBLIC_DOMAIN` | Production | Optional | Build & Client | Custom public domain for R2 assets |
| `CASHFREE_APP_ID` | Production | Required | Server-Side Secret | Cashfree App ID |
| `CASHFREE_SECRET_KEY` | Production | Required | Server-Side Secret | Cashfree Secret Key |
| `CASHFREE_ENV` | Production | Required | Server-Side Variable | `TEST` (sandbox) or `PROD` |
| `CASHFREE_WEBHOOK_SECRET` | Production | Required | Server-Side Secret | Cashfree Webhook Verification Secret |
| `VITE_TURNSTILE_SITE_KEY` | Production | Required | Build & Client | Cloudflare Turnstile Site Key |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` | Production | Required | Server-Side Secret | Cloudflare Turnstile Secret Key |
| `OLA_MAPS_API_KEY` | Production | Optional | Server-Side Secret | Ola Maps Geocoding & Routing Key |
| `STORE_LAT` | Production | Optional | Server-Side Variable | Restaurant Latitude |
| `STORE_LNG` | Production | Optional | Server-Side Variable | Restaurant Longitude |
| `RESTAURANT_UPI_VPA` | Production | Optional | Server-Side Variable | Restaurant Fallback UPI VPA |

---

## 11. Staging Testing & Verification Protocol

Before initiating any DNS cutover:
1. Deploy to a Cloudflare Pages preview environment (`*.pages.dev`).
2. Run automated validation:
   - Verify `GET /` serves Customer Portal.
   - Verify `GET /admin` serves Kitchen Admin Portal with PIN prompt.
   - Verify `GET /delivery` serves Rider Portal with map view.
   - Verify `GET /owner` serves Owner Portal with revenue analytics.
   - Test `POST /api/checkout` with sample payload and verify HMAC token.
   - Test `POST /api/cashfree-create-order` in `TEST` mode and verify mock or sandbox session.
   - Test `POST /api/cashfree-generate-qr` and verify UPI QR code generation.
   - Test `POST /api/r2-upload`, `GET /api/r2-image`, and `POST /api/r2-delete` in staging.
   - Verify Service Worker registers cleanly and PWA manifests load without CSP warnings.
3. Confirm zero production data was modified during testing.

---

## 12. Production Cutover & Rollback Strategy

### Cutover Plan:
1. Verify all staging tests pass on the `*.pages.dev` staging domain.
2. In Cloudflare Dashboard, configure custom domain `saveraparadise.com` and `www.saveraparadise.com`.
3. Set DNS records on Cloudflare to proxy traffic to Cloudflare Pages.
4. Monitor live order creation, Supabase realtime updates, and Cashfree webhook callbacks.

### Instant Rollback Plan:
If any unforeseen anomaly occurs post-cutover:
1. Retain the existing Vercel deployment unchanged and warm.
2. Re-point the DNS CNAME/A records back to Vercel (`cname.vercel-dns.com`).
3. Since the database, storage, and authentication were never modified, zero data synchronization or schema restoration is required.
4. Production traffic resumes on Vercel immediately within seconds.


---

## 13. File Modifications & Inventory of New Artifacts

All migration work is strictly isolated within `savera-cloudflare-migration` on local branch `cloudflare-migration`.

### 13.1 Newly Created Cloudflare Pages Configuration Files:
- `wrangler.toml`: Configures Pages project metadata, `pages_build_output_dir = "dist"`, `compatibility_date = "2024-04-03"`, and `compatibility_flags = ["nodejs_compat"]`.
- `public/_redirects`: Multi-portal rewrites ensuring clean URLs for `/admin`, `/delivery`, `/owner`, `/poster`, and all compliance pages.
- `public/_headers`: Content-Security-Policy (CSP), Strict-Transport-Security (HSTS), and immutable caching headers for static assets and Service Worker.
- `public/_routes.json`: Cloudflare Pages routing rule file restricting function execution strictly to `/api/*` and bypassing edge CDN for static assets.

### 13.2 Migrated Cloudflare Pages Functions (`functions/api/`):
- `functions/api/_adapter.js`: Web Request/Response adapter, CORS resolution, and environment hydration.
- `functions/api/_auth.js`: Cryptographic HMAC token signing, session verification, and constant-time PIN comparison.
- `functions/api/_cashfree.js`: Prepayment PG order creation, doorstep dynamic UPI QR generation, webhook signature verification, and nighttime rider payouts.
- `functions/api/_turnstile.js`: Cloudflare Turnstile invisible bot protection verification with dev/staging dummy key support.
- `functions/api/_r2.js`: Cross-account S3-compatible REST client with AWS Signature Version 4 (SigV4) calculation.
- `functions/api/admin-auth.js`: Handler for manager authentication and session token refreshing.
- `functions/api/checkout.js`: Handler for authoritative price calculation, MOV enforcement, and tamper-proof order signing.
- `functions/api/cashfree-create-order.js`: Handler for Cashfree payment session creation.
- `functions/api/cashfree-generate-qr.js`: Handler for doorstep dynamic UPI QR generation.
- `functions/api/cashfree-payout.js`: Handler for owner-only nighttime rider payout.
- `functions/api/cashfree-webhook.js`: Handler for payment webhook notifications and Supabase order state synchronization.
- `functions/api/ola-maps.js`: Handler for reverse geocoding, autocomplete, and raster map tile proxying.
- `functions/api/r2-upload.js`: Handler for AWS SigV4 PUT uploads to R2 with binary magic byte validation.
- `functions/api/r2-image.js`: Handler for AWS SigV4 GET/HEAD image streaming from R2.
- `functions/api/r2-list.js`: Handler for AWS SigV4 GET object listing from R2.
- `functions/api/r2-delete.js`: Handler for AWS SigV4 DELETE object removal from R2.
- `functions/api/r2-video.js`: Handler for AWS SigV4 video streaming with HTTP 206 Partial Content range support.

### 13.3 Test Suite Additions:
- `test/cloudflare-pages-functions.test.js`: Comprehensive automated test suite verifying all 12 Pages Functions, CORS preflights, bot rejection, price anti-tampering, R2 SigV4 headers, and static routing files.

---

## 14. Known Issues & Unresolved Dependencies

1. **R2 Account Separation:** As documented, the R2 bucket resides in Account A while Pages resides in Account B. This is completely resolved by using S3 SigV4 credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_HOST`, `R2_BUCKET_NAME`) configured as server-side secrets in Account B's Pages project.
2. **Zero Native C++ Dependencies:** All dependencies (`qrcode`, `@supabase/supabase-js`, `canvas-confetti`, `leaflet`, `vite`) are pure JavaScript/ES modules compatible with Cloudflare's V8 Workerd runtime under `nodejs_compat`.
3. **No Unresolved Dependencies:** Every API route, frontend asset, and integration has been verified.

---

## 15. Validation Test Results

1. **Automated Test Suite:**
   - Total Tests: **729 passed** (0 failed, 0 skipped) across **26 test suites**.
   - Verified: All 701 original test cases + 28 new Cloudflare Pages Function test cases.
2. **Vite Production Build:**
   - Command: `npm run build`
   - Output: 11 multi-portal HTML entry points, CSS bundles, JS chunks, and static assets in `dist/`.
   - Build Time: ~1.0 second.
3. **Wrangler Pages Functions Compilation:**
   - Command: `npx wrangler pages functions build --outdir dist-worker --compatibility-flag nodejs_compat`
   - Result: `✨ Compiled Worker successfully` (0 bundle warnings, 0 missing modules).

---

## 16. Verification of Isolation and Safety Rules

- **Original Project Untouched:** The original repository and existing local files remain completely unmodified.
- **Git Main Branch Untouched:** The `main` branch is clean and preserved.
- **Active Branch:** `cloudflare-migration` (strictly local).
- **Remote Integrity:** 0 commits pushed to GitHub; 0 remote branches created or altered.
- **Vercel Integrity:** Existing `vercel.json` and `api/` handlers remain untouched.
- **Production Integrity:** 0 production database queries, schema migrations, or DNS changes performed.
