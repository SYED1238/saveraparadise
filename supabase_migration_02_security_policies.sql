-- =========================================================================
-- SAVERA PARADISE: STAGE 2 PRODUCTION SECURITY HARDENING & RLS POLICIES
-- PROPOSAL / DRAFT ONLY — DO NOT EXECUTE DIRECTLY ON LIVE INSTANCE!
-- ⚠️ ARCHITECTURE NOTE:
-- This draft migration assumes staff authenticate via Supabase Auth JWTs.
-- The current app authenticates kitchen & fleet riders via PIN in the app layer
-- and connects using SUPABASE_ANON_KEY. Executing this file will block staff
-- from updating order statuses and managing dishes. Use supabase_setup.sql
-- for the active production schema.
-- =========================================================================

SET lock_timeout = '2s';

-- -------------------------------------------------------------------------
-- 1. CUSTOMER ADDRESSES PII SHIELD (public.user_addresses)
-- -------------------------------------------------------------------------
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_user_addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "owner_manage_user_addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "staff_read_addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "user_addresses_owner_only" ON public.user_addresses;

-- Completely block anonymous visitors from selecting, inserting, or modifying customer addresses.
-- Only the authentic account owner or authorized staff may access.
CREATE POLICY "user_addresses_owner_only" ON public.user_addresses
  FOR ALL
  USING (
    (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
    OR (auth.jwt() ->> 'email' IS NOT NULL AND LOWER(auth.jwt() ->> 'email') = LOWER(user_email))
    OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
    OR (auth.jwt() ->> 'email' IS NOT NULL AND LOWER(auth.jwt() ->> 'email') = LOWER(user_email))
    OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  );

-- -------------------------------------------------------------------------
-- 2. DELIVERY FLEET & PIN PROTECTION (public.riders)
-- -------------------------------------------------------------------------
ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_riders" ON public.riders;
DROP POLICY IF EXISTS "public_read_riders" ON public.riders;
DROP POLICY IF EXISTS "riders_staff_only" ON public.riders;

-- Block anonymous access to the riders table completely.
CREATE POLICY "riders_staff_only" ON public.riders
  FOR ALL
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  );

-- Secure Single-Rider PIN Verification RPC
-- Verifies a submitted PIN and returns that rider's public profile WITHOUT exposing other riders
CREATE OR REPLACE FUNCTION public.verify_rider_pin(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
BEGIN
  IF p_pin IS NULL OR length(trim(p_pin)) != 4 THEN
    RETURN NULL;
  END IF;

  SELECT id, name, phone, vehicle, status, avatar, avatar_img, cash_settled_at
  INTO r
  FROM public.riders
  WHERE pin = trim(p_pin)
  LIMIT 1;

  IF r.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(r);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_rider_pin(TEXT) TO anon, authenticated;

-- -------------------------------------------------------------------------
-- 3. ORDERS PRIVACY & TAMPER-RESISTANT WORKFLOW (public.orders)
-- -------------------------------------------------------------------------
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_orders" ON public.orders;
DROP POLICY IF EXISTS "public_create_orders" ON public.orders;
DROP POLICY IF EXISTS "owner_read_orders" ON public.orders;
DROP POLICY IF EXISTS "staff_manage_orders" ON public.orders;
DROP POLICY IF EXISTS "app_read_orders" ON public.orders;
DROP POLICY IF EXISTS "app_update_orders" ON public.orders;
DROP POLICY IF EXISTS "orders_insert_checkout" ON public.orders;
DROP POLICY IF EXISTS "orders_select_owner_or_staff" ON public.orders;
DROP POLICY IF EXISTS "orders_update_staff_only" ON public.orders;

-- 3A. Checkout: Anyone (guest or logged-in) can create a new order
CREATE POLICY "orders_insert_checkout" ON public.orders
  FOR INSERT
  WITH CHECK (
    -- Initial status must be accepted or pending
    (status IS NULL OR status IN ('accepted', 'pending'))
  );

-- 3B. Select: Only the authentic customer owner or staff/rider may read orders
CREATE POLICY "orders_select_owner_or_staff" ON public.orders
  FOR SELECT
  USING (
    (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
    OR (auth.jwt() ->> 'email' IS NOT NULL AND LOWER(auth.jwt() ->> 'email') = LOWER(customer_email))
    OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
  );

-- 3C. Update: Direct table updates restricted to staff / fleet
CREATE POLICY "orders_update_staff_only" ON public.orders
  FOR UPDATE
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
  );

-- 3D. Secure Guest Order Tracking RPC (Requires Unpredictable UUID tracking_token)
CREATE OR REPLACE FUNCTION public.track_guest_order(p_order_id TEXT, p_tracking_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result JSONB;
BEGIN
  IF p_order_id IS NULL OR p_tracking_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id', id,
    'created_at', created_at,
    'status', status,
    'status_label', status_label,
    'step_index', step_index,
    'eta', eta,
    'items_summary', items_summary,
    'items', items,
    'total', total,
    'delivery_address', delivery_address,
    'payment_method', payment_method,
    'payment_status', payment_status,
    'pickup_code', pickup_code,
    'assigned_rider_name', assigned_rider_name,
    'assigned_rider_phone', assigned_rider_phone,
    'delivered_at', delivered_at,
    'cancellation_reason', cancellation_reason
  ) INTO result
  FROM public.orders
  WHERE (id = p_order_id OR id = '#' || ltrim(p_order_id, '#'))
    AND tracking_token = p_tracking_token
  LIMIT 1;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_guest_order(TEXT, UUID) TO anon, authenticated;

-- 3E. Secure Guest Order Cancellation RPC (Requires UUID tracking_token & pre-cooking state)
CREATE OR REPLACE FUNCTION public.cancel_guest_order(p_order_id TEXT, p_tracking_token UUID, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  curr_status TEXT;
  rows_updated INT;
BEGIN
  IF p_order_id IS NULL OR p_tracking_token IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT status INTO curr_status
  FROM public.orders
  WHERE (id = p_order_id OR id = '#' || ltrim(p_order_id, '#'))
    AND tracking_token = p_tracking_token;

  IF curr_status IS NULL THEN
    RETURN FALSE;
  END IF;

  IF curr_status NOT IN ('pending', 'accepted') THEN
    RAISE EXCEPTION 'Order cannot be cancelled once cooking or out for delivery';
  END IF;

  UPDATE public.orders
  SET status = 'cancelled',
      status_label = 'Cancelled',
      step_index = -1,
      cancellation_reason = COALESCE(NULLIF(trim(p_reason), ''), 'Cancelled by customer')
  WHERE (id = p_order_id OR id = '#' || ltrim(p_order_id, '#'))
    AND tracking_token = p_tracking_token;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_guest_order(TEXT, UUID, TEXT) TO anon, authenticated;

-- -------------------------------------------------------------------------
-- 4. DISHES & CATEGORIES PROTECTION (public.dishes, public.categories)
-- -------------------------------------------------------------------------
ALTER TABLE public.dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_dishes" ON public.dishes;
DROP POLICY IF EXISTS "public_read_dishes" ON public.dishes;
DROP POLICY IF EXISTS "admin_manage_dishes" ON public.dishes;
DROP POLICY IF EXISTS "dishes_public_read" ON public.dishes;
DROP POLICY IF EXISTS "dishes_staff_manage" ON public.dishes;

CREATE POLICY "dishes_public_read" ON public.dishes
  FOR SELECT USING (true);

CREATE POLICY "dishes_staff_manage" ON public.dishes
  FOR ALL
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "allow_all_categories" ON public.categories;
DROP POLICY IF EXISTS "public_read_categories" ON public.categories;
DROP POLICY IF EXISTS "admin_manage_categories" ON public.categories;
DROP POLICY IF EXISTS "categories_public_read" ON public.categories;
DROP POLICY IF EXISTS "categories_staff_manage" ON public.categories;

CREATE POLICY "categories_public_read" ON public.categories
  FOR SELECT USING (true);

CREATE POLICY "categories_staff_manage" ON public.categories
  FOR ALL
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  );

-- -------------------------------------------------------------------------
-- 5. STORE SETTINGS PROTECTION (public.store_settings)
-- -------------------------------------------------------------------------
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_store_settings" ON public.store_settings;
DROP POLICY IF EXISTS "public_read_store_settings" ON public.store_settings;
DROP POLICY IF EXISTS "admin_manage_store_settings" ON public.store_settings;
DROP POLICY IF EXISTS "store_settings_public_read" ON public.store_settings;
DROP POLICY IF EXISTS "store_settings_staff_update" ON public.store_settings;

CREATE POLICY "store_settings_public_read" ON public.store_settings
  FOR SELECT USING (true);

CREATE POLICY "store_settings_staff_update" ON public.store_settings
  FOR ALL
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  );

