-- ==============================================================================
-- SAVERA PARADISE — MASTER CONSOLIDATED PRODUCTION SECURITY HARDENING SCRIPT
-- ==============================================================================
-- Purpose:
--   This is the SINGLE AUTHORITATIVE SQL script for securing your live Supabase
--   database. It replaces the need to run historical migrations 01-10 in sequence.
--
-- What this script accomplishes:
--   1. Revokes public/anon access to clear_all_orders() to prevent unauthorized order deletion.
--   2. Revokes and drops the obsolete verify_rider_pin() RPC to eliminate PIN brute-forcing.
--   3. Completely locks down public.riders so confidential PINs and phones are never scraped.
--   4. Completely locks down public.orders against direct anon writes, updates, and deletes.
--   5. Preserves customer order tracking through the secure track_guest_order() RPC.
--   6. Protects dishes, categories, and store_settings (public read, private staff write).
--   7. Enforces monotonic order lifecycle progression (delivered/cancelled orders cannot be regressed).
--
-- Safety:
--   - 100% Idempotent (safe to run multiple times).
--   - Wrapped in an atomic transaction (BEGIN ... COMMIT).
--   - 5-second lock timeout to prevent blocking live kitchen operations.
-- ==============================================================================

BEGIN;

SET lock_timeout = '5s';

-- ------------------------------------------------------------------------------
-- 1. LOCK DOWN DANGEROUS DATABASE FUNCTIONS (RPCs)
-- ------------------------------------------------------------------------------

-- 1.1 Revoke public/anon access to clear_all_orders()
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'clear_all_orders') THEN
    REVOKE ALL ON FUNCTION public.clear_all_orders() FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.clear_all_orders() FROM anon;
    REVOKE EXECUTE ON FUNCTION public.clear_all_orders() FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.clear_all_orders() TO service_role;
  END IF;
END $$;

