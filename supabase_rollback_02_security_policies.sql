-- =========================================================================
-- SAVERA PARADISE: SAFE RECOVERY FOR STAGE 2 POLICIES
-- Only execute if explicitly needed to restore Stage 2 baseline policies.
-- NOTE: Never opens unrestricted public access to customer PII or plaintext PINs.
-- =========================================================================

SET lock_timeout = '2s';

-- 1. Restore customer address policies with authenticated owner check
DROP POLICY IF EXISTS "user_addresses_owner_only" ON public.user_addresses;
CREATE POLICY "user_addresses_owner_only" ON public.user_addresses
  FOR ALL
  USING (
    (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
    OR (auth.jwt() ->> 'email' IS NOT NULL AND LOWER(auth.jwt() ->> 'email') = LOWER(user_email))
    OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  );

-- 2. Restore staff-only rider policy
DROP POLICY IF EXISTS "riders_staff_only" ON public.riders;
CREATE POLICY "riders_staff_only" ON public.riders
  FOR ALL
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
  );

-- 3. Restore orders checkout and owner select
DROP POLICY IF EXISTS "orders_insert_checkout" ON public.orders;
DROP POLICY IF EXISTS "orders_select_owner_or_staff" ON public.orders;
DROP POLICY IF EXISTS "orders_update_staff_only" ON public.orders;

CREATE POLICY "orders_insert_checkout" ON public.orders FOR INSERT WITH CHECK (true);
CREATE POLICY "orders_select_owner_or_staff" ON public.orders FOR SELECT
  USING (
    (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
    OR (auth.jwt() ->> 'email' IS NOT NULL AND LOWER(auth.jwt() ->> 'email') = LOWER(customer_email))
    OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
  );
CREATE POLICY "orders_update_staff_only" ON public.orders FOR UPDATE
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
  );

RESET lock_timeout;
