-- ==============================================================================
-- SAVERA PARADISE — SUPABASE MIGRATION 10
-- Security Remediation: Lockdown public.riders & Eliminate Anonymous PIN Scraping
-- ==============================================================================
-- 1. Complete RLS Hardening on public.riders:
--    - Drops open/permissive "app_manage_riders", "public_read_riders", and "staff_read_riders"
--    - Guarantees zero SELECT, INSERT, UPDATE, or DELETE permissions granted to 'anon' or 'public'
--    - Prevents malicious anonymous dumping of rider PINs, names, phone numbers, and bank details
-- 2. Strict Privilege Grants:
--    - Table access is strictly restricted to service_role (used by /api/admin-auth & /api/admin-store)
--    - Staff and dynamic riders authenticate through backend HMAC tokens
-- 3. Revoke/Drop public verify_rider_pin RPC:
--    - Completely removes the public PIN enumeration vector
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

  -- 5. Revoke execute privileges and drop vulnerable public verify_rider_pin RPC
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'verify_rider_pin') THEN
    REVOKE EXECUTE ON FUNCTION public.verify_rider_pin(TEXT) FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.verify_rider_pin(TEXT) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.verify_rider_pin(TEXT) FROM authenticated;
    DROP FUNCTION IF EXISTS public.verify_rider_pin(TEXT);
  END IF;
END $$;

COMMIT;
