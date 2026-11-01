# Savera Paradise - Comprehensive Cloudflare Migration, Security & Pre-Push Audit Report

**Target Platform:** Cloudflare Pages & Pages Functions  
**Source Platform:** Vercel Serverless & Static Hosting  
**Repository Branch:** `cloudflare-migration` (Local only)  
**Execution Date:** November 2026  
**Final Status:** Pre-Push Git, Supabase, Cashfree & Security Review Completed — **READY FOR USER APPROVAL TO PUSH**  

---

## 1. Executive Summary & Migration Scope

Savera Paradise is a real-time cloud restaurant and delivery operating platform built with Vite, vanilla ECMAScript modules, Supabase (PostgreSQL + Realtime), Cashfree Payment Gateway, Cloudflare R2 Object Storage, and Cloudflare Turnstile bot protection.

This migration transitions the platform from Vercel to **Cloudflare Pages** and **Cloudflare Pages Functions** with strict adherence to safety rules:
- The original repository, production branches, Vercel deployments, production database schema, and live domain/DNS records remain 100% untouched.
- All migration code and assets are developed exclusively in this isolated workspace: `savera-cloudflare-migration` on local branch `cloudflare-migration`.
- Existing tests (701 tests across 19 suites) continue to pass with 0 regressions.
- An additional 33 test cases have been added in `test/cloudflare-pages-functions.test.js`, bringing the verified total to **734 tests passing across 27 suites**.

---

## 2. Complete Git Review & Change Inventory

### 2.1 Branch & Working Tree State
- **Active Branch:** `cloudflare-migration`
- **Tracking / Base Branch:** `origin/main` (at commit `a266626`)
- **Working Tree:** Completely clean (`nothing to commit, working tree clean`)
- **Remote Branches Created:** **0**
- **Commits Pushed:** **0**

### 2.2 Local Commit History on `cloudflare-migration`
1. `7f6d318` - `chore(wrangler): update compatibility_date to 2024-09-23 for nodejs_compat`
2. `9ada2c5` - `fix(security): harden Cashfree webhook idempotency, disallow prod mock fallbacks, enforce strict auth gates`
3. `0a50c12` - `feat(cloudflare): prepare isolated Cloudflare Pages & Pages Functions migration`

### 2.3 Comprehensive Diff Analysis (`git diff origin/main..HEAD --name-status`)
All changes relative to `origin/main` are **strictly new additions (23 files, +3,018 lines, 0 deletions)**. Zero existing files were deleted, and zero existing Vercel files were modified.

