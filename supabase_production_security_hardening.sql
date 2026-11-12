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
    DROP POLICY IF EXISTS "authenticated_select_orders" ON public.orders;
    DROP POLICY IF EXISTS "service_role_manage_orders" ON public.orders;
    DROP POLICY IF EXISTS "service_manage_orders" ON public.orders;
    DROP POLICY IF EXISTS "app_read_orders" ON public.orders;
    DROP POLICY IF EXISTS "app_update_orders" ON public.orders;
    DROP POLICY IF EXISTS "admin_rider_update_orders" ON public.orders;
    DROP POLICY IF EXISTS "customer_read_orders" ON public.orders;
    DROP POLICY IF EXISTS "allow_insert_orders" ON public.orders;
    DROP POLICY IF EXISTS "orders_update_staff_only" ON public.orders;
    DROP POLICY IF EXISTS "orders_select_owner_or_staff" ON public.orders;

    -- Revoke direct mutations and reads from anon and public
    REVOKE ALL ON TABLE public.orders FROM anon;
    REVOKE ALL ON TABLE public.orders FROM public;

    -- Grant full management privileges to service_role
    GRANT ALL ON TABLE public.orders TO service_role;

    CREATE POLICY "service_role_manage_orders" ON public.orders
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);

    -- Authenticated staff and customer owner reads
    CREATE POLICY "authenticated_select_orders" ON public.orders
      FOR SELECT TO authenticated
      USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider', 'owner')
        OR (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
      );

    -- Direct SQL updates strictly restricted to authorized staff/rider/owner roles
    -- Customer self-updates (auth.uid() = user_id) are strictly removed.
    CREATE POLICY "authenticated_update_orders" ON public.orders
      FOR UPDATE TO authenticated
      USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider', 'owner')
      )
      WITH CHECK (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider', 'owner')
      );
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

  SELECT id, status, status_label, step_index, eta, total,
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


-- ------------------------------------------------------------------------------
-- 7. SCHEMA ALIGNMENT: COLUMN INTEGRITY (DISHES, ORDERS, RIDERS)
-- ------------------------------------------------------------------------------
-- 7.1 Dish Scheduling & Original Price Columns
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS original_price NUMERIC;
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS available_days TEXT[] DEFAULT '{mon,tue,wed,thu,fri,sat,sun}';
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS time_restricted BOOLEAN DEFAULT FALSE;
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS available_from TEXT DEFAULT '';
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS available_to TEXT DEFAULT '';

-- 7.2 Orders Tip Amount Column
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tip_amount NUMERIC DEFAULT 0;

-- 7.3 Fleet Riders Payout & Settlement Columns
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS upi_vpa VARCHAR(64) DEFAULT NULL;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS bank_account_no VARCHAR(32) DEFAULT NULL;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(16) DEFAULT NULL;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS payout_method_pref VARCHAR(16) DEFAULT 'cash';
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS earnings NUMERIC DEFAULT 0;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS trips INTEGER DEFAULT 0;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS cash_settled_at BIGINT;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS payout_paid_at BIGINT;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS payout_amount_paid NUMERIC DEFAULT 0;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS cash_handover_status TEXT DEFAULT NULL;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS cash_handover_amount NUMERIC DEFAULT 0;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS cash_handover_requested_at BIGINT DEFAULT NULL;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS max_active_orders INTEGER NOT NULL DEFAULT 1;


