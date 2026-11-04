-- ==============================================================================
-- SAVERA PARADISE — SUPABASE MIGRATION 07
-- Fix clear_all_orders RPC to comply with safeupdate (WHERE clause requirement)
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

GRANT EXECUTE ON FUNCTION public.clear_all_orders() TO anon, authenticated, service_role;
