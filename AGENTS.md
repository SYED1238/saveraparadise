# Savera Paradise - Agent Guidelines & Mandatory Verification Rules

## 1. Domain Skill Activation
Before modifying, refactoring, or authoring any code, database schema, or configuration files, always inspect and activate the matching domain skill from `.agents/skills/`:
- Cloudflare Pages & Workers: `.agents/skills/cloudflare-workers-and-pages/SKILL.md`
- Cloudflare R2 Media Storage: `.agents/skills/cloudflare-r2-storage/SKILL.md`
- Cashfree, Doorstep UPI & Ledgers: `.agents/skills/cashfree-and-upi-fintech/SKILL.md`
- Supabase & PostgreSQL: `.agents/skills/supabase-postgres-best-practices/SKILL.md`, `supabase-security`, `database-migration-review`
- Restaurant Order Integrity: `.agents/skills/restaurant-order-integrity/SKILL.md`
- Multi-Portal RBAC & State Sync: `.agents/skills/multi-portal-rbac-sync/SKILL.md`
- PWA & Android APK: `.agents/skills/offline-first-pwa-and-apk/SKILL.md`, `android-gradle-and-apk-ci`
- Maps & Geofencing: `.agents/skills/maps-geofencing-and-routing/SKILL.md`
- Menu Scheduling & Deals: `.agents/skills/menu-scheduling-and-promo-engine/SKILL.md`
- Owner Analytics & Compliance: `.agents/skills/owner-analytics-and-compliance/SKILL.md`

## 2. Mandatory Post-Edit Zero-Regression Gate
After ANY file edit, refactor, addition, or deletion, strictly execute `.agents/skills/post-edit-regression-gate/SKILL.md`:

1. **Cross-Portal Caller & DOM Audit:**
   - Search across all 4 portals (`main.js`, `admin.js`, `delivery.js`, `owner.js`), `dataService.js`, and all `*Service.js` files whenever changing any method signature, return shape, or localStorage key.
   - Verify that no renamed or removed HTML DOM `#id` or `.class` selector breaks event listeners in `index.html`, `admin.html`, `delivery.html`, `owner.html`, or compliance pages.

2. **Dual-API Parity Check (`api/` <-> `functions/api/`):**
   - Any bug fix, parameter update, or logic change in `api/<name>.js` MUST be applied identically to `functions/api/<name>.js` (and vice-versa).
   - Ensure `worker.js` and `public/_routes.json` remain in lockstep.

3. **Financial & Settlement Invariants:**
   - Never overwrite or drop `public.riders` settlement columns (`cash_settled_at`, `payout_paid_at`, `payout_amount_paid`, `upi_vpa`, `bank_account_no`, `bank_ifsc`, `payout_method_pref`, `earnings`, `trips`).
   - Note that rider cash-in-hand is computed dynamically via `dataService.getRiderCashSummary(pin)` and is never a static column.

4. **Production Build Gate:**
   - Run `npm run build` to verify clean Vite multi-page bundling, valid ES module imports, and zero build errors across all portals.

5. **Automated Test Gate:**
   - Run affected tests first, followed by the complete regression test suite (`npm test`).
   - Confirm 0 test failures across all 1,030+ tests before replying.
   - Strict Invariant: Never finish a task with a failing test, and never delete, comment out, or weaken an existing test assertion to mask a regression.

## 3. Windows Diffing & Zero-Scratch-Script Rule
- Never create temporary `.cjs` or `.mjs` scripts in `scratch/` to compare or scan files.
- To diff `api/` vs `functions/api/` on Windows PowerShell, always run: `git --no-pager diff --no-index api/ functions/api/`.

## 4. Non-Negotiable Codebase Invariants (Always Check Even Without Opening Skills)
- **No Direct Browser `anon` Writes on Locked Tables:** `public.orders` and `public.riders` have `anon` writes/reads revoked by Migrations 08-12. Every mutation or offline sync in `dataService.js` (`syncOfflinePendingOrders`, `riderWaitingAtDoorstep`, `cancelDoorstepWait`, `syncRidersFromSupabase`) MUST route through `/api/order-action` or `/api/admin-store` first, never direct `supabase.from('orders'|'riders')`.
- **No Single-Call Chained Duplicate Mutations:** Never chain `doUpdate(orderId).then(() => doUpdate(altId))` in `dataService.js`; `/api/order-action` already normalizes `#` prefixes, and a second call on a terminal state (`delivered`/`cancelled`) triggers a `400` error.
- **Strict Server-Backed Auth (Zero Local PIN Bypass on 401):** In `admin.js`, `owner.js`, `delivery.js`, and `securityUtils.js`, if `/api/admin-auth` returns `401` or `403`, login MUST fail; never fall back to local PIN hashes (`DEFAULT_OWNER_PIN_HASH` / `DEFAULT_RIDER_PIN_HASHES`) when the server rejects a PIN. Token refresh (`action: 'refresh'`) must enforce `maxRefreshAge = 24h` in both `api/` and `functions/api/`.
- **Geofence & Address Privacy Invariants:** Never default missing or `(0,0)` customer `lat`/`lng` to `RESTAURANT_COORDINATES` (which sets distance to `0 km` and bypasses the 7 km delivery zone and 500m doorstep geofence). In `getUserAddresses(null, null)`, never fall back to `list` when `guestAddrs` is empty.
- **Dual-API Semantic Parity:** In `api/` vs `functions/api/`, verify identical `DEFAULT_SETTINGS_FALLBACK` keys (including `offerMinOrder: 199`), camelCase + snake_case field mapping (`upiVpa ?? upi_vpa`), webhook 5-minute replay + `payment_status === 'SUCCESS'` gates, and sanitized alphanumeric IDs before PostgREST `.or()` filters.
- **Live MCP Verification:** During security or DB audits, call `supabase_other` (`get_advisors` / `list_tables`) to verify live database RLS policies alongside local SQL files.
