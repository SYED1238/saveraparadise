-- ==============================================================================
-- SAVERA PARADISE — SUPABASE MIGRATION 08
-- Security Remediation: Strict Order Mutation Invariants & Hardened RLS Policies
-- ==============================================================================
-- 1. Eliminates Unrestricted SELECT Policy on public.orders (Plugs Customer PII Leak)
-- 2. Eliminates Unrestricted UPDATE Policy on public.orders (Plugs Stranger Tamper Loophole)
-- 3. Enforces Role Separation:
--    - service_role: Authoritative backend APIs (/api/order-action, /api/cashfree-webhook)
--    - authenticated: Role-checked staff and verified customer order owners
--    - anon: Denied direct mutations; guest tracking mediated via secure token RPC
-- 4. Enforces Hardened Database-Level Mutation Security Trigger:
--    - search_path pinned to public, pg_temp (CWE-426 fix)
--    - Terminal order immutability (unconditionally locked once delivered/cancelled)
--    - Strict financial & customer PII immutability
--    - Payment integrity: payment_status, is_paid_online, cf_payment_status locked to service_role
--    - Order lifecycle forward progression & cancellation boundary rules
-- ==============================================================================

BEGIN;

SET lock_timeout = '5s';

-- ------------------------------------------------------------------------------
-- 1. HARDEN ROW-LEVEL SECURITY POLICIES ON public.orders
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders') THEN
    ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

    -- Clean up legacy, wide-open or duplicate policies
    DROP POLICY IF EXISTS "app_read_orders" ON public.orders;
    DROP POLICY IF EXISTS "app_update_orders" ON public.orders;
    DROP POLICY IF EXISTS "admin_rider_update_orders" ON public.orders;
    DROP POLICY IF EXISTS "customer_read_orders" ON public.orders;
    DROP POLICY IF EXISTS "allow_insert_orders" ON public.orders;
    DROP POLICY IF EXISTS "orders_update_staff_only" ON public.orders;
    DROP POLICY IF EXISTS "orders_select_owner_or_staff" ON public.orders;
    DROP POLICY IF EXISTS "service_manage_orders" ON public.orders;
    DROP POLICY IF EXISTS "authenticated_update_orders" ON public.orders;
    DROP POLICY IF EXISTS "authenticated_select_orders" ON public.orders;

    -- Clean up legacy, wide-open or public insert policies
    DROP POLICY IF EXISTS "public_create_orders" ON public.orders;
    DROP POLICY IF EXISTS "customer_create_orders" ON public.orders;

    -- 1.1 Full management access strictly to service_role
    -- (Serverless backend /api/order-action, /api/checkout, /api/cashfree-webhook)
    CREATE POLICY "service_manage_orders" ON public.orders
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);

    -- 1.2 Authenticated staff and customer owner reads
    CREATE POLICY "authenticated_select_orders" ON public.orders
      FOR SELECT TO authenticated
      USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider', 'owner')
        OR (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
      );

    -- 1.3 Authenticated staff and customer owner updates
    CREATE POLICY "authenticated_update_orders" ON public.orders
      FOR UPDATE TO authenticated
      USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider', 'owner')
        OR (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
      )
      WITH CHECK (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider', 'owner')
        OR (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
      );

    -- NOTICE: Zero INSERT, SELECT, UPDATE, or DELETE policies granted to 'anon' or 'public'.
    -- Direct anonymous table mutations and client price tampering are strictly blocked.
    -- Order creation is strictly mediated via authoritative serverless gateway (/api/order-action via service_role).
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. SECURE RPC FOR GUEST CUSTOMER LIVE ORDER TRACKING
-- ------------------------------------------------------------------------------
-- Allows customers to track their order status strictly by providing order ID + matching tracking token.
-- Prevents harvesting or enumerating stranger order information.
CREATE OR REPLACE FUNCTION public.get_order_status_by_token(p_order_id TEXT, p_tracking_token TEXT)
RETURNS TABLE (
  id TEXT,
  status TEXT,
  step_index INT,
  status_label TEXT,
  eta TEXT,
  items_summary TEXT,
  total NUMERIC,
  payment_method TEXT,
  payment_status TEXT,
  is_paid_online BOOLEAN,
  assigned_rider_name TEXT,
  assigned_rider_phone TEXT,
  assigned_rider_vehicle TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.status,
    o.step_index,
    o.status_label,
    o.eta,
    o.items_summary,
    o.total,
    o.payment_method,
    o.payment_status,
    o.is_paid_online,
    o.assigned_rider_name,
    o.assigned_rider_phone,
    o.assigned_rider_vehicle,
    o.created_at
  FROM public.orders o
  WHERE (o.id = p_order_id OR o.id = ('#' || p_order_id) OR ('#' || o.id) = p_order_id)
    AND o.tracking_token = p_tracking_token;
END;
$$;

REVOKE ALL ON FUNCTION public.get_order_status_by_token(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_status_by_token(TEXT, TEXT) TO anon, authenticated, service_role;

-- Batch helper for multi-order customer session tracking
CREATE OR REPLACE FUNCTION public.get_orders_by_tracking_tokens(p_order_ids TEXT[], p_tracking_tokens TEXT[])
RETURNS TABLE (
  id TEXT,
  status TEXT,
  step_index INT,
  status_label TEXT,
  eta TEXT,
  items_summary TEXT,
  total NUMERIC,
  payment_method TEXT,
  payment_status TEXT,
  is_paid_online BOOLEAN,
  assigned_rider_name TEXT,
  assigned_rider_phone TEXT,
  assigned_rider_vehicle TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.status,
    o.step_index,
    o.status_label,
    o.eta,
    o.items_summary,
    o.total,
    o.payment_method,
    o.payment_status,
    o.is_paid_online,
    o.assigned_rider_name,
    o.assigned_rider_phone,
    o.assigned_rider_vehicle,
    o.created_at
  FROM public.orders o
  WHERE (o.id = ANY(p_order_ids) OR ('#' || o.id) = ANY(p_order_ids))
    AND o.tracking_token = ANY(p_tracking_tokens);
END;
$$;

REVOKE ALL ON FUNCTION public.get_orders_by_tracking_tokens(TEXT[], TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_by_tracking_tokens(TEXT[], TEXT[]) TO anon, authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 3. HARDENED ORDER MUTATION SECURITY TRIGGER
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_order_financial_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := auth.role();
  v_is_service_role BOOLEAN := (v_role = 'service_role');
  v_old_rank INT := 0;
  v_new_rank INT := 0;
BEGIN
  -- 1. Trusted backend operations (authoritative serverless endpoints via service_role)
  IF v_is_service_role THEN
    RETURN NEW;
  END IF;

  -- 2. Terminal State Immutability:
  -- Once an order reaches terminal status (delivered, undelivered, cancelled),
  -- no further client-side modifications are permitted.
  IF OLD.status IN ('delivered', 'undelivered', 'cancelled') THEN
    RAISE EXCEPTION 'Order % is in terminal status (%) and cannot be modified.', OLD.id, OLD.status;
  END IF;

  -- 3. Financial Immutability:
  -- Total, items, and customer account user_id are strictly immutable after creation.
  IF (OLD.total IS NOT NULL AND NEW.total IS DISTINCT FROM OLD.total)
     OR (OLD.items IS NOT NULL AND NEW.items IS DISTINCT FROM OLD.items)
     OR (OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'Order financial totals and items are immutable after creation.';
  END IF;

  -- 4. Customer PII and Delivery Address Immutability:
  -- Delivery location, recipient name, phone, email, and pickup tags cannot be tampered with.
  IF (OLD.customer_phone IS NOT NULL AND NEW.customer_phone IS DISTINCT FROM OLD.customer_phone)
     OR (OLD.customer_name IS NOT NULL AND NEW.customer_name IS DISTINCT FROM OLD.customer_name)
     OR (OLD.customer_email IS NOT NULL AND NEW.customer_email IS DISTINCT FROM OLD.customer_email)
     OR (OLD.delivery_address IS NOT NULL AND NEW.delivery_address IS DISTINCT FROM OLD.delivery_address)
     OR (OLD.pickup_code IS NOT NULL AND NEW.pickup_code IS DISTINCT FROM OLD.pickup_code) THEN
    RAISE EXCEPTION 'Customer delivery information and pickup code are immutable after order placement.';
  END IF;

  -- 5. Payment Integrity Guard:
  -- Any change to payment status, online payment confirmation, or Cashfree reference requires service_role.
  IF (NEW.is_paid_online IS DISTINCT FROM OLD.is_paid_online)
     OR (NEW.cf_payment_status IS DISTINCT FROM OLD.cf_payment_status)
     OR (NEW.payment_status IS DISTINCT FROM OLD.payment_status) THEN
    RAISE EXCEPTION 'Unauthorized payment modification: Payment status can only be updated via verified server gateway.';
  END IF;

  -- 6. Order Lifecycle Progression & Customer Cancellation:
  IF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
    IF OLD.status NOT IN ('pending', 'accepted') THEN
      RAISE EXCEPTION 'Cannot cancel order once kitchen preparation has begun (% to %).', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  -- Calculate state progression ranks
  CASE OLD.status
    WHEN 'pending' THEN v_old_rank := 0;
    WHEN 'accepted' THEN v_old_rank := 1;
    WHEN 'cooking' THEN v_old_rank := 2;
    WHEN 'ready_for_pickup' THEN v_old_rank := 3;
    WHEN 'on_the_way' THEN v_old_rank := 4;
    WHEN 'delivered' THEN v_old_rank := 5;
    WHEN 'undelivered' THEN v_old_rank := 5;
    ELSE v_old_rank := 0;
  END CASE;

  CASE NEW.status
    WHEN 'pending' THEN v_new_rank := 0;
    WHEN 'accepted' THEN v_new_rank := 1;
    WHEN 'cooking' THEN v_new_rank := 2;
    WHEN 'ready_for_pickup' THEN v_new_rank := 3;
    WHEN 'on_the_way' THEN v_new_rank := 4;
    WHEN 'delivered' THEN v_new_rank := 5;
    WHEN 'undelivered' THEN v_new_rank := 5;
    ELSE v_new_rank := 0;
  END CASE;

  -- Invariant: Order status cannot regress backwards
  IF v_new_rank < v_old_rank THEN
    RAISE EXCEPTION 'Order status cannot regress backwards (% to %).', OLD.status, NEW.status;
  END IF;

  -- Invariant: Order cannot skip straight from pending/accepted to delivered
  IF v_old_rank < 3 AND NEW.status = 'delivered' THEN
    RAISE EXCEPTION 'Illegal order transition: Order cannot be marked delivered directly from % status.', OLD.status;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop obsolete reversal trigger if present
DROP TRIGGER IF EXISTS trg_prevent_order_status_reversal ON public.orders;

DROP TRIGGER IF EXISTS trg_prevent_order_financial_tampering ON public.orders;
CREATE TRIGGER trg_prevent_order_financial_tampering
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_order_financial_tampering();


-- ------------------------------------------------------------------------------
-- 4. HARDEN DISHES, CATEGORIES & STORE SETTINGS (BLOCK DIRECT CLIENT WRITES)
-- ------------------------------------------------------------------------------
-- 4.1 Dishes
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dishes') THEN
    ALTER TABLE public.dishes ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "app_manage_dishes" ON public.dishes;
    DROP POLICY IF EXISTS "staff_manage_dishes" ON public.dishes;
    DROP POLICY IF EXISTS "public_read_dishes" ON public.dishes;
    DROP POLICY IF EXISTS "service_manage_dishes" ON public.dishes;

    CREATE POLICY "public_read_dishes" ON public.dishes
      FOR SELECT USING (true);

    CREATE POLICY "service_manage_dishes" ON public.dishes
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);

    CREATE POLICY "staff_manage_dishes" ON public.dishes
      FOR ALL TO authenticated
      USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'owner'))
      WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'owner'));
  END IF;
END $$;

-- 4.2 Categories
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'categories') THEN
    ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "app_manage_categories" ON public.categories;
    DROP POLICY IF EXISTS "staff_manage_categories" ON public.categories;
    DROP POLICY IF EXISTS "public_read_categories" ON public.categories;
    DROP POLICY IF EXISTS "service_manage_categories" ON public.categories;

    CREATE POLICY "public_read_categories" ON public.categories
      FOR SELECT USING (true);

    CREATE POLICY "service_manage_categories" ON public.categories
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);

    CREATE POLICY "staff_manage_categories" ON public.categories
      FOR ALL TO authenticated
      USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'owner'))
      WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'owner'));
  END IF;
END $$;

-- 4.3 Store Settings
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'store_settings') THEN
    ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "app_manage_store_settings" ON public.store_settings;
    DROP POLICY IF EXISTS "staff_manage_store_settings" ON public.store_settings;
    DROP POLICY IF EXISTS "public_read_store_settings" ON public.store_settings;
    DROP POLICY IF EXISTS "service_manage_store_settings" ON public.store_settings;

    CREATE POLICY "public_read_store_settings" ON public.store_settings
      FOR SELECT USING (true);

    CREATE POLICY "service_manage_store_settings" ON public.store_settings
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);

    CREATE POLICY "staff_manage_store_settings" ON public.store_settings
      FOR ALL TO authenticated
      USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'owner'))
      WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'owner'));
  END IF;
END $$;

RESET lock_timeout;

COMMIT;
