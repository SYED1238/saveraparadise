-- ==============================================================================
-- SAVERA PARADISE — SUPABASE MIGRATION 14
-- Security & Schema Alignment:
-- 1. Idempotently add missing Cashfree & Doorstep UPI columns to public.orders
-- 2. Drop surviving "public_create_orders" policy and revoke authenticated order mutations
-- 3. Update prevent_order_deletion() and prevent_order_status_reversal() to respect deletion override
-- 4. Secure clear_all_orders() RPC with search_path pinning and service_role execution
-- ==============================================================================

BEGIN;

-- 1. Ensure Cashfree & Doorstep UPI columns exist on public.orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_paid_online BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_gateway TEXT DEFAULT 'cashfree';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cf_order_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cf_payment_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cf_payment_status TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS doorstep_upi BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS doorstep_upi_vpa TEXT;

-- 2. Drop open "public_create_orders" and obsolete update policies
DROP POLICY IF EXISTS "public_create_orders" ON public.orders;
DROP POLICY IF EXISTS "authenticated_update_orders" ON public.orders;

-- 3. Revoke direct order mutations from authenticated, anon, and public
-- Mutations route exclusively through service_role edge endpoints (/api/order-action, /api/cashfree-create-order)
REVOKE ALL ON TABLE public.orders FROM anon, public;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.orders FROM authenticated;
GRANT SELECT ON TABLE public.orders TO authenticated;
GRANT ALL ON TABLE public.orders TO service_role;

-- 4. Update prevent_order_deletion() to allow administrative purge when deletion flag is set
CREATE OR REPLACE FUNCTION public.prevent_order_deletion()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.allow_order_deletion', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Orders cannot be deleted: Orders are permanent financial and audit records.';
END;
$$ LANGUAGE plpgsql;

-- 5. Update enforce_order_status_monotonicity() to permit administrative overrides when deletion flag is set
CREATE OR REPLACE FUNCTION public.enforce_order_status_monotonicity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.allow_order_deletion', true) = 'on' THEN
    RETURN NEW;
  END IF;

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

-- 6. Secure clear_all_orders() RPC with pinned search_path
CREATE OR REPLACE FUNCTION public.clear_all_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Temporarily allow deletion for this function transaction
  PERFORM set_config('app.allow_order_deletion', 'on', true);
  
  -- Must include a WHERE clause to satisfy Postgres safeupdate requirement
  DELETE FROM public.orders WHERE id IS NOT NULL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_all_orders() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clear_all_orders() FROM anon;
REVOKE EXECUTE ON FUNCTION public.clear_all_orders() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.clear_all_orders() TO service_role;

COMMIT;