-- ------------------------------------------------------------------------------
-- 8. ATOMIC CATEGORY & DISHES CASCADE DELETION RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_category_cascade(
    p_category_id TEXT,
    p_category_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_key TEXT;
    v_matched_id TEXT;
    v_dishes_deleted INT := 0;
    v_categories_deleted INT := 0;
BEGIN
    IF p_category_id IS NULL OR TRIM(p_category_id) = '' THEN
        RAISE EXCEPTION 'Category ID is required';
    END IF;

    v_target_key := COALESCE(NULLIF(TRIM(p_category_key), ''), p_category_id);

    -- 1. Check and lock target category row FIRST before touching any dishes
    SELECT id INTO v_matched_id
    FROM public.categories
    WHERE id = p_category_id OR id = v_target_key
    LIMIT 1
    FOR UPDATE;

    -- If category does not exist, abort immediately with 0 changes
    IF v_matched_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'not_found', true,
            'error', 'Category not found in database',
            'dishes_deleted', 0,
            'categories_deleted', 0
        );
    END IF;

    -- 2. Delete all dishes matching either the category id or slug key
    WITH deleted_dishes AS (
        DELETE FROM public.dishes
        WHERE category = v_target_key OR category = p_category_id OR category = v_matched_id
        RETURNING id
    )
    SELECT COUNT(*) INTO v_dishes_deleted FROM deleted_dishes;

    -- 3. Delete the category record
    DELETE FROM public.categories
    WHERE id = v_matched_id;
    v_categories_deleted := 1;

    RETURN jsonb_build_object(
        'success', true,
        'category_id', v_matched_id,
        'dishes_deleted', v_dishes_deleted,
        'categories_deleted', v_categories_deleted
    );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_category_cascade(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_category_cascade(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.delete_category_cascade(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_category_cascade(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.rider_assign_or_claim_order(
  p_action TEXT,
  p_order_id TEXT,
  p_rider_pin TEXT,
  p_rider_name TEXT DEFAULT NULL,
  p_rider_phone TEXT DEFAULT NULL,
  p_rider_vehicle TEXT DEFAULT 'Bike',
  p_eta TEXT DEFAULT NULL,
  p_within_counter_zone BOOLEAN DEFAULT FALSE,
  p_is_rider BOOLEAN DEFAULT TRUE,
  p_now_ms BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now_ms BIGINT := COALESCE(p_now_ms, FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT);
  v_clean_id TEXT := REGEXP_REPLACE(COALESCE(p_order_id, ''), '^#', '');
  v_order public.orders%ROWTYPE;
  v_max_allowed INTEGER := 1;
  v_rider_max INTEGER;
  v_existing_pin TEXT;
  v_other_active_count INTEGER := 0;
  v_otw_count INTEGER := 0;
  v_first_otw_id TEXT;
  v_all_recent_pickup BOOLEAN := FALSE;
  v_details JSONB;
  v_updated public.orders%ROWTYPE;
BEGIN
  IF p_rider_pin IS NOT NULL AND TRIM(p_rider_pin) <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('rider_cap_' || TRIM(p_rider_pin)));

    SELECT max_active_orders INTO v_rider_max
    FROM public.riders
    WHERE pin = TRIM(p_rider_pin)
    FOR UPDATE;

    IF v_rider_max IS NOT NULL THEN
      v_max_allowed := GREATEST(1, LEAST(4, v_rider_max));
    END IF;
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = v_clean_id OR id = ('#' || v_clean_id)
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 404, 'error', 'Order not found');
  END IF;

  v_existing_pin := COALESCE(TRIM(v_order.assigned_rider_pin), '');

  IF p_action = 'assign_order' THEN
    IF v_existing_pin <> '' AND v_existing_pin <> COALESCE(TRIM(p_rider_pin), '') THEN
      RETURN jsonb_build_object(
        'ok', false,
        'http_status', 409,
        'error', 'Order is already accepted by another rider',
        'claimedBy', v_order.assigned_rider_name
      );
    END IF;

    IF v_order.status <> 'ready_for_pickup' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'http_status', 400,
        'error', format('Order is not ready for pickup (current status: %s)', v_order.status)
      );
    END IF;

    IF COALESCE(TRIM(p_rider_pin), '') <> '' AND v_existing_pin <> TRIM(p_rider_pin) THEN
      SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'on_the_way'),
        MIN(id) FILTER (WHERE status = 'on_the_way'),
        COALESCE(
          BOOL_AND(
            CASE WHEN status = 'on_the_way' THEN
              (FLOOR(COALESCE(NULLIF(address_details->>'pickedUpAt', ''), '0')::NUMERIC)::BIGINT > 0
                AND (v_now_ms - FLOOR(COALESCE(NULLIF(address_details->>'pickedUpAt', ''), '0')::NUMERIC)::BIGINT) <= 180000)
            ELSE TRUE END
          ),
          FALSE
        )
      INTO v_other_active_count, v_otw_count, v_first_otw_id, v_all_recent_pickup
      FROM public.orders
      WHERE assigned_rider_pin = TRIM(p_rider_pin)
        AND status IN ('on_the_way', 'ready_for_pickup', 'cooking', 'accepted')
        AND REGEXP_REPLACE(id, '^#', '') <> v_clean_id;

      IF v_otw_count > 0 THEN
        IF NOT (v_max_allowed > 1 AND v_other_active_count < v_max_allowed AND (COALESCE(p_within_counter_zone, FALSE) OR v_all_recent_pickup)) THEN
          RETURN jsonb_build_object(
            'ok', false,
            'http_status', 409,
            'code', 'ACTIVE_ORDER_LIMIT',
            'error', format('Rider already has an active order (%s) on the way. Complete current delivery before accepting another order.', COALESCE(v_first_otw_id, ''))
          );
        END IF;
      END IF;

      IF v_other_active_count >= v_max_allowed THEN
        RETURN jsonb_build_object(
          'ok', false,
          'http_status', 409,
          'code', 'ACTIVE_ORDER_LIMIT',
          'error', format('Rider has reached the active order limit (%s). Complete existing order(s) first.', v_max_allowed)
        );
      END IF;
    END IF;

    v_details := COALESCE(v_order.address_details, '{}'::jsonb) || jsonb_build_object(
      'riderPickupStage', 'going_to_restaurant',
      'riderAssignedAt', v_now_ms
    );

    UPDATE public.orders
    SET status_label = 'Rider Going to Restaurant',
        eta = COALESCE(NULLIF(TRIM(p_eta), ''), NULLIF(TRIM(v_order.eta), ''), 'Heading to Restaurant'),
        assigned_rider_pin = NULLIF(TRIM(p_rider_pin), ''),
        assigned_rider_name = NULLIF(TRIM(p_rider_name), ''),
        assigned_rider_phone = NULLIF(TRIM(p_rider_phone), ''),
        assigned_rider_vehicle = COALESCE(NULLIF(TRIM(p_rider_vehicle), ''), 'Bike'),
        address_details = v_details
    WHERE id = v_order.id
    RETURNING * INTO v_updated;

    RETURN jsonb_build_object('ok', true, 'http_status', 200, 'order', to_jsonb(v_updated));
  END IF;

  IF p_action = 'claim_order' THEN
    IF p_is_rider THEN
      IF v_existing_pin <> '' AND v_existing_pin <> COALESCE(TRIM(p_rider_pin), '') THEN
        RETURN jsonb_build_object(
          'ok', false,
          'http_status', 409,
          'error', 'Order is already claimed by another rider',
          'claimedBy', v_order.assigned_rider_name
        );
      END IF;

      IF NOT (v_existing_pin <> '' AND v_existing_pin = COALESCE(TRIM(p_rider_pin), '') AND v_order.status = 'on_the_way') THEN
        IF v_order.status <> 'ready_for_pickup' THEN
          RETURN jsonb_build_object(
            'ok', false,
            'http_status', 400,
            'error', format('Order is not ready for pickup (current status: %s). Food must be ready on counter before claim.', v_order.status)
          );
        END IF;

        IF COALESCE(TRIM(p_rider_pin), '') <> '' THEN
          SELECT COUNT(*), MIN(id)
          INTO v_otw_count, v_first_otw_id
          FROM public.orders
          WHERE assigned_rider_pin = TRIM(p_rider_pin)
            AND status = 'on_the_way'
            AND REGEXP_REPLACE(id, '^#', '') <> v_clean_id;

          IF v_otw_count >= v_max_allowed THEN
            RETURN jsonb_build_object(
              'ok', false,
              'http_status', 409,
              'code', 'ACTIVE_ORDER_LIMIT',
              'error', format('Rider already has an active order (%s) on the way. Complete current delivery before claiming another order.', COALESCE(v_first_otw_id, ''))
            );
          END IF;
        END IF;
      END IF;
    END IF;

    v_details := COALESCE(v_order.address_details, '{}'::jsonb) || jsonb_build_object(
      'riderPickupStage', 'picked_up',
      'pickedUpAt', v_now_ms
    );

    UPDATE public.orders
    SET status = 'on_the_way',
        step_index = 3,
        status_label = 'Rider is on the Way Towards You',
        assigned_rider_pin = NULLIF(TRIM(p_rider_pin), ''),
        assigned_rider_name = NULLIF(TRIM(p_rider_name), ''),
        assigned_rider_phone = NULLIF(TRIM(p_rider_phone), ''),
        assigned_rider_vehicle = COALESCE(NULLIF(TRIM(p_rider_vehicle), ''), 'Bike'),
        address_details = v_details
    WHERE id = v_order.id
    RETURNING * INTO v_updated;

    RETURN jsonb_build_object('ok', true, 'http_status', 200, 'order', to_jsonb(v_updated));
  END IF;

  RETURN jsonb_build_object('ok', false, 'http_status', 400, 'error', 'Unsupported rider order action');
END;
$$;

REVOKE ALL ON FUNCTION public.rider_assign_or_claim_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rider_assign_or_claim_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.rider_assign_or_claim_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rider_assign_or_claim_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BIGINT) TO service_role;

COMMIT;