| File Path | Status | Purpose & Architecture |
|---|---|---|
| `wrangler.toml` | **Added** | Pages configuration specifying `pages_build_output_dir = "dist"`, `compatibility_date = "2024-09-23"`, and `compatibility_flags = ["nodejs_compat"]`. |
| `public/_redirects` | **Added** | Cloudflare Pages HTTP 200 rewrites for multi-portal clean URLs (`/admin`, `/delivery`, `/owner`, `/poster`, compliance pages). |
| `public/_headers` | **Added** | Strict Content-Security-Policy (CSP), HSTS, asset immutable caching, and service worker no-store rules. |
| `public/_routes.json` | **Added** | Route optimization instructing Cloudflare edge to invoke Pages Functions solely for `/api/*` while bypassing edge functions for all static assets. |
| `functions/api/_adapter.js` | **Added** | Web Request/Response adapter, CORS resolution, and environment hydration. |
| `functions/api/_auth.js` | **Added** | Cryptographic HMAC-SHA256 session token generation, constant-time PIN comparison, and production secret enforcement. |
| `functions/api/_cashfree.js` | **Added** | Storefront PG order creation, doorstep dynamic UPI QR generation, webhook signature verification, and rider payouts with production mock prevention. |
| `functions/api/_r2.js` | **Added** | Cross-account S3-compatible REST client with AWS Signature Version 4 (AWS SigV4) calculation over HTTPS. |
| `functions/api/_turnstile.js` | **Added** | Server-side verification for Cloudflare Turnstile invisible bot protection. |
| `functions/api/admin-auth.js` | **Added** | Pages Function handler for staff PIN authentication and session token refreshing. |
| `functions/api/checkout.js` | **Added** | Pages Function handler for price tamper defense, MOV enforcement, and authoritative order signing. |
| `functions/api/cashfree-create-order.js` | **Added** | Pages Function handler for Cashfree PG payment session creation. |
| `functions/api/cashfree-generate-qr.js` | **Added** | Pages Function handler for doorstep dynamic UPI QR generation and PNG Data URL rendering. |
| `functions/api/cashfree-payout.js` | **Added** | Pages Function handler for owner-gated nighttime rider payouts. |
| `functions/api/cashfree-webhook.js` | **Added** | Pages Function handler for raw-body Cashfree webhook signature verification, idempotency checks, and amount validation. |
| `functions/api/ola-maps.js` | **Added** | Pages Function handler for reverse geocoding, autocomplete, and tile proxy with rate limiting. |
| `functions/api/r2-upload.js` | **Added** | Pages Function handler for AWS SigV4 PUT uploads to Account A's R2 bucket with binary magic byte validation. |
| `functions/api/r2-image.js` | **Added** | Pages Function handler for AWS SigV4 GET image streaming with path traversal protection. |
| `functions/api/r2-list.js` | **Added** | Pages Function handler for AWS SigV4 GET object listing with prefix sanitization. |
| `functions/api/r2-delete.js` | **Added** | Pages Function handler for AWS SigV4 DELETE object removal with admin authorization. |
| `functions/api/r2-video.js` | **Added** | Pages Function handler for AWS SigV4 video streaming with HTTP 206 Partial Content range requests. |
| `test/cloudflare-pages-functions.test.js` | **Added** | Automated test suite verifying all 12 Pages Functions, CORS preflights, bot rejection, and security boundaries. |
| `CLOUDFLARE_MIGRATION_REPORT.md` | **Added** | Comprehensive architectural, security, and pre-push audit report. |

### 2.4 Preservation of Original Configuration
- **Vercel API Handlers:** All original files in `api/` (`api/checkout.js`, `api/admin-auth.js`, etc.) remain 100% untouched.
- **Vercel Deployment Config:** `vercel.json` is preserved completely without modification.
- **Vite Configuration:** `vite.config.js` and `package.json` remain untouched.
- **Original Git Branches:** The `main` branch remains clean and at commit `a266626`.

---

## 3. Supabase Integration & Security Policy Review

### 3.1 Single Project Shared Architecture
- Cloudflare Pages connects to the exact same Supabase project as Vercel.
- **Frontend Client:** `supabaseClient.js` runs in the browser using public environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. It handles menu display, category loading, guest order placement, and live order tracking via Supabase Realtime WebSockets (`wss://*.supabase.co`).
- **Server-Side Pages Functions:** Handlers (`checkout.js`, `cashfree-webhook.js`) use the private `SUPABASE_SERVICE_ROLE_KEY` to authoritatively fetch dish prices, verify minimum order values, and update payment statuses without client RLS restrictions.
- **Credentials Separation:** Server-side secrets are strictly separated from client-side bundles. Automated scans confirmed **0 occurrences of `SUPABASE_SERVICE_ROLE_KEY` in `dist/assets/*.js`**.

### 3.2 Review of Active Database Schema & Row-Level Security (RLS)
Inspection of repository migrations (`supabase_setup.sql` and `supabase_migration_04_cashfree_and_rls_alignment.sql`) confirms:
1. `public.orders`:
   - `public_create_orders`: Allows guest checkout inserts with initial status `pending` or `accepted`.
   - `app_read_orders` & `app_update_orders`: Permissive for application-layer updates (`SELECT true`, `UPDATE true`).
2. `public.riders`:
   - `app_manage_riders`: Permissive for fleet roster synchronization.
   - `verify_rider_pin(p_pin TEXT)`: Secure `SECURITY DEFINER` RPC function that validates a 4-digit rider passcode and returns only the authenticated rider's profile, preventing table scraping.
3. `public.categories` & `public.dishes`:
   - `app_manage_categories` & `app_manage_dishes`: Allows public read and administrative updates.