-- 1.2 Deprecate & Drop verify_rider_pin() RPC
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'verify_rider_pin') THEN
    REVOKE ALL ON FUNCTION public.verify_rider_pin(TEXT) FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.verify_rider_pin(TEXT) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.verify_rider_pin(TEXT) FROM authenticated;
    DROP FUNCTION IF EXISTS public.verify_rider_pin(TEXT);
  END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 2. LOCK DOWN RIDERS TABLE (public.riders)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'riders') THEN
    ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

    -- Drop all legacy, open, and permissive policies
    DROP POLICY IF EXISTS "app_manage_riders" ON public.riders;
    DROP POLICY IF EXISTS "public_read_riders" ON public.riders;
    DROP POLICY IF EXISTS "staff_read_riders" ON public.riders;
    DROP POLICY IF EXISTS "staff_update_riders" ON public.riders;
    DROP POLICY IF EXISTS "riders_staff_only" ON public.riders;
    DROP POLICY IF EXISTS "allow_all_riders" ON public.riders;
    DROP POLICY IF EXISTS "service_manage_riders" ON public.riders;
    DROP POLICY IF EXISTS "service_role_manage_riders" ON public.riders;

    -- Revoke all table access from anon, authenticated, and public
    REVOKE ALL ON TABLE public.riders FROM anon;
    REVOKE ALL ON TABLE public.riders FROM authenticated;
    REVOKE ALL ON TABLE public.riders FROM public;

    -- Grant full management privileges exclusively to service_role
    GRANT ALL ON TABLE public.riders TO service_role;

    CREATE POLICY "service_role_manage_riders" ON public.riders
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 3. LOCK DOWN ORDERS TABLE (public.orders)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders') THEN
    ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

    -- Drop all legacy and open policies
    DROP POLICY IF EXISTS "orders_public_insert" ON public.orders;
    DROP POLICY IF EXISTS "orders_anon_insert" ON public.orders;
    DROP POLICY IF EXISTS "orders_public_select" ON public.orders;
    DROP POLICY IF EXISTS "orders_anon_select" ON public.orders;
    DROP POLICY IF EXISTS "orders_read_policy" ON public.orders;
    DROP POLICY IF EXISTS "orders_write_policy" ON public.orders;
    DROP POLICY IF EXISTS "orders_update_policy" ON public.orders;
    DROP POLICY IF EXISTS "orders_delete_policy" ON public.orders;
    DROP POLICY IF EXISTS "allow_all_orders" ON public.orders;
    DROP POLICY IF EXISTS "public_read_orders" ON public.orders;
    DROP POLICY IF EXISTS "authenticated_insert_orders" ON public.orders;
    DROP POLICY IF EXISTS "authenticated_update_orders" ON public.orders;
    DROP POLICY IF EXISTS "service_role_manage_orders" ON public.orders;

    -- Revoke direct mutations and reads from anon and public
    REVOKE ALL ON TABLE public.orders FROM anon;
    REVOKE ALL ON TABLE public.orders FROM public;

    -- Grant full management privileges to service_role
    GRANT ALL ON TABLE public.orders TO service_role;

    CREATE POLICY "service_role_manage_orders" ON public.orders
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 4. AUTHORITATIVE GUEST ORDER TRACKING RPC (track_guest_order)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_guest_order(p_order_id TEXT, p_tracking_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  clean_id TEXT;
  o RECORD;
BEGIN
  IF p_order_id IS NULL OR p_tracking_token IS NULL THEN
    RETURN NULL;
  END IF;

  clean_id := regexp_replace(trim(p_order_id), '^#+', '');

  SELECT id, status, status_label, step_index, eta, total, numeric_total,
         items, created_at, delivered_at, assigned_rider_name, assigned_rider_phone,
         assigned_rider_vehicle, cancellation_reason
  INTO o
  FROM public.orders
  WHERE (id = clean_id OR id = ('#' || clean_id))
    AND tracking_token = p_tracking_token
  LIMIT 1;

  IF o.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(o);
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_guest_order(TEXT, UUID) TO anon, authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 5. SECURE DISHES, CATEGORIES & STORE SETTINGS
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  -- 5.1 Dishes (Public Read, Service Role Write)
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dishes') THEN
    ALTER TABLE public.dishes ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "app_manage_dishes" ON public.dishes;
    DROP POLICY IF EXISTS "dishes_public_read" ON public.dishes;
    DROP POLICY IF EXISTS "service_role_manage_dishes" ON public.dishes;

    REVOKE INSERT, UPDATE, DELETE ON TABLE public.dishes FROM anon, public;
    GRANT SELECT ON TABLE public.dishes TO anon, authenticated, public;
    GRANT ALL ON TABLE public.dishes TO service_role;

    CREATE POLICY "dishes_public_read" ON public.dishes FOR SELECT USING (true);
    CREATE POLICY "service_role_manage_dishes" ON public.dishes FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- 5.2 Categories (Public Read, Service Role Write)
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'categories') THEN
    ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "app_manage_categories" ON public.categories;
    DROP POLICY IF EXISTS "categories_public_read" ON public.categories;
    DROP POLICY IF EXISTS "service_role_manage_categories" ON public.categories;

    REVOKE INSERT, UPDATE, DELETE ON TABLE public.categories FROM anon, public;
    GRANT SELECT ON TABLE public.categories TO anon, authenticated, public;
    GRANT ALL ON TABLE public.categories TO service_role;

    CREATE POLICY "categories_public_read" ON public.categories FOR SELECT USING (true);
    CREATE POLICY "service_role_manage_categories" ON public.categories FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- 5.3 Store Settings (Public Read, Service Role Write)
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'store_settings') THEN
    ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "app_manage_store_settings" ON public.store_settings;
    DROP POLICY IF EXISTS "store_settings_public_read" ON public.store_settings;
    DROP POLICY IF EXISTS "service_role_manage_store_settings" ON public.store_settings;

    REVOKE INSERT, UPDATE, DELETE ON TABLE public.store_settings FROM anon, public;
    GRANT SELECT ON TABLE public.store_settings TO anon, authenticated, public;
    GRANT ALL ON TABLE public.store_settings TO service_role;

    CREATE POLICY "store_settings_public_read" ON public.store_settings FOR SELECT USING (true);
    CREATE POLICY "service_role_manage_store_settings" ON public.store_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 6. MONOTONIC PIPELINE PROTECTION TRIGGER
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_order_status_monotonicity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'delivered' AND NEW.status != 'delivered' THEN
    RAISE EXCEPTION 'Cannot modify an already delivered order';
  END IF;
  IF OLD.status = 'undelivered' AND NEW.status != 'undelivered' THEN
    RAISE EXCEPTION 'Cannot modify an undelivered order';
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status != 'cancelled' THEN
    RAISE EXCEPTION 'Cannot modify a cancelled order';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_status_monotonicity ON public.orders;
CREATE TRIGGER trg_order_status_monotonicity
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_status_monotonicity();

COMMIT;
