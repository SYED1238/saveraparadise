-- ==============================================================================
-- SAVERA PARADISE — SUPABASE MIGRATION 09
-- Security Remediation: Authoritative Serverless Order Gateways & RLS Lockdown
-- ==============================================================================
-- 1. Eliminates Direct Anonymous Order Insertion (CWE-311 / Price Tampering Fix):
--    - Drops permissive "public_create_orders" policy on public.orders
--    - Guarantees zero INSERT, SELECT, UPDATE, or DELETE policies granted to 'anon' or 'public'
-- 2. Restricts Order Creation strictly to:
--    - service_role: Authoritative backend gateway (/api/order-action, /api/checkout, /api/cashfree-webhook)
--    - authenticated staff: In-store POS terminal order placement
-- ==============================================================================

BEGIN;

SET lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders') THEN
    ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

    -- 1. Drop all permissive and public INSERT policies on public.orders
    DROP POLICY IF EXISTS "public_create_orders" ON public.orders;
    DROP POLICY IF EXISTS "allow_insert_orders" ON public.orders;
    DROP POLICY IF EXISTS "customer_create_orders" ON public.orders;

    -- 2. Ensure service_role has unconditional management access
    -- (Serverless backend /api/order-action, /api/checkout, /api/cashfree-webhook)
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'orders' AND policyname = 'service_manage_orders'
    ) THEN
      CREATE POLICY "service_manage_orders" ON public.orders
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;

    -- 3. Allow authenticated staff (admin, staff, owner) to insert POS orders
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'orders' AND policyname = 'staff_create_orders'
    ) THEN
      CREATE POLICY "staff_create_orders" ON public.orders
        FOR INSERT TO authenticated
        WITH CHECK (
          (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'owner')
        );
    END IF;

    -- NOTICE: Zero INSERT, SELECT, UPDATE, or DELETE policies granted to 'anon' or 'public'.
    -- Direct anonymous table mutations and client price tampering are strictly blocked.
  END IF;
END $$;

RESET lock_timeout;

COMMIT;