### 3.3 Documented Unresolved Security Concerns (Zero Database Changes Made)
- **Application-Layer vs Database-Level Auth:** The existing architecture authenticates kitchen managers and fleet riders at the application layer using passcodes rather than Supabase Auth JWTs (`auth.uid()`). As documented in `supabase_migration_02_security_policies.sql`, applying strict user-scoped RLS policies directly would break kitchen order progression and rider status updates unless staff are migrated to Supabase Auth accounts.
- **Recommendation for Post-Migration Phase:** In a subsequent phase (after Cloudflare cutover), route all privileged order state mutations (`Accepted` -> `Preparing` -> `Out for Delivery` -> `Delivered`) exclusively through authenticated Cloudflare Pages Functions rather than direct client-side Supabase updates, enabling Row Level Security policies to be tightened to `service_role` only.

---

## 4. Cashfree Gateway Status & Safe Staging Protocol

### 4.1 Current Status: Merchant Verification Pending
- **Business Status:** Cashfree merchant account KYC and business verification is currently pending with Cashfree onboarding.
- **Payment Processing Status:** Live payment processing is **strictly disabled**.
- **No Claims of Live Functionality:** The platform does not claim live payments are operational.
- **Zero Invalidation / Zero Invented Credentials:** No fictitious live keys have been added.

### 4.2 Safe Sandbox Configuration for Staging
For the Cloudflare Pages staging deployment, the environment is locked to **Cashfree TEST / Sandbox mode**:
- `CASHFREE_ENV`: `TEST`
- `CASHFREE_APP_ID`: Cashfree Sandbox Client ID (from Cashfree Merchant Dashboard Test Environment).
- `CASHFREE_SECRET_KEY`: Cashfree Sandbox Client Secret.
- `CASHFREE_WEBHOOK_SECRET`: Cashfree Sandbox Webhook Secret.
- In sandbox mode, test transactions use mock UPI VPAs (`success@upi`) or Cashfree simulation cards. Real customer money is never touched.

### 4.3 Production Transition Protocol (Post Merchant KYC Approval)
Once Cashfree merchant verification is formally approved by Cashfree:
1. **Production Keys:** Retrieve Production App ID and Secret Key from the Cashfree Merchant Dashboard.
2. **Webhook Endpoint:** Configure the live Webhook URL to `https://saveraparadise.com/api/cashfree-webhook`.
3. **Webhook Subscriptions:** Enable `PAYMENT_SUCCESS_WEBHOOK` and `PAYMENT_CAPTURED`.
4. **Environment Promotion:** Update Cloudflare Pages environment variable `CASHFREE_ENV=PROD` and update `CASHFREE_WEBHOOK_SECRET`.
5. **Rider Nighttime Payouts:** If automated end-of-day rider payouts to UPI VPAs are enabled, complete Cashfree Payouts activation and fund the payout merchant account.

---

## 5. Multi-Account Cloudflare R2 Storage Architecture

### 5.1 Account Segregation
- **Account Topology:** Existing R2 bucket (`R2_BUCKET_NAME`) is hosted in **Account A**, while Cloudflare Pages is deployed in **Account B**.
- **Architecture:** Uses **S3-compatible REST API access with AWS Signature Version 4 (AWS SigV4)** over HTTPS (`https://<account-a-id>.r2.cloudflarestorage.com`).
- **Cross-Account Compatibility:** S3 SigV4 authentication functions seamlessly across different Cloudflare accounts without cross-account binding configuration.
- **Zero Frontend Leakage:** All R2 credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) remain strictly server-side within Cloudflare Pages Functions environment secrets.
- **Zero Data Loss:** All existing images, bucket names, and folder hierarchies (`dishes/`, `categories/`, `videos/`) remain untouched in Account A.

---

## 6. Cloudflare Deployment Readiness & Configuration

### 6.1 Build Settings (for Cloudflare Pages Dashboard)
- **Framework Preset:** `None` (or `Vite`)
- **Build Command:** `npm run build`
- **Build Output Directory:** `dist`
- **Root Directory:** `/` (or `savera-cloudflare-migration` if repository subfolder)

### 6.2 Required Cloudflare Environment Variables & Secrets Catalog

