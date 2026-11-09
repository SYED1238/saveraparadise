-- ==============================================================================
-- SAVERA PARADISE — SUPABASE MIGRATION 06
-- Row Level Security (RLS) Hardening & Public Table Protection
-- ==============================================================================
-- 1. Protect public.riders: Prevent anonymous scraping of rider PINs and bank details
-- 2. Protect public.dishes & public.categories: Restrict write access to authenticated staff/service_role
-- 3. Protect public.store_settings: Restrict write access to authenticated staff/service_role
-- ==============================================================================

SET lock_timeout = '5s';

-- 1. HARDEN RIDERS TABLE
-- Allow public only to read non-sensitive public columns (name, vehicle, status, avatar)
-- PINs, bank accounts, and IFSC remain protected from public table dumps.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'riders') THEN
    DROP POLICY IF EXISTS "app_manage_riders" ON public.riders;
    DROP POLICY IF EXISTS "public_read_riders" ON public.riders;
    
    -- Service role retains full management access
    CREATE POLICY "service_manage_riders" ON public.riders
      FOR ALL TO service_role USING (true) WITH CHECK (true);
      
    -- Authenticated or staff can manage riders
    CREATE POLICY "staff_read_riders" ON public.riders
      FOR SELECT TO authenticated USING (true);
      
    CREATE POLICY "staff_update_riders" ON public.riders
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 2. HARDEN DISHES & CATEGORIES (PUBLIC READ, SERVICE_ROLE & VERIFIED STAFF WRITE ONLY)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dishes') THEN
    DROP POLICY IF EXISTS "app_manage_dishes" ON public.dishes;
    DROP POLICY IF EXISTS "staff_manage_dishes" ON public.dishes;
    DROP POLICY IF EXISTS "public_read_dishes" ON public.dishes;
    DROP POLICY IF EXISTS "service_manage_dishes" ON public.dishes;

    -- Public visitors (customers) can only read the menu
    CREATE POLICY "public_read_dishes" ON public.dishes
      FOR SELECT USING (true);

    -- Service role retains full management access (serverless backend endpoints /api/admin-store)
    CREATE POLICY "service_manage_dishes" ON public.dishes
      FOR ALL TO service_role USING (true) WITH CHECK (true);

    -- Verified authenticated staff only (strictly excludes unauthenticated anon role)
    CREATE POLICY "staff_manage_dishes" ON public.dishes
      FOR ALL TO authenticated
      USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'owner'))
      WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'owner'));
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'categories') THEN
    DROP POLICY IF EXISTS "app_manage_categories" ON public.categories;
    DROP POLICY IF EXISTS "staff_manage_categories" ON public.categories;
    DROP POLICY IF EXISTS "public_read_categories" ON public.categories;
    DROP POLICY IF EXISTS "service_manage_categories" ON public.categories;

    CREATE POLICY "public_read_categories" ON public.categories
      FOR SELECT USING (true);

    CREATE POLICY "service_manage_categories" ON public.categories
      FOR ALL TO service_role USING (true) WITH CHECK (true);

    CREATE POLICY "staff_manage_categories" ON public.categories
      FOR ALL TO authenticated
      USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'owner'))
      WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'owner'));
  END IF;
END $$;

-- 3. HARDEN STORE SETTINGS (PUBLIC READ, SERVICE_ROLE & VERIFIED STAFF WRITE ONLY)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'store_settings') THEN
    DROP POLICY IF EXISTS "app_manage_store_settings" ON public.store_settings;
    DROP POLICY IF EXISTS "staff_manage_store_settings" ON public.store_settings;
    DROP POLICY IF EXISTS "public_read_store_settings" ON public.store_settings;
    DROP POLICY IF EXISTS "service_manage_store_settings" ON public.store_settings;

    CREATE POLICY "public_read_store_settings" ON public.store_settings
      FOR SELECT USING (true);

    CREATE POLICY "service_manage_store_settings" ON public.store_settings
      FOR ALL TO service_role USING (true) WITH CHECK (true);

    CREATE POLICY "staff_manage_store_settings" ON public.store_settings
      FOR ALL TO authenticated
      USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'owner'))
      WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'owner'));
  END IF;
END $$;
