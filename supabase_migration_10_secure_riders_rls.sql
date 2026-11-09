-- ==============================================================================
-- SAVERA PARADISE — SUPABASE MIGRATION 10
-- Security Remediation: Lockdown public.riders & Eliminate Anonymous PIN Scraping
-- ==============================================================================
-- 1. Complete RLS Hardening on public.riders:
--    - Drops open/permissive "app_manage_riders", "public_read_riders", and "staff_read_riders"
--    - Guarantees zero SELECT, INSERT, UPDATE, or DELETE permissions granted to 'anon' or 'public'
--    - Prevents malicious anonymous dumping of rider PINs, names, phone numbers, and bank details
-- 2. Strict Privilege Grants:
--    - Table access is strictly restricted to service_role (used by /api/admin-auth & /api/order-action)
--    - Staff and dynamic riders authenticate through backend HMAC tokens or verify_rider_pin RPC
-- ==============================================================================

BEGIN;

SET lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'riders') THEN
    ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

    -- 1. Drop all permissive, legacy, and public policies on public.riders
    DROP POLICY IF EXISTS "app_manage_riders" ON public.riders;
    DROP POLICY IF EXISTS "public_read_riders" ON public.riders;
    DROP POLICY IF EXISTS "staff_read_riders" ON public.riders;
    DROP POLICY IF EXISTS "staff_update_riders" ON public.riders;
    DROP POLICY IF EXISTS "riders_staff_only" ON public.riders;
    DROP POLICY IF EXISTS "allow_all_riders" ON public.riders;
    DROP POLICY IF EXISTS "service_manage_riders" ON public.riders;
    DROP POLICY IF EXISTS "service_role_manage_riders" ON public.riders;

    -- 2. Revoke all privileges from anon, authenticated, and public
    REVOKE ALL ON TABLE public.riders FROM anon;
    REVOKE ALL ON TABLE public.riders FROM authenticated;
    REVOKE ALL ON TABLE public.riders FROM public;

    -- 3. Grant full table privileges strictly to service_role
    GRANT ALL ON TABLE public.riders TO service_role;

    -- 4. Create authoritative service_role policy
    CREATE POLICY "service_role_manage_riders" ON public.riders
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

COMMIT;