#### Public / Client-Side Variables (Build Time):
| Variable Name | Environment | Value / Source |
|---|---|---|
| `VITE_SUPABASE_URL` | Staging & Production | Supabase Project URL (`https://<project-ref>.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Staging & Production | Supabase Anonymous Public Key |
| `VITE_TURNSTILE_SITE_KEY` | Staging | `1x00000000000000000000AA` (Cloudflare Test Site Key) |
| `VITE_TURNSTILE_SITE_KEY` | Production | Live Cloudflare Turnstile Site Key |
| `VITE_R2_PUBLIC_DOMAIN` | Optional | Custom R2 domain if configured |

#### Private Server-Side Secrets (Runtime - Enter via Cloudflare Pages Dashboard):
| Secret Name | Environment | Description |
|---|---|---|
| `SESSION_SECRET` | Staging & Production | Random 32+ character string for HMAC token signing |
| `ADMIN_PIN` | Staging & Production | 4-digit Kitchen Display PIN (e.g. `8899`) |
| `OWNER_PIN` | Staging & Production | 4-digit Executive Owner PIN (e.g. `9900`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging & Production | Supabase Secret Service Role Key |
| `R2_ACCESS_KEY_ID` | Staging & Production | Cloudflare R2 Token ID (Account A) |
| `R2_SECRET_ACCESS_KEY` | Staging & Production | Cloudflare R2 Token Secret (Account A) |
| `R2_BUCKET_NAME` | Staging & Production | Target bucket name in Account A |
| `R2_HOST` | Staging & Production | `<account-a-id>.r2.cloudflarestorage.com` |
| `R2_ENDPOINT` | Staging & Production | `https://<account-a-id>.r2.cloudflarestorage.com` |
| `R2_REGION` | Staging & Production | `auto` |
| `CASHFREE_APP_ID` | Staging | Cashfree Sandbox App ID |
| `CASHFREE_SECRET_KEY` | Staging | Cashfree Sandbox Secret Key |
| `CASHFREE_ENV` | Staging | `TEST` |
| `CASHFREE_WEBHOOK_SECRET` | Staging | Cashfree Sandbox Webhook Secret |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` | Staging | `1x0000000000000000000000000000000AA` (Cloudflare Test Secret Key) |
| `OLA_MAPS_API_KEY` | Optional | Ola Maps API Key |
| `STORE_LAT` | Optional | `12.7208891` |
| `STORE_LNG` | Optional | `77.2805103` |
| `RESTAURANT_UPI_VPA` | Optional | `saveraparadise@okhdfcbank` |

---

## 7. Staging Deployment Checklist

1. [x] Local `cloudflare-migration` branch is clean and all changes are committed locally.
2. [x] 734 tests passing across 27 test suites with 0 failures and 0 skipped.
3. [x] Vite multi-page build verified (`dist/` contains 11 HTML entry points and assets).
4. [x] Wrangler Pages Functions compiler verified (`✨ Compiled Worker successfully`).
5. [x] `_routes.json`, `_redirects`, `_headers`, and `wrangler.toml` verified in `dist/`.
6. [x] All 12 Pages Functions tested against standard Web `Request`/`Response`.
7. [x] Zero production credentials committed to Git.
8. [ ] **Pending User Approval:** Push branch `cloudflare-migration` to GitHub.
9. [ ] Connect GitHub repository branch `cloudflare-migration` to Cloudflare Pages.
10. [ ] Configure environment variables and secrets in Cloudflare Pages Dashboard.
11. [ ] Perform smoke tests on Cloudflare staging preview URL (`*.pages.dev`).

---

## 8. Exact Git Push Command (DO NOT EXECUTE UNTIL AUTHORIZED)

When ready and explicitly approved by you, the exact command to push only this isolated branch to GitHub is:

```powershell
cd "C:\Users\DELL\Projects\resturent migration\savera-cloudflare-migration"
git push -u origin cloudflare-migration
```

> [!IMPORTANT]
> **Safety Notice:** This command will push ONLY the `cloudflare-migration` branch to GitHub. It will not touch `main`, will not affect existing Vercel deployments, and will not alter production traffic.

---

## 9. Final Decision & Recommendation

### Status: **READY FOR GITHUB STAGING PUSH** (Awaiting User Authorization)

- **Original Project:** 100% untouched.
- **Codebase Integrity:** 100% reproducible, 734/734 tests passing, zero missing dependencies.
- **Security Posture:** Hardened against mock bypasses, underpayment attacks, and brute-force attempts.
- **Next Step:** Awaiting your explicit approval to run the push command.
