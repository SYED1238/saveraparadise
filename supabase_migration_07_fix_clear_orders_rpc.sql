-- ==============================================================================
-- SAVERA PARADISE — SUPABASE MIGRATION 07
-- Fix clear_all_orders RPC to comply with safeupdate (WHERE clause requirement)
-- SECURITY HARDENING: Revoke public/anon execution to eliminate anonymous data deletion
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.clear_all_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
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

-- Security Lockdown: Strictly restrict order clearing to service_role (used by authenticated Owner endpoint)
REVOKE ALL ON FUNCTION public.clear_all_orders() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clear_all_orders() FROM anon;
REVOKE EXECUTE ON FUNCTION public.clear_all_orders() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.clear_all_orders() TO service_role;
