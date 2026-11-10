# Database Migration & Security Guide

## Summary
The repository contains historical migration files (`supabase_migration_01` through `supabase_migration_10`) created during iterative development.

> **CRITICAL OPERATIONAL NOTICE:**  
> **DO NOT execute migrations 01–10 sequentially on a live database.**  
> Running them in order will re-open older permissions, introduce conflicting triggers, or grant public access to dangerous functions (such as `clear_all_orders`).

---

## Single Production Master Script

For all live database environments, use the consolidated and idempotent master script:
👉 **[`supabase_production_security_hardening.sql`](./supabase_production_security_hardening.sql)**

### What the Master Script Enforces:
1. **Locks Down `clear_all_orders()`:** Revokes execution from `anon`, `authenticated`, and `PUBLIC`. Grants execution strictly to `service_role` (used exclusively by the authenticated Owner endpoint `/api/admin-store`).
2. **Eliminates `verify_rider_pin()`:** Drops the public RPC that allowed brute-forcing 4-digit PINs. Fleet riders authenticate exclusively via `/api/admin-auth`.
3. **Locks Down `public.riders`:** Revokes table access from anonymous callers to prevent scraping delivery boy PINs and phone numbers.
4. **Locks Down `public.orders`:** Prevents anonymous row creation, updates, or deletions. Order creation requires verified checkout tokens signed by the server gateway.
5. **Preserves Customer Tracking (`track_guest_order`):** Customers securely track their food using their unique `#QB-` order ID and UUID tracking token.
6. **Protects Menu & Settings:** Storefront visitors can read dishes and categories, but only authenticated staff can mutate prices, dishes, or store configurations.
7. **Pipeline Monotonicity:** Database-level trigger prevents tampering with terminal orders (`delivered`, `cancelled`).

---

## Migration History Reference

| File | Status | Notes |
| :--- | :--- | :--- |
| `supabase_setup.sql` | **Base Schema** | Initial tables and indexes. Do not rerun on live DB. |
| `01_orders_schema.sql` | **Historical** | Initial columns and tracking tokens. |
| `02_security_policies.sql` | **Deprecated** | Incompatible proposal based on Supabase Auth. Do not run. |
| `03_cashfree_payments.sql` | **Historical** | Cashfree gateway columns. |
| `03_undelivered_status.sql`| **Superseded** | Replaced by Migration 08 triggers. |
| `04_cashfree_and_rls_alignment.sql` | **Historical** | Contained older permissive policies and seed riders. |
| `05_security_and_financial_hardening.sql` | **Partially Superseded** | Financial triggers superseded by Migration 08. |
| `06_secure_rls_and_payouts.sql` | **Superseded** | Rider policies superseded by Migration 10. |
| `07_fix_clear_orders_rpc.sql` | **Hardened** | Fixed to revoke public/anon execution. |
| `08_secure_orders_rls.sql` | **Active / Merged** | Included in master consolidation script. |
| `09_secure_order_gateways.sql` | **Active / Merged** | Included in master consolidation script. |
| `10_secure_riders_rls.sql` | **Active / Merged** | Included in master consolidation script. |
| `11_atomic_category_deletion.sql` | **Active / Merged** | Transactional delete_category_cascade RPC. |
| `12_secure_orders_update_policy.sql` | **Active / Merged** | Eliminates customer self-update vulnerability on orders. |
| `supabase_production_security_hardening.sql` | **AUTHORITATIVE MASTER** | **The single script to run on live database.** |
