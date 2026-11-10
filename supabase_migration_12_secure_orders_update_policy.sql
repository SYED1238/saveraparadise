-- ==============================================================================
-- SUPABASE MIGRATION 12: SECURE ORDERS RLS & ELIMINATE CUSTOMER SELF-UPDATE
-- ==============================================================================
-- Eliminates customer self-update vulnerability on public.orders.
-- Drops legacy open policies (app_update_orders, admin_rider_update_orders, app_read_orders)
-- and creates authenticated_update_orders strictly restricted to operational staff roles.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders') THEN
    ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

    -- Drop all legacy or overly permissive update policies
    DROP POLICY IF EXISTS "app_update_orders" ON public.orders;
    DROP POLICY IF EXISTS "admin_rider_update_orders" ON public.orders;
    DROP POLICY IF EXISTS "orders_update_policy" ON public.orders;
    DROP POLICY IF EXISTS "orders_write_policy" ON public.orders;
    DROP POLICY IF EXISTS "orders_update_staff_only" ON public.orders;
    DROP POLICY IF EXISTS "authenticated_update_orders" ON public.orders;

    -- Drop legacy open read policies
    DROP POLICY IF EXISTS "app_read_orders" ON public.orders;
    DROP POLICY IF EXISTS "customer_read_orders" ON public.orders;
    DROP POLICY IF EXISTS "orders_read_policy" ON public.orders;
    DROP POLICY IF EXISTS "authenticated_select_orders" ON public.orders;

    -- 1. Ensure service_role has full management privileges
    DROP POLICY IF EXISTS "service_manage_orders" ON public.orders;
    CREATE POLICY "service_manage_orders" ON public.orders
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);

    -- 2. Authenticated staff and customer owner reads
    -- Customers can read their own orders; staff can read all orders
    CREATE POLICY "authenticated_select_orders" ON public.orders
      FOR SELECT TO authenticated
      USING (
        (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider', 'owner')
        OR (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
      );

    -- 3. Direct SQL updates strictly restricted to authorized staff/rider/owner roles
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