-- -------------------------------------------------------------------------
-- 6. ORDER IMMUTABILITY & AUDIT RETENTION TRIGGERS
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_order_deletion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Orders cannot be deleted: Orders are permanent financial and audit records.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_order_deletion ON public.orders;
CREATE TRIGGER trg_prevent_order_deletion
  BEFORE DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_order_deletion();

CREATE OR REPLACE FUNCTION public.prevent_order_status_reversal()
RETURNS TRIGGER AS $$
DECLARE
  old_rank INT := 0;
  new_rank INT := 0;
BEGIN
  -- Special handling for cancellation: Allowed ONLY before kitchen cooking starts
  IF NEW.status = 'cancelled' THEN
    IF OLD.status IN ('cooking', 'ready_for_pickup', 'on_the_way', 'delivered') THEN
      RAISE EXCEPTION 'Cannot cancel order once kitchen preparation has begun (% to %)', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  -- Delivered orders cannot be changed or cancelled
  IF OLD.status = 'delivered' AND NEW.status != 'delivered' THEN
    RAISE EXCEPTION 'Cannot modify an order that has already been delivered.';
  END IF;

  -- Cancelled orders cannot be revived
  IF OLD.status = 'cancelled' AND NEW.status != 'cancelled' THEN
    RAISE EXCEPTION 'Cannot reactivate an order that was cancelled.';
  END IF;

  CASE OLD.status
    WHEN 'pending' THEN old_rank := 0;
    WHEN 'accepted' THEN old_rank := 1;
    WHEN 'cooking' THEN old_rank := 2;
    WHEN 'ready_for_pickup' THEN old_rank := 3;
    WHEN 'on_the_way' THEN old_rank := 4;
    WHEN 'delivered' THEN old_rank := 5;
    ELSE old_rank := 0;
  END CASE;

  CASE NEW.status
    WHEN 'pending' THEN new_rank := 0;
    WHEN 'accepted' THEN new_rank := 1;
    WHEN 'cooking' THEN new_rank := 2;
    WHEN 'ready_for_pickup' THEN new_rank := 3;
    WHEN 'on_the_way' THEN new_rank := 4;
    WHEN 'delivered' THEN new_rank := 5;
    ELSE new_rank := 0;
  END CASE;

  -- Cannot regress backwards
  IF new_rank < old_rank THEN
    RAISE EXCEPTION 'Order status cannot regress backwards (% to %).', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_order_status_reversal ON public.orders;
CREATE TRIGGER trg_prevent_order_status_reversal
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_order_status_reversal();

RESET lock_timeout;
